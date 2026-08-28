import vue from "@vitejs/plugin-vue";
import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Configuración aislada de pruebas: no arrastra el plugin PWA (que necesita un
 * build real) ni el proxy del dev server.
 */
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
  test: {
    environment: "happy-dom",
    include: ["src/**/*.test.ts"],
    globals: false,
  },
});
