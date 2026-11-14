// Vitest (not Jest): runs TypeScript + native ESM directly with no
// ts-jest/babel transform layer, which matches this "type": "module"
// NodeNext project, and its API is Jest-compatible for anyone switching.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    testTimeout: 20_000,
  },
});
