<script setup lang="ts">
import { onBeforeUnmount, onMounted } from "vue";
import AppStatusBar from "@/components/AppStatusBar.vue";
import { useAuthStore } from "@/modules/auth/auth.store";
import { useSyncStore } from "@/modules/system/sync.store";
import { useUpdateStore } from "@/modules/system/update.store";

const auth = useAuthStore();
const sync = useSyncStore();
const updates = useUpdateStore();

// Se intenta rehidratar la sesión desde la cookie HttpOnly de refresco.
// El access token vive solo en memoria: nunca en localStorage.
onMounted(() => {
  void auth.bootstrap();
  sync.start();
  void updates.start();
});
onBeforeUnmount(() => sync.stop());
</script>

<template>
  <AppStatusBar />
  <RouterView v-if="auth.ready" />
  <div v-else class="grid h-full place-items-center text-ink-muted">
    <p class="text-sm">Cargando Geeksium POS…</p>
  </div>
</template>
