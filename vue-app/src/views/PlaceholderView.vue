<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";

const route = useRoute();
const title = computed(() => (route.meta["title"] as string | undefined) ?? "Módulo");
</script>

<template>
  <section>
    <h1 class="text-3xl">{{ title }}</h1>
    <p class="mt-2 max-w-2xl text-sm text-ink-muted">
      Este módulo forma parte del alcance de V1 y se construirá en las siguientes fases sobre la
      base multiempresa ya instalada. La navegación y los permisos ya están preparados.
    </p>
  </section>
</template>
