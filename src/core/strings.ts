export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        (prev[j] as number) + 1,
        (curr[j - 1] as number) + 1,
        (prev[j - 1] as number) + cost,
      );
    }
    prev = curr;
  }
  return prev[b.length] as number;
}

export function closestMatches(input: string, candidates: Iterable<string>, limit = 3): string[] {
  const maxDistance = Math.max(1, Math.floor(input.length / 4));
  return [...new Set(candidates)]
    .filter((c) => c !== input)
    .map((c) => ({ c, d: editDistance(input.toLowerCase(), c.toLowerCase()) }))
    .filter(({ d }) => d <= maxDistance)
    .sort((x, y) => x.d - y.d || x.c.localeCompare(y.c))
    .slice(0, limit)
    .map(({ c }) => c);
}
