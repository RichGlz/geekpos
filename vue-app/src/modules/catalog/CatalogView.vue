<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { onBeforeRouteLeave } from "vue-router";
import { useSyncStore } from "@/modules/system/sync.store";
import { useAuthStore } from "@/modules/auth/auth.store";
import { useCriticalStore } from "@/modules/system/critical.store";
import { findMatches, normalizeName, type Product, type ProductInput, type CatalogCommand } from "@/lib/catalog";
import { queueCommands, type PendingImage } from "@/lib/offline/catalogDb";
import { processImage } from "@/lib/images";
import { getMeta, setMeta, STORE_ASSETS, STORE_SYNC_QUEUE, withStore } from "@/lib/offline/idb";
import type { SyncOperation } from "@/lib/offline/syncQueue";

const sync = useSyncStore(), auth = useAuthStore(), critical = useCriticalStore();
const query = ref(""), name = ref(""), barcode = ref(""), description = ref(""), category = ref(""), sku = ref("");
const baseUnit = ref("pieza"), itemType = ref<"product" | "service">("product");
const price = ref(""), cost = ref(""), trackInventory = ref(true), active = ref(true), localActive = ref(true);
const conversions = ref<Array<{ name: string; factor: string }>>([]);
const assetId = ref<string | null>(null), selected = ref<Product | null>(null);
const formMode = ref<"new" | "link" | "edit" | null>(null);
const allowDuplicate = ref(false), busy = ref(false), message = ref(""), error = ref("");
const image = ref<PendingImage>(), preview = ref<string | null>(null);
const selectedAlias = ref(""), reviewing = ref<SyncOperation | null>(null);
let releaseForm: (() => void) | undefined;
const canManage = computed(() => auth.can("catalog.manage") && !auth.isReadOnly &&
  (!sync.license || ["ACTIVE", "GRACE"].includes(sync.license.status)));
const canSetLocal = computed(() => !!sync.branchId && auth.can("price.change") && auth.can("cost.change"));
const canOverride = computed(() => auth.can("catalog.duplicate") && auth.roles.some((r) => ["OWNER","ADMIN","SUPERVISOR"].includes(r)));
const matches = computed(() => findMatches({ displayName: name.value, barcode: barcode.value },
  sync.products, sync.aliases, formMode.value === "edit" ? selected.value?.id : undefined).slice(0, 8));
const barcodeMatch = computed(() => formMode.value === "new" && matches.value.some((m) => m.reason === "barcode"));
const allProducts = computed(() => {
  const result = new Map(sync.products.map((p) => [p.id, p]));
  for (const op of sync.operations) {
    const c = op.payload as CatalogCommand;
    if (op.kind !== "catalog.command" || !c.product || op.status === "REQUIRES_REVIEW") continue;
    result.set(c.productId, {
      id: c.productId, organizationId: auth.user?.organizationId ?? "", ...c.product,
      ...normalizeName(c.product.displayName), revision: c.expectedRevision ?? 0, updatedAt: new Date(op.createdAt).toISOString(),
    });
  }
  return [...result.values()].sort((a, b) => a.displayName.localeCompare(b.displayName, "es"));
});
const filtered = computed(() => {
  const key = normalizeName(query.value).compactKey;
  if (!key) return allProducts.value;
  return allProducts.value.filter((p) => p.compactKey.includes(key) || p.barcode?.includes(query.value.trim()) ||
    sync.aliases.some((a) => a.productId === p.id && a.compactKey.includes(key)));
});
const localProduct = (id: string) => sync.branchProducts.find((p) => p.productId === id);
const editsLocal = computed(() => canSetLocal.value &&
  (formMode.value !== "edit" || !!(selected.value && localProduct(selected.value.id))));
const pending = (id: string) => sync.operations.some((op) => (op.payload as CatalogCommand).productId === id);
function clearPreview() { if (preview.value) URL.revokeObjectURL(preview.value); preview.value = null; }
function closeForm() {
  releaseForm?.(); releaseForm = undefined;
  formMode.value = null; reviewing.value = null; selected.value = null; image.value = undefined;
  clearPreview();
}
function openForm(mode: "new" | "link" | "edit", product?: Product) {
  closeForm();
  releaseForm = critical.enter("Edición de catálogo");
  formMode.value = mode; selected.value = product ?? null; error.value = ""; message.value = "";
  name.value = product?.displayName ?? ""; barcode.value = product?.barcode ?? ""; description.value = product?.description ?? "";
  category.value = product?.category ?? ""; sku.value = product?.sku ?? ""; baseUnit.value = product?.baseUnit ?? "pieza";
  itemType.value = product?.itemType ?? "product"; active.value = product?.active ?? true;
  assetId.value = product?.assetId ?? null; conversions.value = product ? JSON.parse(JSON.stringify(product.conversions)) : [];
  const local = mode === "edit" && product ? localProduct(product.id) : undefined;
  // Link copies only organization fields. Branch price/cost/stock are never copied.
  price.value = local?.price ?? ""; cost.value = local?.cost ?? "";
  localActive.value = local?.active ?? true; trackInventory.value = local?.trackInventory ?? itemType.value !== "service";
  allowDuplicate.value = false; selectedAlias.value = "";
  if (product?.assetId) void loadPreview(product.assetId);
}
async function loadPreview(id: string) {
  const rows = await withStore<{ value: { blob: Blob } } | undefined>(STORE_ASSETS, "readonly", (s) =>
    s.get(JSON.stringify([sync.scope, id]))).catch(() => undefined);
  if (assetId.value === id && rows?.value.blob) {
    clearPreview(); preview.value = URL.createObjectURL(rows.value.blob);
  }
}
function selectProduct(product: Product) {
  const typed = name.value;
  const operation = reviewing.value;
  openForm("link", product);
  reviewing.value = operation;
  selectedAlias.value = typed;
}
async function chooseImage(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  busy.value = true; error.value = "";
  try {
    image.value = await processImage(file);
    assetId.value = image.value.id;
    clearPreview(); preview.value = URL.createObjectURL(image.value.blob);
  } catch (caught) { error.value = caught instanceof Error ? caught.message : "No se pudo procesar la imagen."; }
  finally { busy.value = false; }
}
async function save() {
  if (!auth.user?.organizationId || !sync.scope || !canManage.value) return;
  busy.value = true; error.value = "";
  try {
    if (barcodeMatch.value) throw new Error("Selecciona el producto con ese código de barras.");
    if (formMode.value === "new" && matches.value.length && !allowDuplicate.value) throw new Error("Revisa las coincidencias antes de crear.");
    let deviceId = await getMeta<string>("deviceId");
    if (!deviceId) { deviceId = crypto.randomUUID(); await setMeta("deviceId", deviceId); }
    const productId = selected.value?.id ?? crypto.randomUUID();
    const commands: CatalogCommand[] = [];
    const product: ProductInput = {
      displayName: name.value.trim(), barcode: barcode.value.trim() || null, description: description.value,
      category: category.value, sku: sku.value, baseUnit: baseUnit.value, itemType: itemType.value,
      conversions: JSON.parse(JSON.stringify(conversions.value)), assetId: itemType.value === "service" ? null : assetId.value,
      active: active.value,
    };
    const branch = {
      price: price.value,
      cost: cost.value.trim() || null,
      trackInventory: trackInventory.value,
      active: formMode.value === "edit" ? localActive.value : true,
    };
    if (formMode.value === "new") {
      commands.push({ idempotencyKey: crypto.randomUUID(), deviceId, kind: "product.create", productId, product,
        allowDuplicate: allowDuplicate.value, ...(canSetLocal.value && sync.branchId ? { branchId: sync.branchId, branch } : {}) });
    } else if (formMode.value === "edit") {
      commands.push({ idempotencyKey: crypto.randomUUID(), deviceId, kind: "product.edit", productId, product,
        expectedRevision: selected.value!.revision, allowDuplicate: allowDuplicate.value });
    }
    if (formMode.value !== "new" && editsLocal.value && sync.branchId && active.value) {
      commands.push({ idempotencyKey: crypto.randomUUID(), deviceId, kind: "branch.set", productId,
        branchId: sync.branchId, branch, expectedRevision: localProduct(productId)?.revision ?? 0 });
    }
    if (formMode.value === "link" && selectedAlias.value.trim() &&
      normalizeName(selectedAlias.value).compactKey !== selected.value?.compactKey) {
      commands.push({ idempotencyKey: crypto.randomUUID(), deviceId, kind: "alias.add", productId, alias: selectedAlias.value });
    }
    if (!commands.length) throw new Error("Selecciona una sucursal para agregar el producto.");
    await queueCommands({
      scope: sync.scope, organizationId: auth.user.organizationId, userId: auth.user.id, commands,
      ...(sync.branchId ? { branchId: sync.branchId } : {}),
      ...(image.value && itemType.value !== "service" ? { image: image.value } : {}),
      ...(reviewing.value ? { replaceOperationId: reviewing.value.id } : {}),
    });
    closeForm(); await sync.reloadLocal();
    message.value = "Guardado en este dispositivo. Los cambios se enviarán al sincronizar.";
    void sync.sync(true);
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "No se guardó. Revisa el almacenamiento disponible (máximo 25 MB de imágenes pendientes).";
  } finally { busy.value = false; }
}
function review(operation: SyncOperation) {
  const command = operation.payload as CatalogCommand;
  const product = sync.products.find((p) => p.id === command.productId);
  openForm(command.kind === "product.create" ? "new" : command.kind === "product.edit" ? "edit" : "link", product);
  if (command.product) {
    name.value = command.product.displayName; barcode.value = command.product.barcode ?? "";
    description.value = command.product.description; category.value = command.product.category;
    sku.value = command.product.sku; baseUnit.value = command.product.baseUnit;
    itemType.value = command.product.itemType; conversions.value = command.product.conversions;
    assetId.value = command.product.assetId; active.value = command.product.active;
  }
  if (command.branch) { price.value = command.branch.price; cost.value = command.branch.cost ?? ""; }
  reviewing.value = operation;
}
async function discard(operation: SyncOperation) {
  if (!window.confirm("¿Descartar este cambio rechazado? Los datos confirmados en el servidor se conservarán.")) return;
  await withStore(STORE_SYNC_QUEUE, "readwrite", (s) => s.delete(operation.id));
  await sync.reloadLocal();
}
onBeforeRouteLeave(() => !formMode.value || window.confirm("Hay un formulario abierto. ¿Salir sin guardar?"));
onBeforeUnmount(closeForm);
watch(() => sync.scope, closeForm);
</script>

<template>
  <section class="mx-auto max-w-6xl space-y-5">
    <header class="flex flex-wrap items-end justify-between gap-4">
      <div><h1 class="text-3xl">Catálogo</h1><p class="mt-1 text-sm text-ink-muted">Productos compartidos; precio y costo de tu sucursal.</p></div>
      <button v-if="canManage" class="min-h-11 rounded bg-brand px-4 text-sm font-semibold text-brand-ink"
        :disabled="!sync.scope || !!formMode" @click="openForm('new')">Nuevo producto</button>
    </header>
    <div class="flex flex-wrap gap-4">
      <label class="grid gap-1 text-sm">Sucursal
        <select class="field" :value="sync.branchId ?? ''" :disabled="!!formMode || sync.syncState === 'syncing'"
          @change="sync.selectBranch(($event.target as HTMLSelectElement).value)">
          <option value="" disabled>Sin sucursal asignada</option>
          <option v-for="branch in sync.branches" :key="branch.id" :value="branch.id">{{ branch.name }}</option>
        </select>
      </label>
      <label class="grid flex-1 gap-1 text-sm">Buscar en el catálogo local
        <input v-model="query" type="search" class="field" placeholder="Nombre, alias o código de barras">
      </label>
    </div>
    <p v-if="message" role="status" class="text-sm text-brand">{{ message }}</p>
    <p v-if="sync.imageWarning" role="status" class="text-sm text-warning">{{ sync.imageWarning }}</p>

    <form v-if="formMode" class="panel space-y-4 p-5" @submit.prevent="save">
      <div class="flex justify-between gap-4">
        <h2 class="text-xl">{{ formMode === 'new' ? 'Crear producto' : formMode === 'link' ? 'Agregar a esta sucursal' : 'Editar producto' }}</h2>
        <button type="button" class="min-h-10 px-3 text-sm underline" :disabled="busy" @click="closeForm">Cancelar</button>
      </div>
      <div class="grid gap-4 md:grid-cols-2">
        <label class="grid gap-1 text-sm">Nombre *
          <input v-model="name" required maxlength="180" class="field" :readonly="formMode === 'link'" autocomplete="off">
        </label>
        <label class="grid gap-1 text-sm">Código de barras
          <input v-model="barcode" maxlength="80" class="field" :readonly="formMode === 'link'">
        </label>
      </div>
      <div v-if="formMode !== 'link' && matches.length" class="rounded border border-warning p-3 text-sm">
        <p class="font-semibold">{{ barcodeMatch ? 'Este código ya existe. Reutiliza el producto.' : 'Posible producto existente' }}</p>
        <ul class="mt-2 space-y-1">
          <li v-for="match in matches" :key="match.product.id">
            <button type="button" class="min-h-10 text-left underline" @click="selectProduct(match.product)">
              {{ match.product.displayName }} · {{ match.reason === 'barcode' ? 'Mismo código' : match.reason === 'exact' ? 'Nombre o alias coincidente' : 'Nombre similar' }}
              {{ match.product.active ? '' : '(archivado)' }}
            </button>
          </li>
        </ul>
        <label v-if="canOverride && !barcodeMatch" class="mt-3 flex min-h-10 items-center gap-2">
          <input v-model="allowDuplicate" type="checkbox"> Crear de todos modos (se registrará en auditoría)
        </label>
      </div>
      <fieldset :disabled="formMode === 'link'" class="grid gap-4 md:grid-cols-3">
        <label class="grid gap-1 text-sm">Tipo
          <select v-model="itemType" class="field"><option value="product">Producto</option><option value="service">Servicio</option></select>
        </label>
        <label class="grid gap-1 text-sm">Categoría<input v-model="category" maxlength="100" class="field"></label>
        <label class="grid gap-1 text-sm">SKU<input v-model="sku" maxlength="80" class="field"></label>
        <label class="grid gap-1 text-sm">Unidad base *<input v-model="baseUnit" required maxlength="30" class="field"></label>
        <label class="grid gap-1 text-sm md:col-span-2">Descripción<textarea v-model="description" maxlength="2000" class="field" rows="2" /></label>
      </fieldset>
      <fieldset :disabled="formMode === 'link'" class="space-y-2">
        <legend class="text-sm">Presentaciones y conversiones</legend>
        <div v-for="(conversion, index) in conversions" :key="index" class="flex flex-wrap items-center gap-2">
          <input v-model="conversion.name" required aria-label="Presentación" placeholder="Caja" class="field">
          <input v-model="conversion.factor" required pattern="(0|[1-9][0-9]*)(\.[0-9]{1,6})?" aria-label="Factor en unidad base" placeholder="12" class="field">
          <span class="text-sm">{{ baseUnit }}</span>
          <button type="button" class="min-h-10 px-3 underline" @click="conversions.splice(index, 1)">Quitar</button>
        </div>
        <button v-if="conversions.length < 20" type="button" class="min-h-10 text-sm underline"
          @click="conversions.push({ name: '', factor: '' })">Agregar conversión</button>
      </fieldset>
      <div class="flex flex-wrap items-center gap-4">
        <img v-if="itemType === 'service'" src="/icons/service.svg" alt="Servicio" class="size-20 rounded">
        <img v-else-if="preview" :src="preview" alt="Vista previa del producto" class="size-20 rounded object-contain">
        <label v-if="formMode !== 'link' && itemType !== 'service'" class="grid gap-1 text-sm">Imagen principal
          <input type="file" accept="image/jpeg,image/png,image/webp" :disabled="busy" @change="chooseImage">
          <span class="text-xs text-ink-muted">Se guarda como WebP de hasta 640 × 640 y 150 KB.</span>
        </label>
      </div>
      <fieldset v-if="editsLocal && active" class="grid gap-4 rounded border border-line-strong p-4 md:grid-cols-2">
        <legend class="px-2 text-sm">Datos de esta sucursal</legend>
        <label class="grid gap-1 text-sm" :class="!price ? 'text-warning' : ''">Precio de venta *
          <input v-model="price" required inputmode="decimal" pattern="(0|[1-9][0-9]{0,11})(\.[0-9]{1,2})?" class="field" placeholder="Obligatorio">
          <span class="text-xs text-ink-muted">Precio al público en esta sucursal.</span>
        </label>
        <label class="grid gap-1 text-sm">Costo de compra
          <input v-model="cost" inputmode="decimal" pattern="(0|[1-9][0-9]{0,11})(\.[0-9]{1,2})?" class="field" placeholder="Opcional">
          <span class="text-xs text-ink-muted">Costo unitario de adquisición para esta sucursal.</span>
        </label>
        <label class="grid gap-1 text-sm">
          <span class="flex min-h-10 items-center gap-2"><input v-model="trackInventory" type="checkbox"> Llevar control de inventario</span>
          <span class="text-xs text-ink-muted">Registrar existencias, entradas y salidas de este producto.</span>
        </label>
        <label v-if="formMode === 'edit'" class="flex min-h-10 items-center gap-2 text-sm"><input v-model="localActive" type="checkbox"> Activo en esta sucursal</label>
        <p v-else class="text-sm">Estado: <span class="font-semibold">Activo</span></p>
      </fieldset>
      <label v-if="formMode === 'edit'" class="flex min-h-10 items-center gap-2 text-sm">
        <input v-model="active" type="checkbox"> Activo en el catálogo de la organización
      </label>
      <p v-if="error" role="alert" class="text-sm text-danger">{{ error }}</p>
      <button type="submit" class="min-h-11 rounded bg-brand px-5 text-sm font-semibold text-brand-ink disabled:opacity-50"
        :disabled="busy || !canManage || !!barcodeMatch">{{ busy ? 'Guardando…' : 'Guardar en este dispositivo' }}</button>
    </form>

    <div v-if="sync.operations.some((op) => op.status === 'REQUIRES_REVIEW')" class="panel p-4">
      <h2 class="text-lg">Cambios que requieren revisión</h2>
      <ul class="mt-2 space-y-2">
        <li v-for="op in sync.operations.filter((item) => item.status === 'REQUIRES_REVIEW')" :key="op.id" class="flex flex-wrap items-center gap-3 text-sm">
          <span>{{ (op.payload as CatalogCommand).product?.displayName ?? 'Cambio de catálogo' }}: {{ op.lastError }}</span>
          <button type="button" class="min-h-10 underline" :disabled="!!formMode" @click="review(op)">Revisar</button>
          <button type="button" class="min-h-10 underline" @click="discard(op)">Descartar cambio</button>
        </li>
      </ul>
    </div>
    <div class="panel overflow-x-auto">
      <table class="w-full text-left text-sm">
        <thead class="border-b border-line text-ink-muted"><tr>
          <th class="p-3">Producto</th><th class="p-3">Código</th><th class="p-3">Precio de venta</th>
          <th v-if="auth.can('cost.read')" class="p-3">Costo de compra</th><th class="p-3">Estado</th><th class="p-3"><span class="sr-only">Acciones</span></th>
        </tr></thead>
        <tbody><tr v-for="product in filtered" :key="product.id" class="border-b border-line">
          <td class="p-3"><span class="font-semibold">{{ product.displayName }}</span><span class="block text-xs text-ink-muted">{{ product.category }} · {{ product.baseUnit }}</span></td>
          <td class="p-3">{{ product.barcode ?? '—' }}</td>
          <td class="p-3">{{ localProduct(product.id)?.price ?? 'Sin asignar' }}</td>
          <td v-if="auth.can('cost.read')" class="p-3">{{ localProduct(product.id)?.cost ?? 'Sin asignar' }}</td>
          <td class="p-3">{{ pending(product.id) ? 'Pendiente' : !product.active ? 'Archivado' : localProduct(product.id)?.active ? 'En sucursal' : 'Catálogo global' }}</td>
          <td class="p-3"><button v-if="canManage" type="button" class="min-h-10 px-3 underline"
            :disabled="!!formMode || pending(product.id)" @click="openForm(localProduct(product.id) || !product.active ? 'edit' : 'link', product)">
            {{ localProduct(product.id) || !product.active ? 'Editar' : 'Agregar' }}
          </button>
          <button v-if="canManage && product.active && !localProduct(product.id)" type="button"
            class="min-h-10 px-3 underline" :disabled="!!formMode || pending(product.id)"
            @click="openForm('edit', product)">Editar catálogo</button></td>
        </tr></tbody>
      </table>
      <p v-if="!filtered.length" class="p-8 text-center text-sm text-ink-muted">{{ query ? 'No hay coincidencias en este dispositivo.' : 'Aún no hay productos. Sincroniza o crea el primero.' }}</p>
    </div>
  </section>
</template>
<style scoped>
.field { min-height: 2.75rem; border: 1px solid var(--color-line-strong); border-radius: .375rem; padding: .5rem .75rem; background: var(--color-surface-inset); color: var(--color-ink); }
.field:focus-visible { outline: 2px solid var(--color-brand); outline-offset: 2px; }
button:disabled, fieldset:disabled { opacity: .6; }
</style>
