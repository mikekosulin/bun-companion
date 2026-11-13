import { describe, expect, test } from 'bun:test';
import { expect as shim } from '../node/expect';

const throws = (fn: () => unknown) => expect(fn).toThrow();
const passes = (fn: () => unknown) => expect(fn).not.toThrow();

describe('Node expect shim', () => {
  test('toEqual: deep, ignores undefined properties, strict on extra keys', () => {
    passes(() => shim({ a: [1, { b: 2 }], c: undefined }).toEqual({ a: [1, { b: 2 }] }));
    throws(() => shim({ a: 1, extra: 2 }).toEqual({ a: 1 }));
    throws(() => shim({ a: 1 }).toEqual({ a: 2 }));
    throws(() => shim([1, 2]).toEqual([1]));
    throws(() => shim('1').toEqual(1));
    throws(() => shim(null).toEqual({}));
    passes(() => shim(new Map([['a', 1]])).toEqual(new Map([['a', 1]])));
    throws(() => shim(new Map([['a', 1]])).toEqual(new Map([['a', 2]])));
    throws(() => shim({}).toEqual(new Map()));
  });

  test('toMatchObject: partial objects, exact arrays', () => {
    passes(() => shim({ a: 1, b: { c: 2, d: 3 } }).toMatchObject({ b: { c: 2 } }));
    throws(() => shim({ a: 1 }).toMatchObject({ a: 1, b: 2 }));
    throws(() => shim({ list: [1, 2] }).toMatchObject({ list: [1] }));
  });

  test('asymmetric matchers', () => {
    passes(() => shim({ span: { offset: 1 } }).toEqual({ span: shim.any(Object) }));
    throws(() => shim({ span: null }).toEqual({ span: shim.any(Object) }));
    passes(() => shim(['x']).toEqual([shim.any(String)]));
    passes(() => shim([3]).toEqual([shim.any(Number)]));
    passes(() => shim([new Error('x')]).toEqual([shim.any(Error)]));
    throws(() => shim([1]).toEqual([shim.any(String)]));
    passes(() => shim([{ a: 1, b: 2 }]).toEqual([shim.objectContaining({ a: 1 })]));
    throws(() => shim([{ a: 1 }]).toEqual([shim.objectContaining({ a: 2 })]));
  });

  test('scalars, strings and collections', () => {
    passes(() => shim(NaN).toBe(NaN));
    throws(() => shim({}).toBe({}));
    passes(() => shim(undefined).toBeUndefined());
    throws(() => shim(0).toBeUndefined());
    passes(() => shim(0).toBeDefined());
    passes(() => shim(null).toBeNull());
    passes(() => shim('abc').toContain('b'));
    passes(() => shim([1, 2]).toContain(2));
    throws(() => shim(42).toContain(4));
    passes(() => shim([{ a: 1 }]).toContainEqual({ a: 1 }));
    throws(() => shim('x').toContainEqual('x'));
    passes(() => shim('hello').toMatch(/ell/));
    passes(() => shim('hello').toMatch('ell'));
    throws(() => shim(1).toMatch(/1/));
    passes(() => shim(2).toBeGreaterThan(1));
    throws(() => shim(1).toBeGreaterThan(1));
    passes(() => shim(1).toBeGreaterThanOrEqual(1));
    throws(() => shim('2').toBeGreaterThanOrEqual(1));
  });

  test('not inverts and reports', () => {
    passes(() => shim(1).not.toBe(2));
    throws(() => shim(1).not.toBe(1));
    passes(() => shim([1]).not.toContain(2));
  });

  test('rejects.toThrow', async () => {
    await shim(Promise.reject(new Error('x'))).rejects.toThrow();
    await expect(shim(Promise.resolve(1)).rejects.toThrow()).rejects.toThrow();
  });
});

describe('Node expect shim: toThrow', () => {
  test('sync functions', () => {
    passes(() =>
      shim(() => {
        throw new Error('x');
      }).toThrow(),
    );
    throws(() => shim(() => 1).toThrow());
    passes(() => shim(() => 1).not.toThrow());
  });
});
