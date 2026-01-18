/**
 * ArchivedTerminalEmulator - wraps a live emulator with a scrollback archive.
 */

import type {
  TerminalCell,
  TerminalState,
  TerminalScrollState,
  DirtyTerminalUpdate,
} from "../core/types"
import type {
  ITerminalEmulator,
  SearchResult,
  TerminalModes,
  KittyGraphicsImageInfo,
  KittyGraphicsPlacement,
} from "./emulator-interface"
import type { TerminalColors } from "./terminal-colors"
import { searchTerminal } from "./ghostty-vt/terminal-search"
import { createEmptyRow } from "./ghostty-emulator/cell-converter"
import type { ScrollbackArchive } from "./scrollback-archive"

export class ArchivedTerminalEmulator implements ITerminalEmulator {
  constructor(
    private base: ITerminalEmulator,
    private archive: ScrollbackArchive
  ) {}

  get cols(): number {
    return this.base.cols
  }

  get rows(): number {
    return this.base.rows
  }

  get isDisposed(): boolean {
    return this.base.isDisposed
  }

  write(data: string | Uint8Array): void {
    this.base.write(data)
  }

  resize(cols: number, rows: number): void {
    this.base.resize(cols, rows)
  }

  setPixelSize(widthPx: number, heightPx: number): void {
    this.base.setPixelSize?.(widthPx, heightPx)
  }

  reset(): void {
    this.base.reset()
  }

  dispose(): void {
    this.base.dispose()
    this.archive.dispose()
  }

  getScrollbackLength(): number {
    return this.archive.length + this.base.getScrollbackLength()
  }

  getScrollbackLine(offset: number): TerminalCell[] | null {
    const archiveLength = this.archive.length
    if (offset < archiveLength) {
      return this.archive.getLine(offset)
    }
    return this.base.getScrollbackLine(offset - archiveLength)
  }

  prefetchScrollbackLines?(startOffset: number, count: number): Promise<void> {
    const archiveLength = this.archive.length
    if (startOffset < archiveLength) {
      const archiveCount = Math.min(count, archiveLength - startOffset)
      this.archive.prefetchLines(startOffset, archiveCount)
    }
    return Promise.resolve()
  }

  getDirtyUpdate(scrollState: TerminalScrollState): DirtyTerminalUpdate {
    return this.base.getDirtyUpdate(scrollState)
  }

  getTerminalState(): TerminalState {
    return this.base.getTerminalState()
  }

  getCursor(): { x: number; y: number; visible: boolean } {
    return this.base.getCursor()
  }

  getCursorKeyMode(): "normal" | "application" {
    return this.base.getCursorKeyMode()
  }

  getKittyKeyboardFlags(): number {
    return this.base.getKittyKeyboardFlags()
  }

  isMouseTrackingEnabled(): boolean {
    return this.base.isMouseTrackingEnabled()
  }

  isAlternateScreen(): boolean {
    return this.base.isAlternateScreen()
  }

  getMode(mode: number): boolean {
    return this.base.getMode(mode)
  }

  getColors(): TerminalColors {
    return this.base.getColors()
  }

  setColors(colors: TerminalColors): void {
    this.base.setColors?.(colors)
  }

  getTitle(): string {
    return this.base.getTitle()
  }

  onTitleChange(callback: (title: string) => void): () => void {
    return this.base.onTitleChange(callback)
  }

  onUpdate(callback: () => void): () => void {
    return this.base.onUpdate(callback)
  }

  setUpdateEnabled(enabled: boolean): void {
    this.base.setUpdateEnabled?.(enabled)
  }

  onModeChange(callback: (modes: TerminalModes, prevModes?: TerminalModes) => void): () => void {
    return this.base.onModeChange(callback)
  }

  getKittyImagesDirty(): boolean {
    return this.base.getKittyImagesDirty?.() ?? false
  }

  clearKittyImagesDirty(): void {
    this.base.clearKittyImagesDirty?.()
  }

  getKittyImageIds(): number[] {
    return this.base.getKittyImageIds?.() ?? []
  }

  getKittyImageInfo(imageId: number): KittyGraphicsImageInfo | null {
    return this.base.getKittyImageInfo?.(imageId) ?? null
  }

  getKittyImageData(imageId: number): Uint8Array | null {
    return this.base.getKittyImageData?.(imageId) ?? null
  }

  getKittyPlacements(): KittyGraphicsPlacement[] {
    return this.base.getKittyPlacements?.() ?? []
  }

  drainResponses(): string[] {
    return this.base.drainResponses?.() ?? []
  }

  async search(query: string, options?: { limit?: number }): Promise<SearchResult> {
    return searchTerminal(query, options, {
      getScrollbackLength: () => this.getScrollbackLength(),
      getScrollbackLine: (offset) => this.getScrollbackLine(offset),
      getTerminalState: () => this.getTerminalState(),
      createEmptyRow: (cols) => createEmptyRow(cols, this.getColors()),
    })
  }
}
