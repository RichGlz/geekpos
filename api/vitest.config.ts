import { defineConfig } from "vitest/config";

// Config aislada: evita que Vitest herede la configuración de Vite del portal
// React que vive en la raíz del monorepo.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    hookTimeout: 60_000,
    testTimeout: 60_000,
    globals: false,
  },
});
