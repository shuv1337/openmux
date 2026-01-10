import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    globals: false,
    environment: "node",
    testTimeout: 10000,
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["src/**/*.ts", "src/**/*.tsx"],
      exclude: ["src/**/*.test.ts", "src/**/*.d.ts"],
    },
  },
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "@opentui/solid",
    jsxDev: false,
  },
  resolve: {
    alias: {
      "@opentui/solid/jsx-runtime": "solid-js/h/jsx-runtime",
      "@opentui/solid/jsx-dev-runtime": "solid-js/h/jsx-dev-runtime",
    },
  },
})
