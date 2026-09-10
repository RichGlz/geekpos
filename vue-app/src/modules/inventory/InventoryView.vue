<script setup lang="ts">
import { computed, ref, onBeforeUnmount, watch } from "vue";
import { useAuthStore } from "@/modules/auth/auth.store";
import { useSyncStore } from "@/modules/system/sync.store";
import { useCriticalStore } from "@/modules/system/critical.store";
import { getMeta, setMeta } from "@/lib/offline/idb";
import { queueInventoryMovement } from "@/lib/offline/inventoryDb";
import type { Product } from "@/lib/catalog";
import type { InventoryMovementType } from "@/lib/inventory";

const auth = useAuthStore(), sync = useSyncStore(), critical = useCriticalStore();
const query = ref("");
const selected = ref<Product | null>(null);
const movementType = ref<"INITIAL" | "ENTRY" | "EXIT" | "ADJUSTMENT">("ENTRY");
const quantity = ref("");
const unit = ref("");
const comment = ref("");
const reference = ref("");
const busy = ref(false), error = ref(""), message = ref("");
const historyProductId = ref<string | null>(null);
let releaseForm: (() => void) | undefined;

const canManage = computed(() => auth.can("inventory.manage") && !auth.isReadOnly &&
  (!sync.license || ["ACTIVE", "GRACE"].includes(sync.license.status)));
const rows = computed(() => sync.branchProducts
  .filter((branch) => branch.branchId === sync.branchId && branch.trackInventory)
  .map((branch) => ({ branch, product: sync.products.find((product) => product.id === branch.productId) }))
  .filter((row): row is { branch: typeof sync.branchProducts[number]; product: Product } => !!row.product)
  .filter((row) => {
    const key = query.value.trim().toLocaleLowerCase("es-MX");
    return !key || row.product.displayName.toLocaleLowerCase("es-MX").includes(key) ||
      row.product.sku.toLocaleLowerCase("es-MX").includes(key) || row.product.barcode?.includes(query.value.trim());
  }));
const history = computed(() => sync.inventoryMovements
  .filter((movement) => !historyProductId.value || movement.productId === historyProductId.value)
  .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)));
const units = computed(() => selected.value
  ? [selected.value.baseUnit, ...selected.value.conversions.map((conversion) => conversion.name)] : []);
const hasMovements = (productId: string) => sync.inventoryMovements.some((movement) => movement.productId === productId);
const productName = (productId: string) => sync.products.find((product) => product.id === productId)?.displayName ?? "Producto";
const typeLabel = (type: InventoryMovementType) => ({
  INITIAL: "Inventario inicial", ENTRY: "Entrada", EXIT: "Salida", ADJUSTMENT: "Ajuste",
  SALE: "Venta", RETURN: "Devolución", TRANSFER_IN: "Traspaso entrada",
  TRANSFER_OUT: "Traspaso salida", WASTE: "Merma",
})[type];

function openMovement(product: Product, type: "INITIAL" | "ENTRY" | "EXIT" | "ADJUSTMENT") {
  closeForm();
  selected.value = product; movementType.value = type; quantity.value = "";
  unit.value = product.baseUnit; comment.value = ""; reference.value = ""; error.value = "";
  releaseForm = critical.enter("Movimiento de inventario");
}
function closeForm() {
  releaseForm?.(); releaseForm = undefined; selected.value = null; error.value = "";
}
async function save() {
  const product = selected.value;
  const branch = product && sync.branchProducts.find((item) => item.productId === product.id && item.branchId === sync.branchId);
  if (!product || !branch || !auth.user?.organizationId || !sync.scope || !sync.branchId || !canManage.value) return;
  busy.value = true; error.value = "";
  try {
    let deviceId = await getMeta<string>("deviceId");
    if (!deviceId) { deviceId = crypto.randomUUID(); await setMeta("deviceId", deviceId); }
    const id = crypto.randomUUID();
    await queueInventoryMovement({
      scope: sync.scope, organizationId: auth.user.organizationId, userId: auth.user.id,
      product, branchProduct: branch,
      command: {
        id, idempotencyKey: crypto.randomUUID(), deviceId, branchId: sync.branchId,
        productId: product.id, type: movementType.value, quantity: quantity.value,
        unit: unit.value, occurredAt: new Date().toISOString(),
        comment: comment.value.trim() || null, reference: reference.value.trim() || null,
      },
    });
    closeForm(); await sync.reloadLocal();
    message.value = "Movimiento guardado en este dispositivo.";
    void sync.sync(true);
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "No se guardó el movimiento.";
  } finally { busy.value = false; }
}
function showHistory(productId: string) { historyProductId.value = productId; }
watch(() => sync.scope, () => { closeForm(); historyProductId.value = null; });
onBeforeUnmount(closeForm);
</script>

<template>
  <section class="mx-auto max-w-6xl space-y-5">
    <header>
      <h1 class="text-3xl">Inventario</h1>
      <p class="mt-1 text-sm text-ink-muted">Existencias locales derivadas de movimientos.</p>
    </header>
    <div class="flex flex-wrap gap-4">
      <label class="grid gap-1 text-sm">Sucursal
        <select class="field" :value="sync.branchId ?? ''" :disabled="!!selected || sync.syncState === 'syncing'"
          @change="sync.selectBranch(($event.target as HTMLSelectElement).value)">
          <option value="" disabled>Sin sucursal asignada</option>
          <option v-for="branch in sync.branches" :key="branch.id" :value="branch.id">{{ branch.name }}</option>
        </select>
      </label>
      <label class="grid flex-1 gap-1 text-sm">Buscar localmente
        <input v-model="query" type="search" class="field" placeholder="Producto, SKU o código de barras">
      </label>
    </div>
    <p v-if="message" role="status" class="text-sm text-brand">{{ message }}</p>

    <form v-if="selected" class="panel space-y-4 p-5" @submit.prevent="save">
      <div class="flex justify-between gap-4">
        <div><h2 class="text-xl">{{ typeLabel(movementType) }}</h2><p class="text-sm text-ink-muted">{{ selected.displayName }}</p></div>
        <button type="button" class="min-h-10 px-3 underline" :disabled="busy" @click="closeForm">Cancelar</button>
      </div>
      <div class="grid gap-4 md:grid-cols-2">
        <label class="grid gap-1 text-sm">Cantidad *
          <input v-model="quantity" required inputmode="decimal" class="field"
            :placeholder="movementType === 'ADJUSTMENT' ? 'Usa + o -' : 'Cantidad positiva'"
            pattern="-?(0|[1-9][0-9]{0,11})(\.[0-9]{1,6})?">
        </label>
        <label class="grid gap-1 text-sm">Unidad *
          <select v-model="unit" required class="field"><option v-for="value in units" :key="value" :value="value">{{ value }}</option></select>
        </label>
        <label class="grid gap-1 text-sm md:col-span-2">Motivo {{ movementType === 'ADJUSTMENT' ? '*' : '(opcional)' }}
          <textarea v-model="comment" class="field" rows="2" maxlength="500" :required="movementType === 'ADJUSTMENT'" />
        </label>
        <label class="grid gap-1 text-sm md:col-span-2">Referencia (opcional)
          <input v-model="reference" class="field" maxlength="120">
        </label>
      </div>
      <p v-if="error" role="alert" class="text-sm text-danger">{{ error }}</p>
      <button class="min-h-11 rounded bg-brand px-5 text-sm font-semibold text-brand-ink disabled:opacity-50"
        :disabled="busy || !canManage">{{ busy ? 'Guardando…' : 'Guardar movimiento' }}</button>
    </form>

    <div class="panel overflow-x-auto">
      <table class="w-full text-left text-sm">
        <thead class="border-b border-line text-ink-muted"><tr><th class="p-3">Producto</th><th class="p-3">SKU / código</th>
          <th class="p-3">Stock actual</th><th class="p-3">Unidad base</th><th class="p-3">Estado</th><th class="p-3">Acciones</th></tr></thead>
        <tbody><tr v-for="row in rows" :key="row.branch.id" class="border-b border-line">
          <td class="p-3 font-semibold">{{ row.product.displayName }}</td>
          <td class="p-3">{{ row.product.sku || row.product.barcode || '—' }}</td>
          <td class="p-3">{{ row.branch.stock }}</td><td class="p-3">{{ row.product.baseUnit }}</td>
          <td class="p-3">{{ row.branch.active ? 'Activo' : 'Inactivo' }}</td>
          <td class="p-3"><div class="flex flex-wrap gap-2">
            <button v-if="canManage && row.branch.active && row.product.active && !hasMovements(row.product.id)" type="button" class="min-h-10 underline" @click="openMovement(row.product, 'INITIAL')">Registrar inventario inicial</button>
            <template v-if="canManage && row.branch.active && row.product.active && hasMovements(row.product.id)">
              <button type="button" class="min-h-10 underline" @click="openMovement(row.product, 'ENTRY')">Registrar entrada</button>
              <button type="button" class="min-h-10 underline" @click="openMovement(row.product, 'EXIT')">Registrar salida</button>
              <button type="button" class="min-h-10 underline" @click="openMovement(row.product, 'ADJUSTMENT')">Registrar ajuste</button>
            </template>
            <button type="button" class="min-h-10 underline" @click="showHistory(row.product.id)">Ver movimientos</button>
          </div></td>
        </tr></tbody>
      </table>
      <p v-if="!rows.length" class="p-8 text-center text-sm text-ink-muted">No hay productos con control de inventario en esta sucursal.</p>
    </div>

    <div class="panel overflow-x-auto">
      <div class="flex items-center justify-between p-4"><h2 class="text-xl">Movimientos</h2>
        <button v-if="historyProductId" type="button" class="min-h-10 underline" @click="historyProductId = null">Ver todos</button></div>
      <table class="w-full text-left text-sm">
        <thead class="border-b border-line text-ink-muted"><tr><th class="p-3">Fecha</th><th class="p-3">Producto</th>
          <th class="p-3">Tipo</th><th class="p-3">Cantidad</th><th class="p-3">Usuario</th><th class="p-3">Motivo / referencia</th><th class="p-3">Sync</th></tr></thead>
        <tbody><tr v-for="movement in history" :key="movement.id" class="border-b border-line">
          <td class="p-3">{{ new Date(movement.occurredAt).toLocaleString('es-MX') }}</td>
          <td class="p-3">{{ productName(movement.productId) }}</td><td class="p-3">{{ typeLabel(movement.type) }}</td>
          <td class="p-3">{{ movement.baseQuantityDelta }}</td><td class="p-3">{{ movement.userId === auth.user?.id ? 'Tú' : movement.userId }}</td>
          <td class="p-3">{{ movement.comment || movement.reference || '—' }}</td>
          <td class="p-3">{{ movement.syncState === 'PENDING_SYNC' ? 'Pendiente' : 'Sincronizado' }}</td>
        </tr></tbody>
      </table>
      <p v-if="!history.length" class="p-8 text-center text-sm text-ink-muted">Aún no hay movimientos.</p>
    </div>
  </section>
</template>

<style scoped>
.field { min-height: 2.75rem; border: 1px solid var(--color-line-strong); border-radius: .375rem; padding: .5rem .75rem; background: var(--color-surface-inset); color: var(--color-ink); }
.field:focus-visible { outline: 2px solid var(--color-brand); outline-offset: 2px; }
</style>
