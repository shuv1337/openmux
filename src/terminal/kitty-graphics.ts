/**
 * Kitty graphics renderer for openmux.
 * Converts ghostty-vt kitty image/placement state into host kitty commands.
 */

import { Buffer } from 'buffer';
import { getHostCapabilities } from './capabilities';
import {
  KittyGraphicsFormat,
  type ITerminalEmulator,
  type KittyGraphicsImageInfo,
  type KittyGraphicsPlacement,
} from './emulator-interface';

const ESC = '\x1b';
const KITTY_ESCAPE = `${ESC}_G`;
const KITTY_END = `${ESC}\\`;
const BASE64_CHUNK_SIZE = 4096;

type RendererLike = {
  resolution?: { width: number; height: number } | null;
  terminalWidth?: number;
  terminalHeight?: number;
  width?: number;
  height?: number;
  writeOut?: (chunk: string) => void;
  stdout?: NodeJS.WriteStream;
  realStdoutWrite?: (chunk: any, encoding?: any, callback?: any) => boolean;
};

type PaneState = {
  ptyId: string | null;
  emulator: ITerminalEmulator | null;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
  cols: number;
  rows: number;
  viewportOffset: number;
  scrollbackLength: number;
  isAlternateScreen: boolean;
  needsClear: boolean;
  removed: boolean;
};

type PtyKittyState = {
  screenIsAlternate: boolean;
  images: Map<number, ImageCache>;
  placements: KittyGraphicsPlacement[];
};

type ImageCache = {
  hostId: number;
  info: KittyGraphicsImageInfo;
};

type PlacementRender = {
  key: string;
  imageId: number;
  hostImageId: number;
  hostPlacementId: number;
  globalRow: number;
  globalCol: number;
  columns: number;
  rows: number;
  xOffset: number;
  yOffset: number;
  sourceX: number;
  sourceY: number;
  sourceWidth: number;
  sourceHeight: number;
  z: number;
};

let activeKittyRenderer: KittyGraphicsRenderer | null = null;

export function getKittyGraphicsRenderer(): KittyGraphicsRenderer | null {
  return activeKittyRenderer;
}

export function setKittyGraphicsRenderer(renderer: KittyGraphicsRenderer | null): void {
  activeKittyRenderer = renderer;
}

export class KittyGraphicsRenderer {
  private panes = new Map<string, PaneState>();
  private ptyStates = new Map<string, PtyKittyState>();
  private placementsByPane = new Map<string, Map<string, PlacementRender>>();
  private nextHostImageId = 1;
  private nextHostPlacementId = 1;
  private enabled = getHostCapabilities()?.kittyGraphics ?? false;

  updatePane(paneKey: string, state: Omit<PaneState, 'needsClear' | 'removed'>): void {
    const existing = this.panes.get(paneKey);
    if (existing) {
      if (existing.ptyId !== state.ptyId) {
        existing.needsClear = true;
      }
      existing.ptyId = state.ptyId;
      existing.emulator = state.emulator;
      existing.offsetX = state.offsetX;
      existing.offsetY = state.offsetY;
      existing.width = state.width;
      existing.height = state.height;
      existing.cols = state.cols;
      existing.rows = state.rows;
      existing.viewportOffset = state.viewportOffset;
      existing.scrollbackLength = state.scrollbackLength;
      existing.isAlternateScreen = state.isAlternateScreen;
      existing.removed = false;
      return;
    }

    this.panes.set(paneKey, { ...state, needsClear: false, removed: false });
  }

  removePane(paneKey: string): void {
    const pane = this.panes.get(paneKey);
    if (pane) {
      pane.removed = true;
    }
  }

  dispose(): void {
    this.panes.clear();
    this.ptyStates.clear();
    this.placementsByPane.clear();
  }

  flush(renderer: RendererLike): void {
    if (!this.enabled) return;

    const metrics = this.getCellMetrics(renderer);
    if (!metrics) return;

    const writeOut = this.getWriter(renderer);
    if (!writeOut) return;

    const output: string[] = [];
    const activePtys = new Set<string>();

    for (const pane of this.panes.values()) {
      if (pane.removed || !pane.ptyId || !pane.emulator) {
        continue;
      }
      activePtys.add(pane.ptyId);
    }

    const updatedPtys = new Set<string>();
    for (const pane of this.panes.values()) {
      if (pane.removed || !pane.ptyId || !pane.emulator) continue;
      if (updatedPtys.has(pane.ptyId)) continue;
      updatedPtys.add(pane.ptyId);

      this.updatePtyState(pane.ptyId, pane.emulator, pane.isAlternateScreen, output);
    }

    for (const [paneKey, pane] of this.panes) {
      if (pane.removed || !pane.ptyId || !pane.emulator) {
        this.clearPanePlacements(paneKey, output);
        if (pane.removed) {
          this.panes.delete(paneKey);
        }
        continue;
      }

      if (pane.needsClear) {
        this.clearPanePlacements(paneKey, output);
        pane.needsClear = false;
      }

      const ptyState = this.ptyStates.get(pane.ptyId);
      if (!ptyState) continue;

      this.renderPanePlacements(paneKey, pane, ptyState, metrics, output);
    }

    for (const [ptyId, ptyState] of this.ptyStates) {
      if (!activePtys.has(ptyId)) {
        for (const image of ptyState.images.values()) {
          output.push(this.buildDeleteImage(image.hostId));
        }
        this.ptyStates.delete(ptyId);
      }
    }

    if (output.length === 0) return;
    writeOut(output.join(''));
  }

  private getCellMetrics(renderer: RendererLike): { cellWidth: number; cellHeight: number } | null {
    const resolution = renderer.resolution ?? null;
    const terminalWidth = renderer.width || renderer.terminalWidth || 0;
    const terminalHeight = renderer.height || renderer.terminalHeight || 0;
    if (!resolution || terminalWidth <= 0 || terminalHeight <= 0) return null;

    const cellWidth = Math.max(1, Math.floor(resolution.width / terminalWidth));
    const cellHeight = Math.max(1, Math.floor(resolution.height / terminalHeight));
    return { cellWidth, cellHeight };
  }

  private getWriter(renderer: RendererLike): ((chunk: string) => void) | null {
    if (typeof renderer.writeOut === 'function') {
      return renderer.writeOut.bind(renderer);
    }

    const stdout = renderer.stdout ?? process.stdout;
    const writer = renderer.realStdoutWrite ?? stdout.write.bind(stdout);
    if (!writer) return null;

    return (chunk: string) => {
      writer.call(stdout, chunk);
    };
  }

  private updatePtyState(
    ptyId: string,
    emulator: ITerminalEmulator,
    isAlternateScreen: boolean,
    output: string[]
  ): void {
    const supportsKitty = !!emulator.getKittyImageIds && !!emulator.getKittyPlacements;
    if (!supportsKitty) return;

    const existing = this.ptyStates.get(ptyId);
    const dirty = emulator.getKittyImagesDirty?.() ?? false;

    if (!existing || existing.screenIsAlternate !== isAlternateScreen) {
      if (existing) {
        for (const image of existing.images.values()) {
          output.push(this.buildDeleteImage(image.hostId));
        }
      }
      this.ptyStates.set(ptyId, {
        screenIsAlternate: isAlternateScreen,
        images: new Map(),
        placements: [],
      });
    } else if (!dirty) {
      return;
    }

    const state = this.ptyStates.get(ptyId);
    if (!state) return;

    const ids = emulator.getKittyImageIds?.() ?? [];
    const nextImages = new Map<number, ImageCache>();

    for (const id of ids) {
      const info = emulator.getKittyImageInfo?.(id);
      if (!info) continue;

      const previous = state.images.get(id);
      const hostId = previous?.hostId ?? this.nextHostImageId++;
      const changed = !previous || !this.isSameImage(previous.info, info);

      if (changed) {
        const data = emulator.getKittyImageData?.(id);
        if (data) {
          const transmit = this.buildTransmitImage(hostId, info, data);
          if (transmit) {
            output.push(transmit);
          }
        }
      }

      nextImages.set(id, { hostId, info });
    }

    for (const [id, image] of state.images) {
      if (!nextImages.has(id)) {
        output.push(this.buildDeleteImage(image.hostId));
        this.deletePlacementsForImage(id, output);
      }
    }

    state.images = nextImages;
    state.placements = emulator.getKittyPlacements?.() ?? [];
    emulator.clearKittyImagesDirty?.();
  }

  private isSameImage(a: KittyGraphicsImageInfo, b: KittyGraphicsImageInfo): boolean {
    return (
      a.transmitTime === b.transmitTime &&
      a.dataLength === b.dataLength &&
      a.width === b.width &&
      a.height === b.height &&
      a.format === b.format &&
      a.compression === b.compression
    );
  }

  private deletePlacementsForImage(imageId: number, output: string[]): void {
    for (const [paneKey, placements] of this.placementsByPane) {
      for (const [key, placement] of placements) {
        if (placement.imageId !== imageId) continue;
        output.push(this.buildDeletePlacement(placement.hostImageId, placement.hostPlacementId));
        placements.delete(key);
      }
      if (placements.size === 0) {
        this.placementsByPane.delete(paneKey);
      }
    }
  }

  private clearPanePlacements(paneKey: string, output: string[]): void {
    const placements = this.placementsByPane.get(paneKey);
    if (!placements) return;

    for (const placement of placements.values()) {
      output.push(this.buildDeletePlacement(placement.hostImageId, placement.hostPlacementId));
    }
    this.placementsByPane.delete(paneKey);
  }

  private renderPanePlacements(
    paneKey: string,
    pane: PaneState,
    state: PtyKittyState,
    metrics: { cellWidth: number; cellHeight: number },
    output: string[]
  ): void {
    const prevPlacements = this.placementsByPane.get(paneKey) ?? new Map<string, PlacementRender>();
    const nextPlacements = new Map<string, PlacementRender>();

    for (const placement of state.placements) {
      const image = state.images.get(placement.imageId);
      if (!image) continue;

      const render = this.computePlacementRender(pane, placement, image.info, metrics);
      if (!render) continue;

      const existing = prevPlacements.get(render.key);
      const hostPlacementId = existing?.hostPlacementId ?? this.nextHostPlacementId++;
      const renderState: PlacementRender = { ...render, hostImageId: image.hostId, hostPlacementId };

      nextPlacements.set(render.key, renderState);
      if (!existing || !this.isSameRender(existing, renderState)) {
        output.push(this.buildDisplay(renderState));
      }
    }

    for (const [key, placement] of prevPlacements) {
      if (nextPlacements.has(key)) continue;
      output.push(this.buildDeletePlacement(placement.hostImageId, placement.hostPlacementId));
    }

    if (nextPlacements.size > 0) {
      this.placementsByPane.set(paneKey, nextPlacements);
    } else {
      this.placementsByPane.delete(paneKey);
    }
  }

  private isSameRender(a: PlacementRender, b: PlacementRender): boolean {
    return (
      a.globalRow === b.globalRow &&
      a.globalCol === b.globalCol &&
      a.columns === b.columns &&
      a.rows === b.rows &&
      a.xOffset === b.xOffset &&
      a.yOffset === b.yOffset &&
      a.sourceX === b.sourceX &&
      a.sourceY === b.sourceY &&
      a.sourceWidth === b.sourceWidth &&
      a.sourceHeight === b.sourceHeight &&
      a.z === b.z &&
      a.hostImageId === b.hostImageId
    );
  }

  private computePlacementRender(
    pane: PaneState,
    placement: KittyGraphicsPlacement,
    image: KittyGraphicsImageInfo,
    metrics: { cellWidth: number; cellHeight: number }
  ): PlacementRender | null {
    const { cellWidth, cellHeight } = metrics;

    const viewportRow = placement.screenY - (pane.scrollbackLength - pane.viewportOffset);
    const viewportCol = placement.screenX;

    const srcWidth = placement.sourceWidth > 0 ? placement.sourceWidth : image.width;
    const srcHeight = placement.sourceHeight > 0 ? placement.sourceHeight : image.height;
    if (srcWidth <= 0 || srcHeight <= 0) return null;

    const dest = this.computeDestSize(placement, srcWidth, srcHeight, cellWidth, cellHeight);
    if (dest.width <= 0 || dest.height <= 0) return null;

    const gridCols = Math.ceil((dest.width + placement.xOffset) / cellWidth);
    const gridRows = Math.ceil((dest.height + placement.yOffset) / cellHeight);
    if (gridCols <= 0 || gridRows <= 0) return null;

    const left = viewportCol;
    const top = viewportRow;
    const right = viewportCol + gridCols;
    const bottom = viewportRow + gridRows;

    const visibleLeft = Math.max(0, left);
    const visibleTop = Math.max(0, top);
    const visibleRight = Math.min(pane.cols, right);
    const visibleBottom = Math.min(pane.rows, bottom);

    if (visibleRight <= visibleLeft || visibleBottom <= visibleTop) return null;

    const visibleLeftPx = (visibleLeft - left) * cellWidth;
    const visibleTopPx = (visibleTop - top) * cellHeight;
    const visibleRightPx = (visibleRight - left) * cellWidth;
    const visibleBottomPx = (visibleBottom - top) * cellHeight;

    const imageLeftPx = placement.xOffset;
    const imageTopPx = placement.yOffset;
    const imageRightPx = placement.xOffset + dest.width;
    const imageBottomPx = placement.yOffset + dest.height;

    const cropLeftPx = Math.max(0, visibleLeftPx - imageLeftPx);
    const cropTopPx = Math.max(0, visibleTopPx - imageTopPx);
    const cropRightPx = Math.max(0, imageRightPx - visibleRightPx);
    const cropBottomPx = Math.max(0, imageBottomPx - visibleBottomPx);

    const croppedWidth = dest.width - cropLeftPx - cropRightPx;
    const croppedHeight = dest.height - cropTopPx - cropBottomPx;
    if (croppedWidth <= 0 || croppedHeight <= 0) return null;

    const scaleX = srcWidth / dest.width;
    const scaleY = srcHeight / dest.height;
    const cropLeftSrc = Math.round(cropLeftPx * scaleX);
    const cropTopSrc = Math.round(cropTopPx * scaleY);
    const cropRightSrc = Math.round(cropRightPx * scaleX);
    const cropBottomSrc = Math.round(cropBottomPx * scaleY);

    const sourceX = placement.sourceX + cropLeftSrc;
    const sourceY = placement.sourceY + cropTopSrc;
    const sourceWidth = srcWidth - cropLeftSrc - cropRightSrc;
    const sourceHeight = srcHeight - cropTopSrc - cropBottomSrc;
    if (sourceWidth <= 0 || sourceHeight <= 0) return null;

    const xOffset = Math.max(0, imageLeftPx - visibleLeftPx);
    const yOffset = Math.max(0, imageTopPx - visibleTopPx);

    const columns = Math.max(1, visibleRight - visibleLeft);
    const rows = Math.max(1, visibleBottom - visibleTop);

    return {
      key: this.buildPlacementKey(placement),
      imageId: placement.imageId,
      hostImageId: 0,
      hostPlacementId: 0,
      globalRow: pane.offsetY + visibleTop,
      globalCol: pane.offsetX + visibleLeft,
      columns,
      rows,
      xOffset,
      yOffset,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      z: placement.z,
    };
  }

  private computeDestSize(
    placement: KittyGraphicsPlacement,
    srcWidth: number,
    srcHeight: number,
    cellWidth: number,
    cellHeight: number
  ): { width: number; height: number } {
    if (placement.columns > 0 && placement.rows > 0) {
      return {
        width: placement.columns * cellWidth,
        height: placement.rows * cellHeight,
      };
    }

    if (placement.columns > 0) {
      const width = placement.columns * cellWidth;
      const height = Math.round((width * srcHeight) / Math.max(srcWidth, 1));
      return { width, height };
    }

    if (placement.rows > 0) {
      const height = placement.rows * cellHeight;
      const width = Math.round((height * srcWidth) / Math.max(srcHeight, 1));
      return { width, height };
    }

    return { width: srcWidth, height: srcHeight };
  }

  private buildPlacementKey(placement: KittyGraphicsPlacement): string {
    return `${placement.imageId}:${placement.placementTag}:${placement.placementId}`;
  }

  private buildTransmitImage(hostId: number, info: KittyGraphicsImageInfo, data: Uint8Array): string {
    const prepared = this.prepareImageData(info, data);
    if (!prepared) {
      return '';
    }
    const { format, payload } = prepared;
    const params: Array<[string, string | number]> = [
      ['a', 't'],
      ['q', 2],
      ['f', format],
      ['t', 'd'],
      ['s', info.width],
      ['v', info.height],
      ['i', hostId],
    ];

    const buffer = Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength);
    const encoded = buffer.toString('base64');
    const chunks: string[] = [];

    for (let offset = 0; offset < encoded.length; offset += BASE64_CHUNK_SIZE) {
      const chunk = encoded.slice(offset, offset + BASE64_CHUNK_SIZE);
      const more = offset + BASE64_CHUNK_SIZE < encoded.length;
      const chunkParams = more ? [...params, ['m', 1]] : params;
      chunks.push(this.buildKittyCommand(chunkParams, chunk));
    }

    return chunks.join('');
  }

  private prepareImageData(
    info: KittyGraphicsImageInfo,
    data: Uint8Array
  ): { format: number; payload: Uint8Array } | null {
    switch (info.format) {
      case KittyGraphicsFormat.RGB:
        return { format: 24, payload: data };
      case KittyGraphicsFormat.RGBA:
        return { format: 32, payload: data };
      case KittyGraphicsFormat.PNG: {
        const expected = info.width * info.height * 4;
        if (data.byteLength !== expected) {
          return { format: 100, payload: data };
        }
        return { format: 32, payload: data };
      }
      case KittyGraphicsFormat.GRAY:
        return { format: 32, payload: this.expandGray(data) };
      case KittyGraphicsFormat.GRAY_ALPHA:
        return { format: 32, payload: this.expandGrayAlpha(data) };
      default:
        return null;
    }
  }

  private expandGray(data: Uint8Array): Uint8Array {
    const out = new Uint8Array(data.byteLength * 4);
    let outIdx = 0;
    for (let i = 0; i < data.byteLength; i++) {
      const v = data[i] ?? 0;
      out[outIdx++] = v;
      out[outIdx++] = v;
      out[outIdx++] = v;
      out[outIdx++] = 255;
    }
    return out;
  }

  private expandGrayAlpha(data: Uint8Array): Uint8Array {
    const pixels = Math.floor(data.byteLength / 2);
    const out = new Uint8Array(pixels * 4);
    let outIdx = 0;
    for (let i = 0; i < pixels; i++) {
      const gray = data[i * 2] ?? 0;
      const alpha = data[i * 2 + 1] ?? 255;
      out[outIdx++] = gray;
      out[outIdx++] = gray;
      out[outIdx++] = gray;
      out[outIdx++] = alpha;
    }
    return out;
  }

  private buildDisplay(render: PlacementRender): string {
    const params: Array<[string, string | number]> = [
      ['a', 'p'],
      ['q', 2],
      ['C', 1],
      ['i', render.hostImageId],
      ['p', render.hostPlacementId],
      ['c', render.columns],
      ['r', render.rows],
    ];

    if (render.sourceX > 0) params.push(['x', render.sourceX]);
    if (render.sourceY > 0) params.push(['y', render.sourceY]);
    if (render.sourceWidth > 0) params.push(['w', render.sourceWidth]);
    if (render.sourceHeight > 0) params.push(['h', render.sourceHeight]);
    if (render.xOffset > 0) params.push(['X', render.xOffset]);
    if (render.yOffset > 0) params.push(['Y', render.yOffset]);
    if (render.z !== 0) params.push(['z', render.z]);

    const position = `${ESC}[${render.globalRow + 1};${render.globalCol + 1}H`;
    return `${ESC}7${position}${this.buildKittyCommand(params)}${ESC}8`;
  }

  private buildDeletePlacement(hostImageId: number, hostPlacementId: number): string {
    return this.buildKittyCommand([
      ['a', 'd'],
      ['q', 2],
      ['d', 'i'],
      ['i', hostImageId],
      ['p', hostPlacementId],
    ]);
  }

  private buildDeleteImage(hostImageId: number): string {
    return this.buildKittyCommand([
      ['a', 'd'],
      ['q', 2],
      ['d', 'I'],
      ['i', hostImageId],
    ]);
  }

  private buildKittyCommand(params: Array<[string, string | number]>, data = ''): string {
    const control = params.map(([key, value]) => `${key}=${value}`).join(',');
    return `${KITTY_ESCAPE}${control};${data}${KITTY_END}`;
  }
}
