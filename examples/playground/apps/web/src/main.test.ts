import { expect, test } from 'bun:test';
import { banner } from '@playground/ui';

test('banner', () => {
  expect(banner('web')).toContain('Hello, web!');
});
