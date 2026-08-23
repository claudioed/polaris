import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
    restoreMocks: true,
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8080",
      "/openapi.yaml": "http://localhost:8080",
    },
  },
  preview: {
    port: 4173,
  },
});
