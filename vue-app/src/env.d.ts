/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>;
  export default component;
}

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  /** "true" activa la capa de mocks. Solo se lee en desarrollo. */
  readonly VITE_USE_MOCKS?: string;
  readonly DEV: boolean;
  readonly PROD: boolean;
}


interface ImportMeta {
  readonly env: ImportMetaEnv;
}
