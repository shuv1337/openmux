#!/usr/bin/env bun
/**
 * Debug XTWINOPS responses from the terminal.
 * Run inside an openmux pane: bun scripts/debug-xtwinops.ts
 */

const ESC = '\x1b';
const queries = [`${ESC}[14t`, `${ESC}[16t`, `${ESC}[18t`];

const buffer: string[] = [];

function parseResponses(data: string) {
  const pixelMatch = data.match(/\x1b\[4;(\d+);(\d+)t/);
  const cellMatch = data.match(/\x1b\[6;(\d+);(\d+)t/);
  const charMatch = data.match(/\x1b\[8;(\d+);(\d+)t/);

  return {
    pixel: pixelMatch ? { height: Number(pixelMatch[1]), width: Number(pixelMatch[2]) } : null,
    cell: cellMatch ? { height: Number(cellMatch[1]), width: Number(cellMatch[2]) } : null,
    chars: charMatch ? { height: Number(charMatch[1]), width: Number(charMatch[2]) } : null,
  };
}

async function main() {
  const shouldUseRaw = process.stdin.isTTY && typeof process.stdin.setRawMode === 'function';
  if (shouldUseRaw) {
    try {
      process.stdin.setRawMode(true);
    } catch {
      // Ignore raw mode failures in nested PTYs.
    }
  }
  process.stdin.resume();
  process.stdin.setEncoding('utf8');

  const onData = (chunk: string) => {
    buffer.push(chunk);
  };
  process.stdin.on('data', onData);

  for (const query of queries) {
    process.stdout.write(query);
  }

  await new Promise((resolve) => setTimeout(resolve, 200));

  process.stdin.off('data', onData);
  if (shouldUseRaw) {
    try {
      process.stdin.setRawMode(false);
    } catch {
      // Ignore raw mode cleanup failures.
    }
  }
  process.stdin.pause();

  const joined = buffer.join('');
  const parsed = parseResponses(joined);

  console.log('raw:', JSON.stringify(joined));
  console.log('pixel:', parsed.pixel);
  console.log('cell:', parsed.cell);
  console.log('chars:', parsed.chars);
}

main().catch((err) => {
  console.error('debug-xtwinops error:', err);
  process.exit(1);
});
