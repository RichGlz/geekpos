<script setup lang="ts">
import { computed } from "vue";
import { mocksEnabled } from "@/lib/mocks";
import { useSyncStore } from "@/modules/system/sync.store";
import { useUpdateStore } from "@/modules/system/update.store";
import { useCriticalStore } from "@/modules/system/critical.store";
import { useAuthStore } from "@/modules/auth/auth.store";
const sync = useSyncStore(), updates = useUpdateStore(), critical = useCriticalStore(), auth = useAuthStore();
const apiStatus = computed(() => !sync.isOnline || sync.apiReachable === false
  ? "🔴 API no disponible"
  : sync.apiReachable ? "🟢 API disponible" : "⚪ API sin verificar");
const sessionStatus = computed(() => auth.sessionExpired ? "🔴 Sesión expirada" :
  auth.offlineSession ? "🟠 Sesión local pendiente de validación" :
  auth.isAuthenticated ? "🟢 Sesión válida" : "");
const licenseMessage = computed(() => ({
  normal: "",
  warning: "Varios días sin validar la licencia. Reconecta cuando sea posible.",
  grace: "Licencia offline en periodo de gracia. Requiere conexión pronto.",
  requires_validation: "Se requiere validar la licencia online.",
})[sync.offlineLicenseState]);
</script>
<template>
  <aside class="fixed inset-x-0 bottom-0 z-50 border-t border-line bg-surface-raised px-4 py-2 text-xs text-ink-muted" aria-label="Estado de la aplicación">
    <p v-if="mocksEnabled" data-testid="mock-banner" class="font-bold text-warning">MODO MOCK — SOLO UI</p>
    <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
      <span role="status" aria-live="polite" :data-testid="!sync.isOnline ? 'offline-banner' : 'connection-status'">{{ apiStatus }}</span>
      <span v-if="sessionStatus" role="status">{{ sessionStatus }}</span>
      <template v-if="auth.isAuthenticated">
        <span v-if="sync.syncState === 'syncing'">🟠 Sincronizando</span>
        <span v-if="sync.pendingOperations || sync.pendingUploads">🟠 {{ sync.pendingOperations }} cambios · {{ sync.pendingUploads }} imágenes pendientes</span>
        <span v-if="sync.lastSuccessfulSyncAt">Última sincronización: {{ new Date(sync.lastSuccessfulSyncAt).toLocaleString('es-MX') }}</span>
        <button type="button" class="min-h-9 rounded border border-line-strong px-3 disabled:opacity-50"
          :disabled="sync.syncState === 'syncing' || !sync.isOnline" @click="sync.sync(true)">Sincronizar</button>
        <span v-if="sync.license && licenseMessage" role="status"
          :class="sync.offlineLicenseState === 'warning' ? 'text-warning' : 'text-danger'">{{ licenseMessage }}</span>
      </template>
      <div v-if="updates.updateAvailable" data-testid="pwa-update" role="status" class="flex items-center gap-2">
        <span>{{ updates.updateRequired ? 'Actualización requerida' : updates.updateReady ? 'Actualización lista' : 'Actualización disponible' }}</span>
        <button type="button" class="min-h-9 rounded bg-brand px-3 text-brand-ink disabled:opacity-50"
          :disabled="!updates.updateReady || updates.applying || critical.blocked || !!sync.pendingOperations || !!sync.pendingUploads || updates.channelMismatch"
          @click="updates.apply()">Actualizar</button>
        <span v-if="critical.blocked">Termina la operación para actualizar.</span>
      </div>
      <span v-if="updates.channelMismatch" class="text-warning">La instalación no corresponde al canal asignado.</span>
      <span v-if="sync.error || updates.error" role="status" class="text-warning">{{ sync.error || updates.error }}</span>
    </div>
  </aside>
</template>
