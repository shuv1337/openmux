#!/usr/bin/env bun
/**
 * Debug harness for kitty graphics protocol inside a PTY.
 * Runs: bun scripts/debug-kitty-icat.ts
 */

import { spawnAsync } from '../native/zig-pty/ts/index';
import { TerminalQueryPassthrough } from '../src/terminal/terminal-query-passthrough';
import { createGhosttyVTEmulator } from '../src/terminal/ghostty-vt/emulator';
import { getDefaultColors } from '../src/terminal/terminal-colors';
import { createDataHandler } from '../src/effect/services/pty/data-handler';
import { createSyncModeParser } from '../src/terminal/sync-mode-parser';

const ESC = '\x1b';
const APC_C1 = '\x9f';
const ST_C1 = '\x9c';

type KittyCommand = {
  raw: string;
  control: string;
  payloadLength: number;
  isResponse: boolean;
};

function extractKittyCommands(data: string): KittyCommand[] {
  const commands: KittyCommand[] = [];
  let i = 0;

  while (i < data.length) {
    const isEscApc = data[i] === ESC && data[i + 1] === '_' && data[i + 2] === 'G';
    const isC1Apc = data[i] === APC_C1 && data[i + 1] === 'G';
    if (!isEscApc && !isC1Apc) {
      i += 1;
      continue;
    }

    const start = i;
    let pos = i + (isEscApc ? 3 : 2);
    let end = -1;
    let terminatorLength = 0;

    while (pos < data.length) {
      if (data[pos] === ST_C1) {
        end = pos + 1;
        terminatorLength = 1;
        break;
      }
      if (data[pos] === ESC && data[pos + 1] === '\\') {
        end = pos + 2;
        terminatorLength = 2;
        break;
      }
      pos += 1;
    }

    if (end < 0) {
      break;
    }

    const body = data.slice(start + (isEscApc ? 3 : 2), end - terminatorLength);
    const sep = body.indexOf(';');
    const control = sep === -1 ? body : body.slice(0, sep);
    const payload = sep === -1 ? '' : body.slice(sep + 1);
    const isResponse = !control.includes('a=') && (payload === 'OK' || /[^A-Za-z0-9+/=]/.test(payload));

    commands.push({
      raw: data.slice(start, end),
      control,
      payloadLength: payload.length,
      isResponse,
    });

    i = end;
  }

  return commands;
}

function formatCommand(command: KittyCommand): string {
  const tag = command.isResponse ? 'resp' : 'cmd';
  return `${tag} control="${command.control}" payload=${command.payloadLength}`;
}

function stripKittySequences(data: string): string {
  let result = '';
  let i = 0;

  while (i < data.length) {
    const isEscApc = data[i] === ESC && data[i + 1] === '_' && data[i + 2] === 'G';
    const isC1Apc = data[i] === APC_C1 && data[i + 1] === 'G';
    if (!isEscApc && !isC1Apc) {
      result += data[i];
      i += 1;
      continue;
    }

    let pos = i + (isEscApc ? 3 : 2);
    let end = -1;
    while (pos < data.length) {
      if (data[pos] === ST_C1) {
        end = pos + 1;
        break;
      }
      if (data[pos] === ESC && data[pos + 1] === '\\') {
        end = pos + 2;
        break;
      }
      pos += 1;
    }
    if (end < 0) break;
    i = end;
  }

  return result;
}

async function main(): Promise<void> {
  const colors = getDefaultColors();
  const emulator = createGhosttyVTEmulator(80, 24, colors);
  const queryPassthrough = new TerminalQueryPassthrough();
  const logs: string[] = [];

  const env = {
    ...process.env,
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
  } as Record<string, string>;

  const pty = await spawnAsync('kitty', ['+kitten', 'icat', 'assets/openmux-screenshot.png'], {
    cols: 80,
    rows: 24,
    cwd: process.cwd(),
    env,
  });

  const originalPtyWrite = pty.write.bind(pty);
  pty.write = (data: string) => {
    const commands = extractKittyCommands(data);
    for (const cmd of commands) {
      logs.push(`openmux -> pty ${formatCommand(cmd)}`);
    }
    originalPtyWrite(data);
  };

  queryPassthrough.setPtyWriter((response) => {
    logs.push(`passthrough -> pty (${response.length} bytes)`);
    pty.write(response);
  });

  queryPassthrough.setSizeGetter(() => ({
    cols: 80,
    rows: 24,
    pixelWidth: 640,
    pixelHeight: 384,
    cellWidth: 8,
    cellHeight: 16,
  }));

  const originalEmulatorWrite = emulator.write.bind(emulator);
  emulator.write = (data: string | Uint8Array) => {
    if (typeof data === 'string') {
      const commands = extractKittyCommands(data);
      for (const cmd of commands) {
        logs.push(`openmux -> emulator ${formatCommand(cmd)}`);
      }
    }
    originalEmulatorWrite(data);
  };

  const { handleData, cleanup } = createDataHandler({
    session: {
      id: 'debug' as any,
      pty,
      emulator,
      queryPassthrough,
      cols: 80,
      rows: 24,
      cwd: process.cwd(),
      shell: 'kitty',
      closing: false,
      subscribers: new Set(),
      scrollSubscribers: new Set(),
      unifiedSubscribers: new Set(),
      exitCallbacks: new Set(),
      titleSubscribers: new Set(),
      lastCommand: null,
      pendingNotify: false,
      scrollState: { viewportOffset: 0, lastScrollbackLength: 0 },
    },
    syncParser: createSyncModeParser(),
  });

  pty.onData((chunk: string) => {
    const cmds = extractKittyCommands(chunk);
    if (cmds.length > 0) {
      for (const cmd of cmds) {
        logs.push(`pty -> ${formatCommand(cmd)}`);
      }
    }

    const text = stripKittySequences(chunk);
    if (text.trim().length > 0) {
      logs.push(`pty -> text ${JSON.stringify(text.trim())}`);
    }

    handleData(chunk);
  });

  await new Promise<void>((resolve) => {
    pty.onExit(({ exitCode }) => {
      logs.push(`pty exit=${exitCode}`);
      resolve();
    });
  });

  cleanup();
  emulator.dispose();

  const output = logs.join('\n');
  if (output.length === 0) {
    console.log('no kitty commands observed');
  } else {
    console.log(output);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
