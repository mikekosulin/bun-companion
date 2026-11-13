import { findNodeAtLocation, getLocation, type Node, parseTree } from 'jsonc-parser';
import { DEFAULT_CATALOG, DEPENDENCY_FIELDS, type DependencyField } from './types';

export interface Span {
  readonly offset: number;
  readonly length: number;
}

export interface DependencyNode {
  readonly name: string;
  readonly spec: string;
  readonly field: DependencyField;
  readonly key: Span;
  readonly value: Span;
}

export type SpecField = DependencyField | 'overrides';

export interface SpecNode {
  readonly name: string;
  readonly spec: string;
  readonly field: SpecField;
  readonly key: Span;
  readonly value: Span;
}

export interface PropertyNode {
  readonly name: string;
  readonly key: Span;
  readonly value: Span;
}

function inner(node: Node): Span {
  return node.type === 'string'
    ? { offset: node.offset + 1, length: Math.max(0, node.length - 2) }
    : { offset: node.offset, length: node.length };
}

function parse(text: string): Node | undefined {
  return parseTree(text, [], { allowTrailingComma: true, disallowComments: false });
}

function objectProperties(node: Node | undefined): PropertyNode[] {
  if (node?.type !== 'object' || !node.children) return [];
  const out: PropertyNode[] = [];
  for (const prop of node.children) {
    const [keyNode, valueNode] = prop.children ?? [];
    if (!keyNode || !valueNode || typeof keyNode.value !== 'string') continue;
    out.push({ name: keyNode.value, key: inner(keyNode), value: inner(valueNode) });
  }
  return out;
}

export function findDependencyNodes(text: string): DependencyNode[] {
  const root = parse(text);
  if (!root) return [];
  const out: DependencyNode[] = [];
  for (const field of DEPENDENCY_FIELDS) {
    const obj = findNodeAtLocation(root, [field]);
    if (obj?.type !== 'object') continue;
    for (const prop of obj.children ?? []) {
      const [keyNode, valueNode] = prop.children ?? [];
      if (!keyNode || !valueNode || valueNode.type !== 'string') continue;
      out.push({
        name: String(keyNode.value),
        spec: String(valueNode.value),
        field,
        key: inner(keyNode),
        value: inner(valueNode),
      });
    }
  }
  return out;
}

export function overrideTarget(keys: readonly string[]): string | undefined {
  const last = keys.filter((k) => k !== '.').at(-1);
  return last?.replace(/(?<=.)@.*$/, '');
}

export function findOverrideNodes(text: string): SpecNode[] {
  const root = parse(text);
  const overrides = root ? findNodeAtLocation(root, ['overrides']) : undefined;
  const out: SpecNode[] = [];
  const walk = (node: Node | undefined, keys: string[]) => {
    for (const prop of node?.type === 'object' ? (node.children ?? []) : []) {
      const [keyNode, valueNode] = prop.children ?? [];
      if (!keyNode || !valueNode || typeof keyNode.value !== 'string') continue;
      const path = [...keys, keyNode.value];
      if (valueNode.type === 'object') {
        walk(valueNode, path);
        continue;
      }
      const name = overrideTarget(path);
      if (valueNode.type !== 'string' || !name) continue;
      out.push({
        name,
        spec: String(valueNode.value),
        field: 'overrides',
        key: inner(keyNode),
        value: inner(valueNode),
      });
    }
  };
  walk(overrides, []);
  return out;
}

export function findSpecNodes(text: string): SpecNode[] {
  return [...findDependencyNodes(text), ...findOverrideNodes(text)];
}

export function findCatalogDefaultConflicts(text: string): PropertyNode[] {
  const root = parse(text);
  if (!root) return [];
  const at = (path: string[]) => objectProperties(findNodeAtLocation(root, path));
  const plain = new Set([...at(['catalog']), ...at(['workspaces', 'catalog'])].map((p) => p.name));
  return [...at(['catalogs', DEFAULT_CATALOG]), ...at(['workspaces', 'catalogs', DEFAULT_CATALOG])].filter(
    (p) => plain.has(p.name),
  );
}

export function findScriptNodes(text: string): PropertyNode[] {
  const root = parse(text);
  return root ? objectProperties(findNodeAtLocation(root, ['scripts'])) : [];
}

export function findNameNode(text: string): Span | undefined {
  const root = parse(text);
  const node = root ? findNodeAtLocation(root, ['name']) : undefined;
  return node?.type === 'string' ? inner(node) : undefined;
}

export function findCatalogEntry(
  text: string,
  catalog: string,
  dependency: string,
): PropertyNode | undefined {
  const root = parse(text);
  if (!root) return undefined;
  const paths: (string | number)[][] =
    catalog === DEFAULT_CATALOG
      ? [
          ['workspaces', 'catalog'],
          ['catalog'],
          ['workspaces', 'catalogs', DEFAULT_CATALOG],
          ['catalogs', DEFAULT_CATALOG],
        ]
      : [
          ['workspaces', 'catalogs', catalog],
          ['catalogs', catalog],
        ];
  for (const p of paths) {
    const found = objectProperties(findNodeAtLocation(root, p)).find((prop) => prop.name === dependency);
    if (found) return found;
  }
  return undefined;
}

export type CompletionContext =
  | {
      readonly kind: 'dependencyKey';
      readonly field: DependencyField;
      readonly span: Span;
      readonly prefix: string;
    }
  | {
      readonly kind: 'dependencyValue';
      readonly field: SpecField;
      readonly dependency: string;
      readonly span: Span;
      readonly prefix: string;
    };

export function getCompletionContext(text: string, offset: number): CompletionContext | undefined {
  const location = getLocation(text, offset);
  const [field, key] = location.path;
  const isOverride = field === 'overrides' && location.path.length >= 2 && !location.isAtPropertyKey;
  if (!isOverride && (location.path.length !== 2 || typeof key !== 'string')) return undefined;
  if (!isOverride && !(DEPENDENCY_FIELDS as readonly string[]).includes(String(field))) return undefined;
  // jsonc-parser reports a key as a `property` node, a value as a `string` node.
  const node = location.previousNode;
  const span: Span =
    node &&
    (node.type === 'string' || node.type === 'property') &&
    offset > node.offset &&
    offset < node.offset + node.length
      ? { offset: node.offset + 1, length: Math.max(0, node.length - 2) }
      : { offset, length: 0 };
  const prefix = text.slice(span.offset, offset);
  if (isOverride) {
    const dependency = overrideTarget(location.path.slice(1).map(String));
    return dependency ? { kind: 'dependencyValue', field: 'overrides', dependency, span, prefix } : undefined;
  }
  const dependencyField = field as DependencyField;
  if (location.isAtPropertyKey) {
    return { kind: 'dependencyKey', field: dependencyField, span, prefix };
  }
  return { kind: 'dependencyValue', field: dependencyField, dependency: String(key), span, prefix };
}

export function spanContains(span: Span, offset: number): boolean {
  return offset >= span.offset && offset <= span.offset + span.length;
}
