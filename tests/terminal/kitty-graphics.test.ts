import { describe, expect, it, beforeAll, vi } from 'vitest';
import type { ITerminalEmulator } from '../../src/terminal/emulator-interface';
import {
  KittyGraphicsCompression,
  KittyGraphicsFormat,
  KittyGraphicsPlacementTag,
} from '../../src/terminal/emulator-interface';

vi.mock('../../src/terminal/capabilities', () => ({
  getHostCapabilities: () => ({
    terminalName: 'kitty',
    da1Response: null,
    da2Response: null,
    xtversionResponse: null,
    kittyGraphics: true,
    sixel: false,
    trueColor: true,
    colors: null,
  }),
}));

let KittyGraphicsRenderer: typeof import('../../src/terminal/kitty-graphics').KittyGraphicsRenderer;

beforeAll(async () => {
  ({ KittyGraphicsRenderer } = await import('../../src/terminal/kitty-graphics'));
});

describe('KittyGraphicsRenderer', () => {
  it('litmus: transmits and displays kitty graphics', () => {
    const renderer = new KittyGraphicsRenderer();
    const output: string[] = [];
    const renderTarget = {
      resolution: { width: 10, height: 10 },
      terminalWidth: 10,
      terminalHeight: 10,
      writeOut: (chunk: string) => output.push(chunk),
    };

    let dirty = true;
    const imageInfo = {
      id: 1,
      number: 0,
      width: 1,
      height: 1,
      dataLength: 3,
      format: KittyGraphicsFormat.RGB,
      compression: KittyGraphicsCompression.NONE,
      implicitId: false,
      transmitTime: 1n,
    };
    const placement = {
      imageId: 1,
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
      columns: 1,
      rows: 1,
      z: 0,
    };
    const emulator = {
      getKittyImagesDirty: () => dirty,
      clearKittyImagesDirty: () => {
        dirty = false;
      },
      getKittyImageIds: () => [1],
      getKittyImageInfo: () => imageInfo,
      getKittyImageData: () => new Uint8Array([255, 0, 0]),
      getKittyPlacements: () => [placement],
    } as ITerminalEmulator;

    renderer.updatePane('pane-1', {
      ptyId: 'pty-1',
      emulator,
      offsetX: 0,
      offsetY: 0,
      width: 10,
      height: 10,
      cols: 10,
      rows: 10,
      viewportOffset: 0,
      scrollbackLength: 0,
      isAlternateScreen: false,
    });

    renderer.flush(renderTarget);

    const joined = output.join('');
    expect(joined).toContain('\x1b_Ga=t');
    expect(joined).toContain('\x1b_Ga=p');
    expect(dirty).toBe(false);
  });

  it('clears placements when panes are removed', () => {
    const renderer = new KittyGraphicsRenderer();
    const output: string[] = [];
    const renderTarget = {
      resolution: { width: 10, height: 10 },
      terminalWidth: 10,
      terminalHeight: 10,
      writeOut: (chunk: string) => output.push(chunk),
    };

    let dirty = true;
    const imageInfo = {
      id: 2,
      number: 0,
      width: 1,
      height: 1,
      dataLength: 3,
      format: KittyGraphicsFormat.RGB,
      compression: KittyGraphicsCompression.NONE,
      implicitId: false,
      transmitTime: 2n,
    };
    const placement = {
      imageId: 2,
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
      columns: 1,
      rows: 1,
      z: 0,
    };
    const emulator = {
      getKittyImagesDirty: () => dirty,
      clearKittyImagesDirty: () => {
        dirty = false;
      },
      getKittyImageIds: () => [2],
      getKittyImageInfo: () => imageInfo,
      getKittyImageData: () => new Uint8Array([0, 255, 0]),
      getKittyPlacements: () => [placement],
    } as ITerminalEmulator;

    renderer.updatePane('pane-2', {
      ptyId: 'pty-2',
      emulator,
      offsetX: 0,
      offsetY: 0,
      width: 10,
      height: 10,
      cols: 10,
      rows: 10,
      viewportOffset: 0,
      scrollbackLength: 0,
      isAlternateScreen: false,
    });

    renderer.flush(renderTarget);
    output.length = 0;

    renderer.removePane('pane-2');
    renderer.flush(renderTarget);

    const joined = output.join('');
    expect(joined).toContain('a=d');
    expect(joined).toContain('d=i');
    expect(joined).toContain('d=I');
  });
});
