import { createPinia } from "pinia";
import { createApp } from "vue";
import App from "./App.vue";
import { router } from "./router";
import { http } from "./lib/http";
import { useAuthStore } from "./modules/auth/auth.store";
import "./styles/main.css";

const app = createApp(App);
const pinia = createPinia();
app.use(pinia);

/**
 * Modo mock: se carga de forma dinámica y SOLO en desarrollo con
 * VITE_USE_MOCKS=true. El bundle de producción nunca incluye esta capa.
 */
async function maybeInstallMocks(): Promise<void> {
  if (!import.meta.env.DEV || import.meta.env["VITE_USE_MOCKS"] !== "true") return;
  const mocks = await import("./lib/mocks");
  mocks.installMocks(http);
}

/**
 * Antes de montar se intenta restaurar la sesión con la cookie HttpOnly de
 * refresco. Sin esto, cualquier recarga en una ruta privada mandaría al login
 * aunque la sesión siga siendo válida en el servidor.
 */
const auth = useAuthStore(pinia);
void maybeInstallMocks()
  .then(() => auth.bootstrap())
  .finally(() => {
    app.use(router);
    app.mount("#app");
  });
