/**
 * Build script for openmux that uses the Solid.js Bun plugin
 * This is needed because `bun build --compile` doesn't use preload scripts
 */

import solidTransformPlugin from "@opentui/solid/bun-plugin";

const result = await Bun.build({
  entrypoints: ["./src/index.tsx"],
  outdir: "./dist",
  minify: true,
  target: "bun",
  // Bundle all packages (don't mark node_modules as external)
  packages: "bundle",
  plugins: [solidTransformPlugin],
});

if (!result.success) {
  console.error("Build failed:");
  for (const log of result.logs) {
    console.error(log);
  }
  process.exit(1);
}

console.log("Bundle created successfully");
