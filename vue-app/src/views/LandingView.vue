<script setup lang="ts">
import { RouterLink } from "vue-router";

const capabilities = [
  {
    title: "Punto de venta rápido",
    body: "Cobro con teclado, múltiples formas de pago y tickets configurables por sucursal.",
  },
  {
    title: "Inventario real",
    body: "Existencias por almacén, unidades de compra y venta, y traspasos con saldo pendiente.",
  },
  {
    title: "Multiempresa",
    body: "Cada organización opera aislada, con sus sucursales, usuarios y licencia propia.",
  },
  {
    title: "Instalable como aplicación",
    body: "Se instala en el equipo o la tablet y carga al instante. La operación sin conexión llegará en una fase posterior.",
  },

];
</script>

<template>
  <div class="min-h-full">
    <header class="border-b border-line">
      <div class="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <span class="font-display text-2xl tracking-wide text-brand">GEEKSIUM POS</span>
        <RouterLink
          :to="{ name: 'login' }"
          class="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-brand-ink transition-colors hover:bg-brand-strong"
        >
          Entrar al sistema
        </RouterLink>
      </div>
    </header>

    <main class="mx-auto max-w-6xl px-6 py-16">
      <h1 class="max-w-3xl text-5xl leading-tight">
        El punto de venta para negocios que crecen a varias sucursales
      </h1>
      <p class="mt-5 max-w-2xl text-lg text-ink-muted">
        Ventas, inventario, traspasos y control de usuarios en un solo sistema. Sin hojas de
        cálculo sueltas y con el control de usuarios y licencias resuelto desde el servidor.
      </p>

      <div class="mt-10 flex gap-3">
        <RouterLink
          :to="{ name: 'login' }"
          class="rounded-md bg-brand px-5 py-3 text-sm font-semibold text-brand-ink transition-colors hover:bg-brand-strong"
        >
          Iniciar sesión
        </RouterLink>
        <a
          href="#capacidades"
          class="rounded-md border border-line-strong px-5 py-3 text-sm text-ink-muted transition-colors hover:border-brand hover:text-ink"
        >
          Ver capacidades
        </a>
      </div>

      <section id="capacidades" class="mt-20 grid grid-cols-2 gap-4">
        <article v-for="item in capabilities" :key="item.title" class="panel p-6">
          <h2 class="text-2xl text-ink">{{ item.title }}</h2>
          <p class="mt-2 text-sm text-ink-muted">{{ item.body }}</p>
        </article>
      </section>
    </main>

    <footer class="border-t border-line py-8 text-center text-xs text-ink-subtle">
      Geeksium POS · V1 en construcción
    </footer>
  </div>
</template>
