import assert from 'assert';
import type { ITerminalEmulator } from '../src/terminal/emulator-interface';
import {
  KittyGraphicsCompression,
  KittyGraphicsFormat,
  KittyGraphicsPlacementTag,
} from '../src/terminal/emulator-interface';
import { detectHostCapabilities } from '../src/terminal/capabilities';
import {
  KittyGraphicsRenderer,
  KittyTransmitBroker,
  KittyTransmitRelay,
  setKittyTransmitBroker,
} from '../src/terminal/kitty-graphics';

const ESC = '\x1b';

process.env.KITTY_WINDOW_ID ??= '1';
process.env.TERM_PROGRAM ??= 'kitty';
await detectHostCapabilities();

const relay = new KittyTransmitRelay({ stubAllFormats: true, stubSharedMemory: true });
const broker = new KittyTransmitBroker();
const hostWrites: string[] = [];
broker.setWriter((chunk) => hostWrites.push(chunk));
setKittyTransmitBroker(broker);

const sharedSequence = `${ESC}_Ga=t,t=s,s=10,v=12,i=7;SHMKEY${ESC}\\`;
const relayResult = relay.handleSequence('pty-1', sharedSequence);

assert(relayResult.forwardSequence === sharedSequence, 'relay should forward shared memory untouched');
assert(relayResult.emuSequence.includes('f=100'), 'relay should stub shared memory as png');
assert(!relayResult.emuSequence.includes('t=s'), 'relay stub should drop shared memory medium');
assert(!relayResult.emuSequence.includes('SHMKEY'), 'relay stub should not include shm payload');

broker.handleSequence('pty-1', relayResult.forwardSequence ?? '', false);
assert(hostWrites.length === 1, 'broker should write to host');
assert(hostWrites[0].includes('t=s'), 'broker should preserve shared memory medium');

const renderer = new KittyGraphicsRenderer();
const output: string[] = [];
const renderTarget = {
  resolution: { width: 100, height: 50 },
  terminalWidth: 10,
  terminalHeight: 5,
  writeOut: (chunk: string) => output.push(chunk),
};

let dirty = true;
let isAlternate = false;
const imageInfo = {
  id: 7,
  number: 0,
  width: 10,
  height: 12,
  dataLength: 4,
  format: KittyGraphicsFormat.RGBA,
  compression: KittyGraphicsCompression.NONE,
  implicitId: false,
  transmitTime: 7n,
};
const placement = {
  imageId: 7,
  placementId: 1,
  placementTag: KittyGraphicsPlacementTag.INTERNAL,
  screenX: 0,
  screenY: 0,
  xOffset: 0,
  yOffset: 0,
  sourceX: 0,
  sourceY: 0,
  sourceWidth: 0,
  sourceHeight: 0,
  columns: 2,
  rows: 2,
  z: 0,
};
const emulator = {
  getKittyImagesDirty: () => dirty,
  clearKittyImagesDirty: () => {
    dirty = false;
  },
  getKittyImageIds: () => (isAlternate ? [] : [7]),
  getKittyImageInfo: () => imageInfo,
  getKittyImageData: () => new Uint8Array([255, 0, 0, 255]),
  getKittyPlacements: () => (isAlternate ? [] : [placement]),
} as ITerminalEmulator;

renderer.updatePane('pane-1', {
  ptyId: 'pty-1',
  emulator,
  offsetX: 0,
  offsetY: 0,
  width: 10,
  height: 5,
  cols: 10,
  rows: 5,
  viewportOffset: 0,
  scrollbackLength: 0,
  isAlternateScreen: isAlternate,
});
renderer.flush(renderTarget);
assert(output.join('').includes('\x1b_Ga=p'), 'main screen should render placement');

output.length = 0;
isAlternate = true;
renderer.updatePane('pane-1', {
  ptyId: 'pty-1',
  emulator,
  offsetX: 0,
  offsetY: 0,
  width: 10,
  height: 5,
  cols: 10,
  rows: 5,
  viewportOffset: 0,
  scrollbackLength: 0,
  isAlternateScreen: isAlternate,
});
renderer.flush(renderTarget);

output.length = 0;
isAlternate = false;
renderer.updatePane('pane-1', {
  ptyId: 'pty-1',
  emulator,
  offsetX: 0,
  offsetY: 0,
  width: 10,
  height: 5,
  cols: 10,
  rows: 5,
  viewportOffset: 0,
  scrollbackLength: 0,
  isAlternateScreen: isAlternate,
});
renderer.flush(renderTarget);
assert(output.join('').includes('\x1b_Ga=p'), 'main screen should re-render from cached placements');

console.log('kitty shm harness ok');
