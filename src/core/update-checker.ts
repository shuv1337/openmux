import { compareSemver } from './update-check';

export async function readLocalVersion(): Promise<string | null> {
  const envVersion = process.env.OPENMUX_VERSION?.trim();
  if (envVersion) {
    return envVersion;
  }

  try {
    const { readFileSync } = await import('node:fs');
    const { resolve, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const here = dirname(fileURLToPath(import.meta.url));
    const pkgPath = resolve(here, '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string };
    return pkg.version ?? null;
  } catch {
    return null;
  }
}

export async function fetchLatestVersion(signal?: AbortSignal): Promise<string | null> {
  try {
    const response = await fetch('https://registry.npmjs.org/openmux/latest', { signal });
    if (!response.ok) return null;
    const data = (await response.json()) as { version?: string };
    return typeof data.version === 'string' ? data.version : null;
  } catch {
    return null;
  }
}

export async function checkForUpdateLabel(signal?: AbortSignal): Promise<string | null> {
  const currentVersion = await readLocalVersion();
  if (!currentVersion) return null;
  const latestVersion = await fetchLatestVersion(signal);
  if (!latestVersion) return null;
  return compareSemver(currentVersion, latestVersion) < 0 ? '[UPDATE!]' : null;
}
