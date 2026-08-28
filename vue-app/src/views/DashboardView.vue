<script setup lang="ts">
import { onMounted, ref } from "vue";
import { http } from "@/lib/http";
import { useAuthStore } from "@/modules/auth/auth.store";

interface OrganizationSummary {
  organization: { name: string; slug: string; timezone: string; currency: string } | null;
  license: { status: string | null; plan: string; expiresAt: string | null } | null;
}

const auth = useAuthStore();
const summary = ref<OrganizationSummary | null>(null);
const loadError = ref<string | null>(null);

onMounted(async () => {
  try {
    const { data } = await http.get<OrganizationSummary>("/organization/me");
    summary.value = data;
  } catch {
    loadError.value = "No fue posible cargar los datos de la organización.";
  }
});
</script>

<template>
  <section>
    <h1 class="text-3xl">Resumen</h1>
    <p class="mt-1 text-sm text-ink-muted">
      Fase 1 del proyecto: base multiempresa, sesiones y licenciamiento en funcionamiento.
    </p>

    <p v-if="loadError" role="alert" class="mt-6 text-sm text-danger">{{ loadError }}</p>

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
