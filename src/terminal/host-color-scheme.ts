export type HostColorScheme = 'light' | 'dark';

type HostColorSchemeListener = (scheme: HostColorScheme) => void;

const listeners = new Set<HostColorSchemeListener>();

export function onHostColorScheme(listener: HostColorSchemeListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function emitHostColorScheme(scheme: HostColorScheme): void {
  for (const listener of listeners) {
    listener(scheme);
  }
}
