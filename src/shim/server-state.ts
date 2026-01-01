import type net from 'net';
import type { ITerminalEmulator, KittyGraphicsImageInfo } from '../terminal/emulator-interface';

type PtySubscriptions = Map<string, { unifiedUnsub: () => void; exitUnsub: () => void }>;

export type ShimServerState = {
  sessionPanes: Map<string, Map<string, string>>;
  ptyToPane: Map<string, { sessionId: string; paneId: string }>;
  clientIds: Map<net.Socket, string>;
  revokedClientIds: Set<string>;
  ptySubscriptions: PtySubscriptions;
  ptyEmulators: Map<string, ITerminalEmulator>;
  kittyImages: Map<string, Map<number, KittyGraphicsImageInfo>>;
  kittyTransmitCache: Map<string, Map<string, string[]>>;
  kittyTransmitPending: Map<string, Map<string, string[]>>;
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
    ptyEmulators: new Map(),
    kittyImages: new Map(),
    kittyTransmitCache: new Map(),
    kittyTransmitPending: new Map(),
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
  state.ptyEmulators.clear();
  state.kittyImages.clear();
  state.kittyTransmitCache.clear();
  state.kittyTransmitPending.clear();
  state.lifecycleUnsub = null;
  state.titleUnsub = null;
  state.activeClient = null;
  state.activeClientId = null;
  state.hostColorsSet = false;
}
