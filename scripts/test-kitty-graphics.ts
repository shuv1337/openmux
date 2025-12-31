#!/usr/bin/env bun
/**
 * Smoke test for kitty graphics support in libghostty-vt.
 * Run: bun scripts/test-kitty-graphics.ts
 */

import { GhosttyVtTerminal } from '../src/terminal/ghostty-vt';

const ESC = '\x1b';

function main(): void {
  const term = new GhosttyVtTerminal(4, 2);
  try {
    const pixel = Buffer.from([255, 0, 0]);
    const encoded = pixel.toString('base64');
    const transmit = `${ESC}_Ga=t,f=24,s=1,v=1,i=1;${encoded}${ESC}\\`;
    const display = `${ESC}_Ga=p,i=1,p=1,c=1,r=1${ESC}\\`;
    const query = `${ESC}_Ga=q,f=24,s=1,v=1,i=31;${encoded}${ESC}\\`;

    term.write(transmit + display + query);
    term.update();

    const ids = term.getKittyImageIds();
    console.log('kitty image ids:', ids);
    console.log('kitty dirty:', term.getKittyImagesDirty());

    if (ids.length === 0) {
      console.warn('no kitty images detected; verify libghostty-vt is built with kitty_graphics');
      return;
    }

    const info = term.getKittyImageInfo(ids[0]!);
    console.log('image info:', info);
    const data = term.getKittyImageData(ids[0]!);
    console.log('image data length:', data?.length ?? 0);
    const placements = term.getKittyPlacements();
    console.log('placements:', placements);

    const responses: string[] = [];
    while (true) {
      const response = term.readResponse();
      if (!response) break;
      responses.push(response);
    }
    console.log('kitty query responses:', responses);
  } finally {
    term.free();
  }
}

main();
