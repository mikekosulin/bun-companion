import { afterEach, beforeEach, describe as nodeDescribe, test as nodeTest } from 'node:test';
import { inspect } from 'node:util';
import { expect } from './expect';

type Fn = (...args: never[]) => unknown;

function title(template: string, args: unknown[]): string {
  let i = 0;
  return template.replace(/%[psdij]/g, (token) => {
    const value = args[i++];
    return token === '%s' || token === '%d' || token === '%i' ? String(value) : inspect(value);
  });
}

function each(register: (name: string, fn: () => unknown) => unknown) {
  return (table: readonly unknown[]) => (name: string, fn: Fn) => {
    for (const row of table) {
      const args = Array.isArray(row) ? row : [row];
      register(title(name, args), () => fn(...(args as never[])));
    }
  };
}

export const test = Object.assign((name: string, fn: () => unknown) => nodeTest(name, fn), {
  each: each((name, fn) => nodeTest(name, fn)),
});
export const it = test;
export const describe = Object.assign((name: string, fn: () => void) => nodeDescribe(name, fn), {
  each: each((name, fn) => nodeDescribe(name, fn as () => void)),
});
export { afterEach, beforeEach, expect };
