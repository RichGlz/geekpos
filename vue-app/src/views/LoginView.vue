<script setup lang="ts">
import { ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useAuthStore } from "@/modules/auth/auth.store";

const auth = useAuthStore();
const router = useRouter();
const route = useRoute();

const email = ref("");
const password = ref("");

async function submit(): Promise<void> {
  const ok = await auth.signIn(email.value, password.value);
  if (!ok) return;
  const redirect = typeof route.query["redirect"] === "string" ? route.query["redirect"] : null;
  await router.push(redirect ?? { name: "dashboard" });
}
</script>

<template>
  <div class="grid h-full place-items-center px-6">
    <div class="w-full max-w-sm">
      <h1 class="text-center font-display text-3xl tracking-wide text-brand">GEEKSIUM POS</h1>
      <p class="mt-2 text-center text-sm text-ink-muted">Accede con tu cuenta de trabajo</p>

      <form class="panel mt-8 space-y-4 p-6" novalidate @submit.prevent="submit">
        <div>
          <label for="email" class="mb-1.5 block text-sm text-ink-muted">Correo</label>
          <input
            id="email"
            v-model.trim="email"
            type="email"
            class="field"
            autocomplete="username"
            required
          />
        </div>

        <div>
          <label for="password" class="mb-1.5 block text-sm text-ink-muted">Contraseña</label>
          <input
            id="password"
            v-model="password"
            type="password"
            class="field"
            autocomplete="current-password"
            required
          />
        </div>

        <p v-if="auth.error" role="alert" class="text-sm text-danger">{{ auth.error }}</p>

        <button
          type="submit"
          class="w-full rounded-md bg-brand px-4 py-2.5 text-sm font-semibold text-brand-ink transition-colors hover:bg-brand-strong disabled:opacity-60"
          :disabled="auth.pending"
        >
          {{ auth.pending ? "Verificando…" : "Entrar" }}
        </button>
      </form>

      <p class="mt-4 text-center text-xs text-ink-subtle">
        Tras varios intentos fallidos el acceso se pausa unos minutos y se reactiva solo.
      </p>
    </div>
  </div>
</template>
