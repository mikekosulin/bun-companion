import { greet } from '@playground/core';

export function banner(name: string): string {
  return `*** ${greet(name)} ***`;
}
