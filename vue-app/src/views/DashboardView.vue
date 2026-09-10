<script setup lang="ts">
import { computed } from "vue";
import { useAuthStore } from "@/modules/auth/auth.store";
import { useSyncStore } from "@/modules/system/sync.store";


const auth = useAuthStore();
const sync = useSyncStore();
const summary = computed(() => sync.context);
</script>

<template>
  <section>
    <h1 class="text-3xl">Resumen</h1>
    <p class="mt-1 text-sm text-ink-muted">
      Fase 1 del proyecto: base multiempresa, sesiones y licenciamiento en funcionamiento.
    </p>

    <p v-if="!summary" role="status" class="mt-6 text-sm text-ink-muted">Sincroniza para cargar los datos de tu organización.</p>

    <div class="mt-6 grid grid-cols-3 gap-4">
      <article class="panel p-5">
        <h2 class="text-xl">Organización</h2>
        <p class="mt-2 text-sm text-ink-muted">{{ summary?.organization?.name ?? "—" }}</p>
        <p class="text-xs text-ink-subtle">
          {{ summary?.organization?.currency }} · {{ summary?.organization?.timezone }}
        </p>
      </article>

      <article class="panel p-5">
        <h2 class="text-xl">Licencia</h2>
        <p class="mt-2 text-sm text-ink-muted">
          {{ summary?.license?.plan ?? "—" }} · {{ auth.licenseStatus ?? "—" }}
        </p>
        <p class="text-xs text-ink-subtle">La valida el servidor en cada operación.</p>
      </article>

      <article class="panel p-5">
        <h2 class="text-xl">Tu acceso</h2>
        <p class="mt-2 text-sm text-ink-muted">{{ auth.roles.join(", ") || "Sin rol asignado" }}</p>
        <p class="text-xs text-ink-subtle">{{ auth.permissions.length }} permisos efectivos</p>
      </article>
    </div>
  </section>
</template>
