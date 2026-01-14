export async function getCliVersion(): Promise<string> {
  const envVersion = process.env.OPENMUX_VERSION?.trim();
  if (envVersion) {
    return envVersion;
  }

  try {
    const { readFileSync } = await import('node:fs');
    const { resolve, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const here = dirname(fileURLToPath(import.meta.url));
    const pkgPath = resolve(here, '..', '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string };
    if (pkg.version) {
      return pkg.version;
    }
  } catch {
    // Best-effort: version may be embedded by wrapper or unavailable in binaries.
  }

  return 'unknown';
}
