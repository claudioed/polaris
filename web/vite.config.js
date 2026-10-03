import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
export default defineConfig({
    plugins: [react()],
    test: {
        environment: "jsdom",
        environmentOptions: {
            jsdom: {
                // Non-routable origin: a request that slips past MSW must fail with a
                // network error instead of reaching a real local service.
                url: "http://polaris.test/",
            },
        },
        setupFiles: "./src/test/setup.ts",
        restoreMocks: true,
        coverage: {
            provider: "v8",
            include: ["src/**"],
            exclude: ["src/test/**", "src/main.tsx"],
            thresholds: {
                lines: 92,
                functions: 92,
                branches: 92,
                statements: 92,
            },
        },
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
