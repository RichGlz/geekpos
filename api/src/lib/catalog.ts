/** Pure, provider-independent catalog rules shared with Vue and future CSV imports. */
export interface Product {
  id: string;
  organizationId: string;
  displayName: string;
  normalizedName: string;
  compactKey: string;
  barcode: string | null;
  description: string;
  category: string;
  sku: string;
  itemType: "product" | "service";
  baseUnit: string;
  conversions: Array<{ name: string; factor: string }>;
  assetId: string | null;
  active: boolean;
  revision: number;
  updatedAt: string;
}
export interface ProductAlias {
  id: string;
  productId: string;
  organizationId: string;
  displayName: string;
  normalizedName: string;
  compactKey: string;
}
export interface BranchProduct {
  id: string;
  organizationId: string;
  branchId: string;
  productId: string;
  price: string;
  cost: string | null;
  stock: string;
  trackInventory: boolean;
  active: boolean;
  revision: number;
  updatedAt: string;
}
export interface Asset {
  id: string;
  organizationId: string;
  contentHash: string;
  mimeType: "image/webp";
  width: number;
  height: number;
  sizeBytes: number;
}
export type ProductInput = Pick<Product,
  "displayName" | "barcode" | "description" | "category" | "sku" | "itemType" |
  "baseUnit" | "conversions" | "assetId" | "active">;
export interface CatalogCommand {
  idempotencyKey: string;
  deviceId: string;
  kind: "product.create" | "product.edit" | "branch.set" | "alias.add";
  productId: string;
  branchId?: string;
  expectedRevision?: number;
  product?: ProductInput;
  branch?: { price: string; cost: string | null; trackInventory: boolean; active: boolean };
  alias?: string;
  allowDuplicate?: boolean;
}
export interface CatalogChanges {
  products: Product[];
  productAliases: ProductAlias[];
  branchProducts: BranchProduct[];
  inventoryMovements?: import("./inventory.js").InventoryMovement[];
}

export function normalizeName(input: string): { normalizedName: string; compactKey: string } {
  const normalizedName = input.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/(\d)[.,](?=\d)/g, "$1.")
    .replace(/(\d)\s*(mililitros?|mls?)\b/g, "$1 ml")
    .replace(/(\d)\s*(litros?|lts?|l)\b/g, "$1 l")
    .replace(/(\d)\s*(kilogramos?|kgs?|kilos?)\b/g, "$1 kg")
    .replace(/(\d)\s*(gramos?|grs?|g)\b/g, "$1 g")
    // Keep decimal points: 1.5 l must not collapse into 15 l.
    .replace(/(?<!\d)\.|\.(?!\d)|[^\p{L}\p{N}.\s]/gu, " ")
    .replace(/\s+/g, " ").trim();
  return { normalizedName, compactKey: normalizedName.replace(/\s/g, "") };
}
export function normalizeBarcode(input: string | null | undefined): string | null {
  return input?.trim() || null; // String throughout: leading zeros are significant.
}
export interface Match { product: Product; reason: "barcode" | "exact" | "similar"; score: number }
function bigrams(value: string): Set<string> {
  return new Set(Array.from({ length: Math.max(0, value.length - 1) }, (_, i) => value.slice(i, i + 2)));
}
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const left = bigrams(a), right = bigrams(b);
  if (!left.size || !right.size) return 0;
  return 2 * [...left].filter((v) => right.has(v)).length / (left.size + right.size);
}
export function findMatches(
  input: { displayName: string; barcode?: string | null },
  products: Product[], aliases: ProductAlias[], excludeId?: string,
): Match[] {
  const key = normalizeName(input.displayName).compactKey;
  const barcode = normalizeBarcode(input.barcode);
  return products.filter((p) => p.id !== excludeId).map((product): Match => {
    if (barcode && product.barcode === barcode) return { product, reason: "barcode", score: 1 };
    const keys = [product.compactKey, ...aliases.filter((a) => a.productId === product.id).map((a) => a.compactKey)];
    if (key && keys.includes(key)) return { product, reason: "exact", score: 1 };
    return { product, reason: "similar", score: key ? Math.max(...keys.map((k) => similarity(key, k))) : 0 };
  }).filter((m) => m.score >= 0.72)
    .sort((a, b) => Number(b.reason === "barcode") - Number(a.reason === "barcode") || b.score - a.score);
}
/** CSV rows go through this same classification before any insertion. No automatic fuzzy merge. */
export function classifyImportRow(input: ProductInput, products: Product[], aliases: ProductAlias[]) {
  if (!input.displayName.trim() || !input.baseUnit.trim()) return { status: "error" as const, matches: [] };
  const matches = findMatches(input, products, aliases);
  const status = matches.some((m) => m.reason === "barcode") ? "exact" :
    matches.length ? "review" : "new";
  return { status, matches };
}
