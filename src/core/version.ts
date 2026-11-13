export interface Version {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

export function parseVersion(text: string): Version | undefined {
  const match = /^\s*v?(\d+)\.(\d+)\.(\d+)/.exec(text);
  if (!match) return undefined;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

export function compareVersions(a: Version, b: Version): number {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

export function atLeast(version: Version | undefined, min: string): boolean {
  const parsedMin = parseVersion(min);
  if (!version || !parsedMin) return false;
  return compareVersions(version, parsedMin) >= 0;
}

export function formatVersion(v: Version): string {
  return `${v.major}.${v.minor}.${v.patch}`;
}

export const BUN_FEATURES = {
  filter: '1.1.4',
  graphFilters: '1.4.0',
} as const;
