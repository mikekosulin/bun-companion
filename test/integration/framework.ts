type Fn = () => unknown | Promise<unknown>;

interface Suite {
  name: string;
  parent: Suite | undefined;
  suites: Suite[];
  tests: { name: string; fn: Fn }[];
  before: Fn[];
  after: Fn[];
  beforeEach: Fn[];
  afterEach: Fn[];
}

const newSuite = (name: string, parent: Suite | undefined): Suite => ({
  name,
  parent,
  suites: [],
  tests: [],
  before: [],
  after: [],
  beforeEach: [],
  afterEach: [],
});

const root = newSuite('', undefined);
let current = root;

export function describe(name: string, body: () => void): void {
  const suite = newSuite(name, current);
  current.suites.push(suite);
  current = suite;
  body();
  current = suite.parent ?? root;
}

export function it(name: string, fn: Fn): void {
  current.tests.push({ name, fn });
}

export const before = (fn: Fn) => void current.before.push(fn);
export const after = (fn: Fn) => void current.after.push(fn);
export const beforeEach = (fn: Fn) => void current.beforeEach.push(fn);
export const afterEach = (fn: Fn) => void current.afterEach.push(fn);

function withTimeout(fn: Fn, ms: number, label: string): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out after ${ms} ms: ${label}`)), ms);
  });
  return Promise.race([Promise.resolve().then(fn), timeout]).finally(() => clearTimeout(timer));
}

function hooks(suite: Suite | undefined, key: 'beforeEach' | 'afterEach'): Fn[] {
  const chain: Fn[][] = [];
  for (let s = suite; s; s = s.parent) chain.unshift(s[key]);
  return key === 'beforeEach' ? chain.flat() : chain.reverse().flat();
}

export interface RunResult {
  passed: number;
  failed: { title: string; error: unknown }[];
}

export async function run(log: (line: string) => void, timeoutMs = 60_000): Promise<RunResult> {
  const result: RunResult = { passed: 0, failed: [] };
  const visit = async (suite: Suite, depth: number, path: string[]): Promise<void> => {
    const indent = '  '.repeat(Math.max(0, depth));
    if (suite.name) log(`${indent}${suite.name}`);
    const title = [...path, suite.name].filter(Boolean);
    try {
      for (const hook of suite.before) await withTimeout(hook, timeoutMs, `${title.join(' > ')} before`);
    } catch (error) {
      result.failed.push({ title: `${title.join(' > ')} (before)`, error });
      log(`${indent}  ✗ before hook failed`);
      return;
    }
    for (const test of suite.tests) {
      const full = [...title, test.name].join(' > ');
      const started = Date.now();
      try {
        for (const hook of hooks(suite, 'beforeEach'))
          await withTimeout(hook, timeoutMs, `${full} beforeEach`);
        await withTimeout(test.fn, timeoutMs, full);
        result.passed++;
        log(`${indent}  ✓ ${test.name} (${Date.now() - started} ms)`);
      } catch (error) {
        result.failed.push({ title: full, error });
        log(`${indent}  ✗ ${test.name}`);
      } finally {
        for (const hook of hooks(suite, 'afterEach')) {
          try {
            await withTimeout(hook, timeoutMs, `${full} afterEach`);
          } catch (error) {
            result.failed.push({ title: `${full} (afterEach)`, error });
          }
        }
      }
    }
    for (const child of suite.suites) await visit(child, depth + 1, title);
    for (const hook of suite.after) {
      try {
        await withTimeout(hook, timeoutMs, `${title.join(' > ')} after`);
      } catch (error) {
        result.failed.push({ title: `${title.join(' > ')} (after)`, error });
      }
    }
  };
  await visit(root, -1, []);
  return result;
}
