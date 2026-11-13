import { type ParseError, parse, printParseErrorCode } from 'jsonc-parser';
import { type Catalogs, DEFAULT_CATALOG, DEPENDENCY_FIELDS, type DependencyEntry } from './types';

export interface Manifest {
  readonly name: string | undefined;
  readonly version: string | undefined;
  readonly private: boolean;
  readonly packageManager: string | undefined;
  readonly scripts: Readonly<Record<string, string>>;
  readonly dependencies: readonly DependencyEntry[];
  readonly workspaces: unknown;
  readonly raw: Readonly<Record<string, unknown>>;
}

export type ManifestResult = { ok: true; manifest: Manifest } | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringRecord(value: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!isRecord(value)) return out;
  for (const [key, v] of Object.entries(value)) {
    if (typeof v === 'string') out[key] = v;
  }
  return out;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

export function parseManifest(text: string): ManifestResult {
  const errors: ParseError[] = [];
  const raw: unknown = parse(text, errors, { allowTrailingComma: true, disallowComments: false });
  const firstError = errors[0];
  if (firstError) {
    return { ok: false, error: `${printParseErrorCode(firstError.error)} at offset ${firstError.offset}` };
  }
  if (!isRecord(raw)) {
    return { ok: false, error: 'package.json must contain a JSON object' };
  }

  const dependencies: DependencyEntry[] = [];
  for (const field of DEPENDENCY_FIELDS) {
    for (const [name, spec] of Object.entries(stringRecord(raw[field]))) {
      dependencies.push({ name, spec, field });
    }
  }

  return {
    ok: true,
    manifest: {
      name: optionalString(raw.name),
      version: optionalString(raw.version),
      private: raw.private === true,
      packageManager: optionalString(raw.packageManager),
      scripts: stringRecord(raw.scripts),
      dependencies,
      workspaces: raw.workspaces,
      raw,
    },
  };
}

export interface WorkspacesConfig {
  readonly patterns: readonly string[];
  readonly catalogs: Catalogs;
}

export function readWorkspacesConfig(manifest: Manifest): WorkspacesConfig | undefined {
  const ws = manifest.workspaces;
  let patterns: string[];
  if (Array.isArray(ws)) {
    patterns = ws.filter((p): p is string => typeof p === 'string');
  } else if (isRecord(ws)) {
    patterns = Array.isArray(ws.packages)
      ? ws.packages.filter((p): p is string => typeof p === 'string')
      : [];
  } else {
    return undefined;
  }

  const catalogs = new Map<string, Map<string, string>>();
  const addCatalog = (name: string, entries: unknown) => {
    const record = stringRecord(entries);
    if (Object.keys(record).length === 0 && !isRecord(entries)) return;
    const target = catalogs.get(name) ?? new Map<string, string>();
    for (const [dep, range] of Object.entries(record)) target.set(dep, range);
    catalogs.set(name, target);
  };
  const addNamedCatalogs = (value: unknown) => {
    if (!isRecord(value)) return;
    for (const [name, entries] of Object.entries(value)) addCatalog(name, entries);
  };

  addCatalog(DEFAULT_CATALOG, manifest.raw.catalog);
  addNamedCatalogs(manifest.raw.catalogs);
  if (isRecord(ws)) {
    addCatalog(DEFAULT_CATALOG, ws.catalog);
    addNamedCatalogs(ws.catalogs);
  }

  return { patterns, catalogs };
}

export function catalogNameFromSpec(spec: string): string | undefined {
  if (!spec.startsWith('catalog:')) return undefined;
  const name = spec.slice('catalog:'.length).trim();
  return name === '' ? DEFAULT_CATALOG : name;
}
