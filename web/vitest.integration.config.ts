import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    // One fork shares one postgres container and one API process across
    // every test in the file.
    singleFork: true,
    testTimeout: 180_000,
    hookTimeout: 300_000,
    teardownTimeout: 30_000,
  },
});
