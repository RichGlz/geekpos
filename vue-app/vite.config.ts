import tailwindcss from "@tailwindcss/vite";
import vue from "@vitejs/plugin-vue";
import path from "node:path";
import { defineConfig, loadEnv } from "vite";
import { VitePWA } from "vite-plugin-pwa";

/**
 * Base de la API tal y como la verá el navegador. Puede ser relativa
 * ("/api/v1") o una URL absoluta a otro origen.
 */
export default defineConfig(({ mode }) => {
const buildEnv = { ...loadEnv(mode, process.cwd(), "VITE_"), ...process.env };
const apiBaseUrl = buildEnv["VITE_API_BASE_URL"] ?? "/api/v1";
const apiIsAbsolute = /^https?:\/\//i.test(apiBaseUrl);
const apiOrigin = apiIsAbsolute ? new URL(apiBaseUrl).origin : null;
const apiPathPrefix = apiIsAbsolute ? new URL(apiBaseUrl).pathname : apiBaseUrl;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Patrón de las peticiones a la API.
 *
 * Tiene que ser una RegExp, no una función: Workbox serializa la regla al
 * generar el service worker y una función perdería las constantes de este
 * archivo. Cubre los dos escenarios:
 *  - API en otro origen  -> cualquier URL de ese origen.
 *  - API relativa        -> cualquier URL cuyo path empiece por el prefijo.
 */
const apiUrlPattern = apiOrigin
  ? new RegExp(`^${escapeRegExp(apiOrigin)}/`)
  : new RegExp(`^https?://[^/]+${escapeRegExp(apiPathPrefix)}(/|$)`);

return {
  plugins: [
    vue(),
    tailwindcss(),
    VitePWA({
      registerType: "prompt",
      includeAssets: ["favicon.svg"],
      manifest: {
        name: "Geeksium POS",
        short_name: "Geeksium",
        description: "Punto de venta multiempresa con inventario, sucursales y control de licencias.",
        lang: "es",
        start_url: "/",
        display: "standalone",
        background_color: "#0b1220",
        theme_color: "#0b1220",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "/icons/icon-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        /**
         * El service worker cachea ÚNICAMENTE el app shell y los estáticos.
         * Autenticación y datos privados quedan explícitamente excluidos: no
         * queremos respuestas con información de la organización en la caché
         * del navegador de un equipo compartido.
         */
        navigateFallbackDenylist: [/^\/api(?:\/|$)/, new RegExp("^" + escapeRegExp(apiPathPrefix) + "(?:/|$)")],
        skipWaiting: false,
        clientsClaim: false,
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            // NetworkOnly para TODA la API: login, refresh y cualquier dato
            // privado quedan fuera de la caché del navegador, tanto si la API
            // es relativa como si vive en otro origen.
            urlPattern: apiUrlPattern,
            handler: "NetworkOnly",
            method: "GET",
          },
          ...(["POST", "PUT", "PATCH", "DELETE"] as const).map((method) => ({
            urlPattern: apiUrlPattern,
            handler: "NetworkOnly" as const,
            method,
          })),
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: process.env["VITE_API_PROXY"] ?? "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: "happy-dom",
    include: ["src/**/*.test.ts"],
  },
};
});
