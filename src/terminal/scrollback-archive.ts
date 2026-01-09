/**
 * Disk-backed scrollback archive for terminal history.
 */

import fs from "node:fs"
import path from "node:path"
import type { TerminalCell } from "../core/types"
import { packRow, unpackRow, CELL_SIZE } from "./cell-serialization"
import { ScrollbackCache } from "./emulator-utils/scrollback-cache"
import {
  SCROLLBACK_ARCHIVE_CHUNK_MAX_LINES,
  SCROLLBACK_ARCHIVE_MAX_BYTES_PER_PTY,
} from "./scrollback-config"

type ArchiveChunk = {
  id: number
  filename: string
  path: string
  cols: number
  rowBytes: number
  lineCount: number
  bytes: number
  createdAt: number
}

type ArchiveMeta = {
  version: number
  nextChunkId: number
  chunks: Array<{
    id: number
    filename: string
    cols: number
    rowBytes: number
    lineCount: number
    bytes: number
    createdAt: number
  }>
}

export class ScrollbackArchive {
  private readonly rootDir: string
  private readonly metaPath: string
  private readonly maxBytes: number
  private readonly chunkMaxLines: number
  private readonly cache: ScrollbackCache
  private readonly manager?: ScrollbackArchiveManager
  private chunks: ArchiveChunk[] = []
  private totalLines = 0
  private totalBytes = 0
  private nextChunkId = 1

  constructor(options: {
    rootDir: string
    maxBytes?: number
    chunkMaxLines?: number
    cacheSize?: number
    manager?: ScrollbackArchiveManager
  }) {
    this.rootDir = options.rootDir
    this.metaPath = path.join(this.rootDir, "meta.json")
    this.maxBytes = options.maxBytes ?? SCROLLBACK_ARCHIVE_MAX_BYTES_PER_PTY
    this.chunkMaxLines = options.chunkMaxLines ?? SCROLLBACK_ARCHIVE_CHUNK_MAX_LINES
    this.cache = new ScrollbackCache(options.cacheSize ?? 4000)
    this.manager = options.manager

    this.ensureDir()
    this.loadMeta()
    this.manager?.register(this)
    this.enforceLimit()
    this.manager?.enforceGlobalLimit()
  }

  get length(): number {
    return this.totalLines
  }

  get bytes(): number {
    return this.totalBytes
  }

  getOldestChunk(): ArchiveChunk | null {
    return this.chunks.length > 0 ? this.chunks[0] : null
  }

  clearCache(): void {
    this.cache.clear()
  }

  reset(): void {
    for (const chunk of this.chunks) {
      try {
        fs.unlinkSync(chunk.path)
      } catch {
        // Ignore cleanup errors.
      }
    }
    this.chunks = []
    this.totalLines = 0
    this.totalBytes = 0
    this.nextChunkId = 1
    this.cache.clear()
    this.flushMeta()
  }

  dispose(): void {
    this.reset()
    this.manager?.unregister(this)
  }

  appendLines(lines: TerminalCell[][]): void {
    if (lines.length === 0) return

    this.ensureDir()

    let currentChunk = this.chunks[this.chunks.length - 1] ?? null
    let buffered: Buffer[] = []
    let bufferedBytes = 0

    const flushBuffer = () => {
      if (!currentChunk || buffered.length === 0) return
      const payload = buffered.length === 1 ? buffered[0] : Buffer.concat(buffered, bufferedBytes)
      fs.appendFileSync(currentChunk.path, payload)
      buffered = []
      bufferedBytes = 0
    }

    for (const line of lines) {
      if (line.length === 0) continue
      const cols = line.length
      const rowBytes = 4 + cols * CELL_SIZE

      if (
        !currentChunk ||
        currentChunk.cols !== cols ||
        currentChunk.lineCount >= this.chunkMaxLines
      ) {
        flushBuffer()
        currentChunk = this.createChunk(cols, rowBytes)
        this.chunks.push(currentChunk)
      }

      const packed = Buffer.from(packRow(line))
      buffered.push(packed)
      bufferedBytes += packed.byteLength
      currentChunk.lineCount += 1
      currentChunk.bytes += rowBytes
      this.totalLines += 1
      this.totalBytes += rowBytes
    }

    flushBuffer()
    this.flushMeta()
    this.enforceLimit()
    this.manager?.enforceGlobalLimit()
  }

  getLine(offset: number): TerminalCell[] | null {
    if (offset < 0 || offset >= this.totalLines) return null
    const cached = this.cache.get(offset)
    if (cached) return cached

    const found = this.findChunk(offset)
    if (!found) return null

    const row = this.readRow(found.chunk, found.chunkStart, found.index)
    if (!row) return null
    return row
  }

  prefetchLines(startOffset: number, count: number): void {
    if (count <= 0) return
    const start = Math.max(0, startOffset)
    const endOffset = Math.min(this.totalLines, start + count)
    for (let offset = start; offset < endOffset; offset++) {
      if (this.cache.get(offset)) continue
      const found = this.findChunk(offset)
      if (!found) break
      this.readChunkRange(found.chunk, found.chunkStart, found.index, 1)
    }
  }

  dropOldestChunk(): { linesRemoved: number; bytesRemoved: number } | null {
    const chunk = this.chunks.shift()
    if (!chunk) return null

    try {
      fs.unlinkSync(chunk.path)
    } catch {
      // Ignore cleanup errors.
    }

    this.totalLines -= chunk.lineCount
    this.totalBytes -= chunk.bytes
    this.cache.clear()
    this.flushMeta()
    return { linesRemoved: chunk.lineCount, bytesRemoved: chunk.bytes }
  }

  private ensureDir(): void {
    fs.mkdirSync(this.rootDir, { recursive: true })
  }

  private createChunk(cols: number, rowBytes: number): ArchiveChunk {
    const id = this.nextChunkId++
    const filename = `chunk-${id}.bin`
    return {
      id,
      filename,
      path: path.join(this.rootDir, filename),
      cols,
      rowBytes,
      lineCount: 0,
      bytes: 0,
      createdAt: Date.now(),
    }
  }

  private findChunk(offset: number): { chunk: ArchiveChunk; chunkStart: number; index: number } | null {
    let start = 0
    for (const chunk of this.chunks) {
      const end = start + chunk.lineCount
      if (offset < end) {
        return { chunk, chunkStart: start, index: offset - start }
      }
      start = end
    }
    return null
  }

  private readRow(
    chunk: ArchiveChunk,
    chunkStart: number,
    index: number
  ): TerminalCell[] | null {
    const row = this.readChunkRange(chunk, chunkStart, index, 1)
    return row.length > 0 ? row[0] : null
  }

  private readChunkRange(
    chunk: ArchiveChunk,
    chunkStart: number,
    index: number,
    count: number
  ): TerminalCell[][] {
    const maxCount = Math.min(count, chunk.lineCount - index)
    if (maxCount <= 0) return []

    const rowBytes = chunk.rowBytes
    const totalBytes = rowBytes * maxCount
    const buffer = Buffer.alloc(totalBytes)
    const offsetBytes = rowBytes * index

    let bytesRead = 0
    let fd: number | null = null
    try {
      fd = fs.openSync(chunk.path, "r")
      bytesRead = fs.readSync(fd, buffer, 0, totalBytes, offsetBytes)
    } catch {
      return []
    } finally {
      if (fd !== null) {
        try {
          fs.closeSync(fd)
        } catch {
          // Ignore close errors.
        }
      }
    }

    if (bytesRead < rowBytes) return []

    const rows: TerminalCell[][] = []
    const totalRows = Math.floor(bytesRead / rowBytes)
    for (let i = 0; i < totalRows; i++) {
      const slice = buffer.subarray(i * rowBytes, (i + 1) * rowBytes)
      const row = unpackRow(toArrayBuffer(slice))
      rows.push(row)
      const absoluteOffset = chunkStart + index + i
      this.cache.set(absoluteOffset, row)
    }

    return rows
  }

  private enforceLimit(): void {
    while (this.totalBytes > this.maxBytes) {
      const removed = this.dropOldestChunk()
      if (!removed) break
    }
  }

  private loadMeta(): void {
    if (!fs.existsSync(this.metaPath)) return
    let parsed: ArchiveMeta | null = null
    try {
      parsed = JSON.parse(fs.readFileSync(this.metaPath, "utf8")) as ArchiveMeta
    } catch {
      return
    }
    if (!parsed || parsed.version !== 1) return

    this.chunks = []
    this.totalLines = 0
    this.totalBytes = 0
    this.nextChunkId = parsed.nextChunkId || 1

    for (const entry of parsed.chunks ?? []) {
      const chunkPath = path.join(this.rootDir, entry.filename)
      if (!fs.existsSync(chunkPath)) continue
      const chunk: ArchiveChunk = {
        id: entry.id,
        filename: entry.filename,
        path: chunkPath,
        cols: entry.cols,
        rowBytes: entry.rowBytes,
        lineCount: entry.lineCount,
        bytes: entry.bytes,
        createdAt: entry.createdAt,
      }
      this.chunks.push(chunk)
      this.totalLines += chunk.lineCount
      this.totalBytes += chunk.bytes
    }

    if (this.chunks.length > 0) {
      const maxId = Math.max(...this.chunks.map((chunk) => chunk.id))
      this.nextChunkId = Math.max(this.nextChunkId, maxId + 1)
    }
  }

  private flushMeta(): void {
    const meta: ArchiveMeta = {
      version: 1,
      nextChunkId: this.nextChunkId,
      chunks: this.chunks.map((chunk) => ({
        id: chunk.id,
        filename: chunk.filename,
        cols: chunk.cols,
        rowBytes: chunk.rowBytes,
        lineCount: chunk.lineCount,
        bytes: chunk.bytes,
        createdAt: chunk.createdAt,
      })),
    }
    try {
      fs.writeFileSync(this.metaPath, JSON.stringify(meta), "utf8")
    } catch {
      // Ignore metadata write failures.
    }
  }
}

export class ScrollbackArchiveManager {
  private archives = new Set<ScrollbackArchive>()
  private readonly maxBytes: number

  constructor(maxBytes: number) {
    this.maxBytes = maxBytes
  }

  register(archive: ScrollbackArchive): void {
    this.archives.add(archive)
  }

  unregister(archive: ScrollbackArchive): void {
    this.archives.delete(archive)
  }

  enforceGlobalLimit(): void {
    let totalBytes = 0
    for (const archive of this.archives) {
      totalBytes += archive.bytes
    }

    while (totalBytes > this.maxBytes) {
      let targetArchive: ScrollbackArchive | null = null
      let targetChunk: ArchiveChunk | null = null

      for (const archive of this.archives) {
        const chunk = archive.getOldestChunk()
        if (!chunk) continue
        if (!targetChunk || chunk.createdAt < targetChunk.createdAt) {
          targetChunk = chunk
          targetArchive = archive
        }
      }

      if (!targetArchive || !targetChunk) break

      const removed = targetArchive.dropOldestChunk()
      if (!removed) break
      totalBytes -= removed.bytesRemoved
    }
  }
}

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer
}
