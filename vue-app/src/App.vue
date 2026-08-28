<script setup lang="ts">
import { onMounted } from "vue";
import AppStatusBar from "@/components/AppStatusBar.vue";
import { useAuthStore } from "@/modules/auth/auth.store";

const auth = useAuthStore();

// Se intenta rehidratar la sesión desde la cookie HttpOnly de refresco.
// El access token vive solo en memoria: nunca en localStorage.
onMounted(() => {
  void auth.bootstrap();
});
</script>

<template>
  <AppStatusBar />
  <RouterView v-if="auth.ready" />
  <div v-else class="grid h-full place-items-center text-ink-muted">
    <p class="text-sm">Cargando Geeksium POS…</p>
  </div>
</template>
