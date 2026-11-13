import * as path from 'node:path';

export function toPosixRelative(root: string, target: string): string {
  const rel = path.relative(root, target);
  return rel.split(path.sep).join('/');
}

export function isInside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  if (rel === '') return true;
  if (path.isAbsolute(rel)) return false;
  return rel !== '..' && !rel.startsWith(`..${path.sep}`);
}

export function normalizePattern(pattern: string): string {
  let p = pattern.trim().replace(/\\/g, '/');
  while (p.startsWith('./')) p = p.slice(2);
  while (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  return p;
}
