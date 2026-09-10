import { z } from "zod";
import { badRequest } from "../lib/errors.js";
const money = z.string().regex(/^(0|[1-9]\d{0,11})(\.\d{1,2})?$/, "Importe decimal no negativo.");
export const productSchema = z.object({
  displayName: z.string().trim().min(1).max(180),
  barcode: z.string().trim().max(80).nullable().transform((v) => v || null),
  description: z.string().max(2000).default(""),
  category: z.string().trim().max(100).default(""),
  sku: z.string().trim().max(80).default(""),
  itemType: z.enum(["product", "service"]).default("product"),
  baseUnit: z.string().trim().min(1).max(30),
  conversions: z.array(z.object({
    name: z.string().trim().min(1).max(60),
    factor: z.string().regex(/^(0|[1-9]\d{0,8})(\.\d{1,6})?$/).refine((v) => Number(v) > 0),
  }).strict()).max(20).default([]),
  assetId: z.string().uuid().nullable().default(null),
  active: z.boolean().default(true),
}).strict();
export const commandSchema = z.object({
  idempotencyKey: z.string().uuid(),
  deviceId: z.string().uuid(),
  kind: z.enum(["product.create", "product.edit", "branch.set", "alias.add"]),
  productId: z.string().uuid(),
  branchId: z.string().uuid().optional(),
  expectedRevision: z.number().int().nonnegative().optional(),
  product: productSchema.optional(),
  branch: z.object({
    price: money, cost: money, trackInventory: z.boolean(), active: z.boolean(),
  }).strict().optional(),
  alias: z.string().trim().min(1).max(180).optional(),
  allowDuplicate: z.boolean().optional(),
}).strict().superRefine((c, ctx) => {
  if (c.kind.startsWith("product.") && !c.product ||
    c.kind === "branch.set" && (!c.branch || !c.branchId) ||
    c.kind === "alias.add" && !c.alias ||
    (c.kind === "product.edit" || c.kind === "branch.set") && c.expectedRevision === undefined) {
    ctx.addIssue({ code: "custom", message: "Faltan los datos de la operación o su revisión." });
  }
  // Each command owns one concurrency boundary. Mixing product.edit + branch
  // fields would otherwise bypass the branch's expectedRevision check.
  const hasBranch = c.branch !== undefined || c.branchId !== undefined;
  const invalid =
    c.kind === "product.create" && (c.expectedRevision !== undefined || c.alias !== undefined || (!!c.branch !== !!c.branchId)) ||
    c.kind === "product.edit" && (hasBranch || c.alias !== undefined || (c.expectedRevision ?? 0) < 1) ||
    c.kind === "branch.set" && (c.product !== undefined || c.alias !== undefined || c.allowDuplicate !== undefined) ||
    c.kind === "alias.add" && (hasBranch || c.product !== undefined || c.expectedRevision !== undefined || c.allowDuplicate !== undefined);
  if (invalid) ctx.addIssue({ code: "custom", message: "No combines datos de operaciones distintas." });
});
export function parse<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw badRequest("Datos de catálogo inválidos.", result.error.flatten());
  return result.data;
}
