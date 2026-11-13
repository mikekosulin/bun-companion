import { AssertionError } from 'node:assert';

class Asymmetric {
  constructor(
    readonly matches: (value: unknown) => boolean,
    readonly description: string,
  ) {}
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function equals(actual: unknown, expected: unknown, partial: boolean): boolean {
  if (expected instanceof Asymmetric) return expected.matches(actual);
  if (Object.is(actual, expected)) return true;
  if (Array.isArray(expected)) {
    return (
      Array.isArray(actual) &&
      actual.length === expected.length &&
      expected.every((item, i) => equals(actual[i], item, partial))
    );
  }
  if (expected instanceof Map) {
    return (
      actual instanceof Map &&
      actual.size === expected.size &&
      [...expected].every(([k, v]) => actual.has(k) && equals(actual.get(k), v, partial))
    );
  }
  if (isPlainObject(expected) && isPlainObject(actual)) {
    const defined = (o: Record<string, unknown>) => Object.keys(o).filter((k) => o[k] !== undefined);
    const expectedKeys = defined(expected);
    if (!partial && defined(actual).length !== expectedKeys.length) return false;
    return expectedKeys.every((k) => equals(actual[k], expected[k], partial));
  }
  return false;
}

function fail(message: string, actual: unknown, expected: unknown, operator: string): never {
  throw new AssertionError({ message, actual, expected, operator });
}

function matchers(actual: unknown, negate: boolean) {
  const check = (pass: boolean, message: string, expected?: unknown, operator = 'expect') => {
    if (pass === negate) fail(negate ? `Expected not: ${message}` : message, actual, expected, operator);
  };
  return {
    toBe: (expected: unknown) =>
      check(Object.is(actual, expected), 'values to be identical', expected, 'toBe'),
    toEqual: (expected: unknown) =>
      check(equals(actual, expected, false), 'values to be equal', expected, 'toEqual'),
    toMatchObject: (expected: unknown) =>
      check(equals(actual, expected, true), 'object to match', expected, 'toMatchObject'),
    toBeUndefined: () => check(actual === undefined, 'value to be undefined'),
    toBeDefined: () => check(actual !== undefined, 'value to be defined'),
    toBeNull: () => check(actual === null, 'value to be null'),
    toContain: (item: unknown) =>
      check(
        (typeof actual === 'string' || Array.isArray(actual)) && actual.includes(item as never),
        'collection to contain item',
        item,
        'toContain',
      ),
    toContainEqual: (item: unknown) =>
      check(
        Array.isArray(actual) && actual.some((a) => equals(a, item, false)),
        'array to contain an equal item',
        item,
        'toContainEqual',
      ),
    toMatch: (pattern: RegExp | string) =>
      check(
        typeof actual === 'string' &&
          (typeof pattern === 'string' ? actual.includes(pattern) : pattern.test(actual)),
        `string to match ${pattern}`,
        pattern,
        'toMatch',
      ),
    toThrow: () => {
      let threw = false;
      try {
        (actual as () => unknown)();
      } catch {
        threw = true;
      }
      check(threw, 'function to throw');
    },
    toBeGreaterThan: (n: number) => check(typeof actual === 'number' && actual > n, `> ${n}`, n),
    toBeGreaterThanOrEqual: (n: number) => check(typeof actual === 'number' && actual >= n, `>= ${n}`, n),
  };
}

export function expect(actual: unknown) {
  return {
    ...matchers(actual, false),
    not: matchers(actual, true),
    rejects: {
      toThrow: async () => {
        try {
          await actual;
        } catch {
          return;
        }
        fail('promise to reject', actual, undefined, 'rejects');
      },
    },
  };
}

expect.any = (type: unknown) =>
  new Asymmetric((value) => {
    if (type === Object) return typeof value === 'object' && value !== null;
    if (type === String) return typeof value === 'string';
    if (type === Number) return typeof value === 'number';
    return typeof type === 'function' && value instanceof type;
  }, 'any');

expect.objectContaining = (shape: Record<string, unknown>) =>
  new Asymmetric((value) => equals(value, shape, true), 'objectContaining');
