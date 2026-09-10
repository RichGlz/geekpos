<script setup lang="ts">
import { computed } from "vue";
import { RouterLink, RouterView, useRouter } from "vue-router";
import { useAuthStore } from "@/modules/auth/auth.store";

const auth = useAuthStore();
const router = useRouter();

const navigation = [
  { to: { name: "dashboard" }, label: "Resumen", hint: "Estado general" },
  { to: { name: "pos" }, label: "Punto de venta", hint: "F2" },
  { to: { name: "inventory" }, label: "Inventario", hint: "Existencias" },
  { to: { name: "transfers" }, label: "Traspasos", hint: "Entre almacenes" },
  { to: { name: "catalog" }, label: "Catálogo", hint: "Productos y unidades" },
  { to: { name: "sessions" }, label: "Sesiones", hint: "Seguridad" },
];

const initials = computed(() =>
  (auth.user?.fullName ?? "")
    .split(" ")
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join(""),
);

async function signOut(): Promise<void> {
  await auth.signOut();
  await router.push({ name: "login" });
}
</script>

<template>
  <div class="grid h-full grid-cols-[15rem_1fr] grid-rows-[3.5rem_1fr]">
    <header
      class="col-span-2 flex items-center justify-between border-b border-line bg-surface-raised px-5"
    >
      <div class="flex items-center gap-3">
        <span class="font-display text-xl tracking-wide text-brand">GEEKSIUM POS</span>
        <span class="text-xs text-ink-subtle">v1 · fase 1</span>
      </div>
      <div class="flex items-center gap-4">
        <span
          v-if="auth.licenseWarning"
          class="rounded-md bg-surface-overlay px-3 py-1 text-xs text-warning"
        >
          {{ auth.licenseWarning }}
        </span>
        <div class="flex items-center gap-2 text-sm">
          <span
            class="grid size-8 place-items-center rounded-full bg-brand text-xs font-semibold text-brand-ink"
            aria-hidden="true"
          >
            {{ initials }}
          </span>
          <span class="text-ink-muted">{{ auth.user?.fullName }}</span>
        </div>
        <button
          type="button"
          aria-label="Cerrar sesión"
          class="rounded-md border border-line-strong px-3 py-1.5 text-sm text-ink-muted transition-colors hover:border-brand hover:text-ink"
          @click="signOut"
        >
          Salir
        </button>
      </div>
    </header>

    <nav class="border-r border-line bg-surface-inset p-3" aria-label="Navegación principal">
      <ul class="space-y-1">
        <li v-for="item in navigation" :key="item.label">
          <RouterLink
            :to="item.to"
            class="block rounded-md px-3 py-2 text-sm text-ink-muted transition-colors hover:bg-surface-overlay hover:text-ink"
            active-class="bg-surface-overlay text-ink"
          >
            <span class="block">{{ item.label }}</span>
            <span class="block text-xs text-ink-subtle">{{ item.hint }}</span>
          </RouterLink>
        </li>
      </ul>
    </nav>

    <main class="overflow-auto p-6 pb-32">
      <RouterView />
    </main>
  </div>
</template>
