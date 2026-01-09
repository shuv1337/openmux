function normalizeVersion(version: string): { parts: number[]; prerelease: string | null } {
  const cleaned = version.trim().replace(/^v/, '');
  const [main, prerelease] = cleaned.split('-', 2);
  const parts = (main ?? '')
    .split('.')
    .map((part) => Number.parseInt(part, 10))
    .filter((value) => Number.isFinite(value));
  return { parts, prerelease: prerelease ?? null };
}

export function compareSemver(left: string, right: string): number {
  const a = normalizeVersion(left);
  const b = normalizeVersion(right);
  const length = Math.max(a.parts.length, b.parts.length);
  for (let i = 0; i < length; i += 1) {
    const av = a.parts[i] ?? 0;
    const bv = b.parts[i] ?? 0;
    if (av < bv) return -1;
    if (av > bv) return 1;
  }
  if (a.prerelease && !b.prerelease) return -1;
  if (!a.prerelease && b.prerelease) return 1;
  if (a.prerelease && b.prerelease) {
    const order = a.prerelease.localeCompare(b.prerelease);
    if (order !== 0) return order < 0 ? -1 : 1;
  }
  return 0;
}

export function isUpdateAvailable(current: string, latest: string): boolean {
  return compareSemver(current, latest) < 0;
}
