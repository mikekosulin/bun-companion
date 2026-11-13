import { readdir, realpath, stat } from 'node:fs/promises';
import * as path from 'node:path';

const MAGIC = /[*?[\]{}]/;
const SKIPPED_DIRS = new Set(['node_modules', '.git']);

export function isGlob(pattern: string): boolean {
  return MAGIC.test(pattern);
}

function splitTopLevel(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const c of body) {
    if (c === ',' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    if (c === '{') depth++;
    if (c === '}') depth--;
    current += c;
  }
  parts.push(current);
  return parts;
}

export function expandBraces(pattern: string): string[] {
  let depth = 0;
  let start = -1;
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (c === '}' && depth > 0) {
      depth--;
      if (depth > 0) continue;
      const alternatives = splitTopLevel(pattern.slice(start + 1, i));
      if (alternatives.length > 1) {
        const before = pattern.slice(0, start);
        const after = pattern.slice(i + 1);
        return alternatives.flatMap((alt) => expandBraces(`${before}${alt}${after}`));
      }
    }
  }
  return [pattern];
}

function segmentToRegExp(segment: string): RegExp {
  let source = segment.startsWith('.') ? '' : '(?!\\.)';
  for (let i = 0; i < segment.length; i++) {
    const c = segment[i] as string;
    if (c === '*') {
      source += '[^/]*';
    } else if (c === '?') {
      source += '[^/]';
    } else if (c === '[') {
      const end = segment.indexOf(']', i + 2);
      if (end < 0) {
        source += '\\[';
        continue;
      }
      let body = segment.slice(i + 1, end).replace(/\\/g, '\\\\');
      if (body.startsWith('!') || body.startsWith('^')) body = `^${body.slice(1)}`;
      source += `[${body}]`;
      i = end;
    } else {
      source += c.replace(/[.+^$(){}|\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${source}$`);
}

type Segment = RegExp | '**';

function compileSegments(pattern: string): Segment[] {
  return pattern
    .split('/')
    .filter((s) => s !== '' && s !== '.')
    .map((s) => (s === '**' ? '**' : segmentToRegExp(s)));
}

function matchSegments(pattern: Segment[], pi: number, parts: string[], si: number): boolean {
  if (pi === pattern.length) return si === parts.length;
  const current = pattern[pi] as Segment;
  if (current === '**') {
    for (let k = si; k <= parts.length; k++) {
      if (matchSegments(pattern, pi + 1, parts, k)) return true;
      if (k < parts.length && (parts[k] as string).startsWith('.')) return false;
    }
    return false;
  }
  return (
    si < parts.length && current.test(parts[si] as string) && matchSegments(pattern, pi + 1, parts, si + 1)
  );
}

export function compileGlob(pattern: string): (relativePath: string) => boolean {
  const compiled = expandBraces(pattern).map(compileSegments);
  return (relativePath) => {
    const parts = relativePath.split('/').filter((p) => p !== '' && p !== '.');
    return compiled.some((segments) => matchSegments(segments, 0, parts, 0));
  };
}

async function isDirectory(full: string, isSymlink: boolean, isDir: boolean): Promise<boolean> {
  if (isDir) return true;
  if (!isSymlink) return false;
  try {
    return (await stat(full)).isDirectory();
  } catch {
    return false;
  }
}

export async function walkDirectories(
  start: string,
  maxDepth: number,
  visit: (relativePath: string, absolutePath: string) => void,
): Promise<void> {
  const seen = new Set<string>();
  const walk = async (dir: string, rel: string, depth: number): Promise<void> => {
    let real: string;
    try {
      real = await realpath(dir);
    } catch {
      return;
    }
    if (seen.has(real)) return;
    seen.add(real);
    let entries: import('node:fs').Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (SKIPPED_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (!(await isDirectory(full, entry.isSymbolicLink(), entry.isDirectory()))) continue;
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      visit(childRel, full);
      if (depth + 1 < maxDepth) await walk(full, childRel, depth + 1);
    }
  };
  await walk(start, '', 0);
}

export async function globDirectories(root: string, pattern: string): Promise<string[]> {
  const found = new Set<string>();
  for (const expanded of expandBraces(pattern)) {
    const segments = expanded.split('/').filter(Boolean);
    const firstMagic = segments.findIndex(isGlob);
    if (firstMagic < 0) {
      found.add(segments.join('/'));
      continue;
    }
    const base = segments.slice(0, firstMagic).join('/');
    const rest = segments.slice(firstMagic);
    const matches = compileGlob(expanded);
    const maxDepth = rest.includes('**') ? Number.POSITIVE_INFINITY : rest.length;
    await walkDirectories(path.resolve(root, base), maxDepth, (rel) => {
      const candidate = base ? `${base}/${rel}` : rel;
      if (matches(candidate)) found.add(candidate);
    });
  }
  return [...found];
}
