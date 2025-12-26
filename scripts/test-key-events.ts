#!/usr/bin/env bun
/**
 * Manual key event tester for press/repeat/release events.
 * Run: bun scripts/test-key-events.ts
 */

import { KeyHandler, StdinBuffer } from "@opentui/core";

const KITTY_FLAGS = 3; // disambiguate escape codes + report events
const KITTY_ENABLE_SEQUENCE = `\x1b[=${KITTY_FLAGS};1u`;
const KITTY_DISABLE_SEQUENCE = "\x1b[=0;1u";

type KeyEvent = {
  name: string;
  ctrl: boolean;
  shift: boolean;
  option: boolean;
  meta: boolean;
  sequence: string;
  raw: string;
  eventType: "press" | "repeat" | "release";
  source: "raw" | "kitty";
  super?: boolean;
  hyper?: boolean;
  capsLock?: boolean;
  numLock?: boolean;
  baseCode?: number;
  repeated?: boolean;
  code?: string;
};

function enableKittyKeyboard(): void {
  process.stdout.write(KITTY_ENABLE_SEQUENCE);
  if (process.stdout.isTTY) {
    (process.stdout as any)._handle?.flush?.();
  }
}

function disableKittyKeyboard(): void {
  process.stdout.write(KITTY_DISABLE_SEQUENCE);
  if (process.stdout.isTTY) {
    (process.stdout as any)._handle?.flush?.();
  }
}

function formatEvent(event: KeyEvent, repeatLabel: string): string {
  const type =
    event.eventType === "release" ? "release" : event.repeated ? "repeat" : "press";
  const mods: string[] = [];
  if (event.ctrl) mods.push("ctrl");
  if (event.option) mods.push("alt");
  if (event.shift) mods.push("shift");
  if (event.meta) mods.push("meta");
  if (event.super) mods.push("super");
  if (event.hyper) mods.push("hyper");
  if (event.capsLock) mods.push("capsLock");
  if (event.numLock) mods.push("numLock");
  const modsText = mods.length > 0 ? mods.join("+") : "none";
  const key = event.name || "(none)";
  const sequence = JSON.stringify(event.sequence ?? "");
  const raw = JSON.stringify(event.raw ?? "");
  const baseCode = typeof event.baseCode === "number" ? event.baseCode : "";
  const code = event.code ?? "";
  return `${type.padEnd(7)} key=${key} mods=${modsText} seq=${sequence} raw=${raw} baseCode=${baseCode} code=${code} source=${event.source} repeat=${repeatLabel}`;
}

function main() {
  console.log("Key event tester");
  console.log("Hold a key to see repeat events, release to see release events.");
  console.log("Press Ctrl+C to quit.\n");

  enableKittyKeyboard();

  const handler = new KeyHandler(true);
  const buffer = new StdinBuffer({ timeout: 10 });

  const pressedKeys = new Set<string>();

  const onKey = (event: KeyEvent) => {
    const keyId = `${event.name}|${event.ctrl ? "C" : ""}${event.option ? "A" : ""}${event.shift ? "S" : ""}${event.meta ? "M" : ""}`;
    let repeatLabel = "none";

    if (event.eventType === "release") {
      if (event.source === "kitty") {
        pressedKeys.delete(keyId);
      }
      repeatLabel = "none";
    } else {
      if (event.repeated) {
        repeatLabel = "flag";
      } else if (event.source === "kitty" && pressedKeys.has(keyId)) {
        repeatLabel = "synthetic";
      }
      if (event.source === "kitty") {
        pressedKeys.add(keyId);
      }
    }

    console.log(formatEvent(event, repeatLabel));
    if (event.ctrl && event.name === "c" && event.eventType !== "release") {
      cleanup();
    }
  };

  handler.on("keypress", onKey);
  handler.on("keyrelease", onKey);
  handler.on("paste", (event) => {
    console.log(`[paste] ${event.text.length} chars`);
  });

  process.stdin.on("data", (data) => buffer.process(data));
  buffer.on("data", (data: string) => handler.processInput(data));
  buffer.on("paste", (data: string) => handler.processPaste(data));

  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }
  process.stdin.resume();

  function cleanup() {
    disableKittyKeyboard();
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
    process.stdin.pause();
    process.exit(0);
  }

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
}

main();
