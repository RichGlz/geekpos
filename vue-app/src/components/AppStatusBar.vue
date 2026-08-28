<script setup lang="ts">
/**
 * Avisos globales HONESTOS de la aplicación:
 *  - modo mock activo (solo desarrollo),
 *  - estado de conexión: se informa de que NO hay operación sin conexión
 *    todavía; la cola de sincronización existe pero no está conectada a
 *    ningún módulo de negocio,
 *  - actualización de la PWA disponible, con aviso accesible y botón.
 */
import { onBeforeUnmount, onMounted, ref } from "vue";
import { mocksEnabled } from "@/lib/mocks";

const online = ref(true);
const updateReady = ref(false);
const updateButton = ref<HTMLButtonElement | null>(null);
let applyUpdate: ((reload?: boolean) => Promise<void>) | null = null;

function syncOnline(): void {
  online.value = typeof navigator === "undefined" ? true : navigator.onLine;
}

onMounted(async () => {
  syncOnline();
  window.addEventListener("online", syncOnline);
  window.addEventListener("offline", syncOnline);

  // El registro del service worker solo existe en el build de producción.
  try {
    const { registerSW } = await import("virtual:pwa-register");
    applyUpdate = registerSW({
      immediate: true,
      onNeedRefresh() {
        updateReady.value = true;
        // El foco va al botón para que el aviso sea alcanzable con teclado.
        void Promise.resolve().then(() => updateButton.value?.focus());
      },
    });
  } catch {
    // En desarrollo no hay service worker: no es un error.
  }
});

onBeforeUnmount(() => {
  window.removeEventListener("online", syncOnline);
  window.removeEventListener("offline", syncOnline);
});

async function reloadApp(): Promise<void> {
  updateReady.value = false;
  if (applyUpdate) await applyUpdate(true);
  else window.location.reload();
}
</script>

<template>
  <div class="pointer-events-none fixed inset-x-0 top-0 z-50 flex flex-col items-center gap-2 p-2">
    <p
      v-if="mocksEnabled"
      data-testid="mock-banner"
      role="status"
      class="pointer-events-auto rounded-md bg-amber-500 px-4 py-1.5 text-xs font-bold tracking-wide text-black"
    >
      MODO MOCK — SOLO UI
    </p>

    <p
      v-if="!online"
      data-testid="offline-banner"
      role="status"
      aria-live="polite"
      class="pointer-events-auto rounded-md border border-line-strong bg-surface px-4 py-1.5 text-xs text-ink-muted"
    >
      Sin conexión. Puedes seguir consultando lo que ya está en pantalla; registrar operaciones
      requiere conexión (la operación sin conexión aún no está disponible).
    </p>

    <div
      v-if="updateReady"
      data-testid="pwa-update"
      role="status"
      aria-live="polite"
      class="pointer-events-auto flex items-center gap-3 rounded-md border border-line-strong bg-surface px-4 py-2 text-xs text-ink"
    >
      <span>Hay una versión nueva de Geeksium POS.</span>
      <button
        ref="updateButton"
        type="button"
        class="rounded bg-brand px-3 py-1 font-semibold text-brand-ink"
        @click="reloadApp"
      >
        Actualizar
      </button>
    </div>
  </div>
</template>
