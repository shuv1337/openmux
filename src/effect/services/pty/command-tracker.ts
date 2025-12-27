/**
 * CommandTracker - best-effort capture of shell command lines.
 * This is only used when process inspection drops args (e.g., setproctitle).
 */

const ESC = '\x1b';
const DEL = '\x7f';
const BACKSPACE = '\b';
const CTRL_A = '\x01';
const CTRL_E = '\x05';
const CTRL_U = '\x15';

export interface CommandTrackerOptions {
  allowCommit?: boolean | ((line: string) => boolean);
}

export class CommandTracker {
  private buffer: string[] = [];
  private cursor = 0;
  private lastCommand: string | null = null;
  private bufferTrusted = true;

  feed(data: string, options?: CommandTrackerOptions): void {
    let sawCR = false;

    for (let i = 0; i < data.length; i += 1) {
      const ch = data[i];

      if (ch === '\r') {
        this.commitLine(options?.allowCommit);
        sawCR = true;
        continue;
      }

      if (ch === '\n') {
        if (sawCR) {
          sawCR = false;
          continue;
        }
        this.commitLine(options?.allowCommit);
        continue;
      }

      sawCR = false;

      if (ch === ESC) {
        i = this.consumeEscape(data, i) - 1;
        continue;
      }

      if (ch === DEL || ch === BACKSPACE) {
        this.backspace();
        continue;
      }

      if (ch === CTRL_A) {
        this.cursor = 0;
        continue;
      }

      if (ch === CTRL_E) {
        this.cursor = this.buffer.length;
        continue;
      }

      if (ch === CTRL_U) {
        this.buffer = [];
        this.cursor = 0;
        continue;
      }

      if (ch >= ' ' || ch === '\t') {
        this.insertChar(ch);
      }
    }
  }

  getLastCommand(): string | null {
    return this.lastCommand;
  }

  private insertChar(ch: string): void {
    this.buffer.splice(this.cursor, 0, ch);
    this.cursor += 1;
  }

  private backspace(): void {
    if (this.cursor <= 0) return;
    this.buffer.splice(this.cursor - 1, 1);
    this.cursor -= 1;
  }

  private commitLine(allowCommit?: boolean | ((line: string) => boolean)): void {
    const line = this.buffer.join('');
    const trimmed = line.trim();
    if (this.bufferTrusted && trimmed.length > 0) {
      const allowed =
        typeof allowCommit === 'function'
          ? allowCommit(trimmed)
          : allowCommit ?? true;
      if (allowed) {
        this.lastCommand = trimmed;
      }
    }

    this.buffer = [];
    this.cursor = 0;
    this.bufferTrusted = true;
  }

  private consumeEscape(data: string, start: number): number {
    if (data[start + 1] !== '[') {
      return start + 1;
    }

    let i = start + 2;
    while (i < data.length) {
      const code = data.charCodeAt(i);
      if (code >= 0x40 && code <= 0x7e) {
        break;
      }
      i += 1;
    }

    if (i >= data.length) {
      return data.length;
    }

    const final = data[i];
    const params = data.slice(start + 2, i);
    const firstParam = params.split(';')[0];

    switch (final) {
      case 'A':
      case 'B':
        // History navigation - we can't track the resulting line reliably.
        this.bufferTrusted = false;
        this.buffer = [];
        this.cursor = 0;
        break;
      case 'C':
        this.cursor = Math.min(this.cursor + 1, this.buffer.length);
        break;
      case 'D':
        this.cursor = Math.max(this.cursor - 1, 0);
        break;
      case 'H':
        this.cursor = 0;
        break;
      case 'F':
        this.cursor = this.buffer.length;
        break;
      case '~':
        if (firstParam === '1' || firstParam === '7') {
          this.cursor = 0;
        } else if (firstParam === '4' || firstParam === '8') {
          this.cursor = this.buffer.length;
        }
        break;
      default:
        break;
    }

    return i + 1;
  }
}
