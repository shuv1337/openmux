import type net from 'net';

type PtySubscriptions = Map<string, { unifiedUnsub: () => void; exitUnsub: () => void }>;

export type ShimServerState = {
  sessionPanes: Map<string, Map<string, string>>;
  ptyToPane: Map<string, { sessionId: string; paneId: string }>;
  clientIds: Map<net.Socket, string>;
  revokedClientIds: Set<string>;
  ptySubscriptions: PtySubscriptions;
  lifecycleUnsub: (() => void) | null;
  titleUnsub: (() => void) | null;
  activeClient: net.Socket | null;
  activeClientId: string | null;
  hostColorsSet: boolean;
};

export function createShimServerState(): ShimServerState {
  return {
    sessionPanes: new Map(),
    ptyToPane: new Map(),
    clientIds: new Map(),
    revokedClientIds: new Set(),
    ptySubscriptions: new Map(),
    lifecycleUnsub: null,
    titleUnsub: null,
    activeClient: null,
    activeClientId: null,
    hostColorsSet: false,
  };
}

export function resetShimServerState(state: ShimServerState): void {
  state.sessionPanes.clear();
  state.ptyToPane.clear();
  state.clientIds.clear();
  state.revokedClientIds.clear();
  state.ptySubscriptions.clear();
  state.lifecycleUnsub = null;
  state.titleUnsub = null;
  state.activeClient = null;
  state.activeClientId = null;
  state.hostColorsSet = false;
}
