import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { useCriticalStore, CRITICAL_LOCK } from "./critical.store";
import { list } from "@/lib/offline/syncQueue";
import { STORE_IMAGES, withStore } from "@/lib/offline/idb";
export const CURRENT_VERSION = import.meta.env["VITE_APP_VERSION"] ?? "0.2.0";
export const UPDATE_CHANNEL = import.meta.env["VITE_UPDATE_CHANNEL"] ?? "stable";
export interface ReleaseInfo {
  updateChannel: string; deploymentChannel: string; latestVersion: string; minimumSupportedVersion: string;
}
export function compareVersions(a: string, b: string): number {
  const left = a.split(".").map(Number), right = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const difference = (left[i] ?? 0) - (right[i] ?? 0);
    if (difference) return difference;
  }
  return 0;
}
export const useUpdateStore = defineStore("updates", () => {
  const critical = useCriticalStore();
  const release = ref<ReleaseInfo | null>(null);
  const updateReady = ref(false);
  const applying = ref(false);
  const error = ref<string | null>(null);
  const currentVersion = CURRENT_VERSION, updateChannel = UPDATE_CHANNEL;
  const latestVersion = computed(() => release.value?.latestVersion ?? currentVersion);
  const minimumSupportedVersion = computed(() => release.value?.minimumSupportedVersion ?? "0.1.0");
  const channelMismatch = computed(() => !!release.value &&
    (release.value.updateChannel !== updateChannel || release.value.deploymentChannel !== updateChannel));
  const updateAvailable = computed(() => updateReady.value || compareVersions(currentVersion, latestVersion.value) < 0);
  const updateRequired = computed(() => compareVersions(currentVersion, minimumSupportedVersion.value) < 0);
  const state = computed(() => applying.value ? "APPLYING" : updateReady.value ? "UPDATE_READY" : updateAvailable.value ? "UPDATE_AVAILABLE" : "CURRENT");
  let applyWorker: ((reload?: boolean) => Promise<void>) | undefined;
  let registration: ServiceWorkerRegistration | undefined;
  let started = false;
  let lastCheck = 0;
  let workerActivated = false;
  let activated: (() => void) | undefined;
  function ready() { updateReady.value = true; }
  async function start() {
    if (started) return;
    started = true;
    try {
      const { registerSW } = await import("virtual:pwa-register");
      applyWorker = registerSW({
        immediate: true, onNeedRefresh: ready,
        // Never allow workbox to reload another tab during its active sale/form.
        onNeedReload() {
          workerActivated = true;
          updateReady.value = true;
          activated?.();
        },
        onRegisteredSW(_url, value) { registration = value; },
        onRegisterError() { error.value = "No se pudo registrar la actualización."; },
      });
    } catch { /* dev/test has no worker */ }
  }
  async function check() {
    if (!registration || Date.now() - lastCheck < 60 * 60_000) return;
    lastCheck = Date.now();
    try { await registration.update(); } catch { /* connectivity is shown by sync */ }
  }
  async function apply(): Promise<boolean> {
    if (!updateReady.value || applying.value || critical.blocked || channelMismatch.value) return false;
    if (!navigator.locks) { error.value = "Actualiza después de cerrar todas las pestañas y terminar las operaciones."; return false; }
    return navigator.locks.request(CRITICAL_LOCK, { ifAvailable: true }, async (lock) => {
      if (!lock || critical.blocked) { error.value = "Termina las operaciones en todas las pestañas."; return false; }
      // Check every account: no update while durable pending work still needs attention.
      if ((await list()).length || await withStore(STORE_IMAGES, "readonly", (s) => s.count())) {
        error.value = "Sincroniza o revisa los cambios pendientes antes de actualizar."; return false;
      }
      if (!applyWorker) return false;
      applying.value = true;
      try {
        if (!workerActivated) {
          await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => { activated = undefined; reject(new Error("Tiempo agotado.")); }, 30_000);
            activated = () => { clearTimeout(timeout); activated = undefined; resolve(); };
            void applyWorker!(true).catch(reject);
          });
        }
        // The exclusive cross-tab lock stays held through activation and this reload.
        if (critical.blocked || (await list()).length) { applying.value = false; return false; }
        window.location.reload();
        return true;
      }
      catch { applying.value = false; error.value = "No se pudo aplicar la actualización."; return false; }
    });
  }
  return { currentVersion, latestVersion, minimumSupportedVersion, updateChannel, release, channelMismatch,
    updateAvailable, updateRequired, updateReady, applying, state, error, start, check, ready, apply };
});
