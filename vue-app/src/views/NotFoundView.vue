<script setup lang="ts">
import { RouterLink } from "vue-router";
</script>

<template>
  <div class="grid h-full place-items-center px-6 text-center">
    <div>
      <h1 class="text-4xl">Página no encontrada</h1>
      <p class="mt-2 text-sm text-ink-muted">La ruta que buscas no existe o cambió de lugar.</p>
      <RouterLink
        :to="{ name: 'landing' }"
        class="mt-6 inline-block rounded-md bg-brand px-4 py-2 text-sm font-semibold text-brand-ink"
      >
        Volver al inicio
      </RouterLink>
    </div>
  </div>
</template>
