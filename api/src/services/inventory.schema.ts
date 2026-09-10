import { z } from "zod";
import { badRequest } from "../lib/errors.js";

const quantity = z.string()
  .regex(/^-?(0|[1-9]\d{0,11})(\.\d{1,6})?$/, "Cantidad decimal inválida.")
  .refine((value) => Number(value) !== 0, "La cantidad no puede ser cero.");

export const inventoryCommandSchema = z.object({
  id: z.string().uuid(),
  idempotencyKey: z.string().uuid(),
  deviceId: z.string().uuid(),
  branchId: z.string().uuid(),
  productId: z.string().uuid(),
  warehouseId: z.string().uuid().nullable().optional(),
  type: z.enum(["INITIAL", "ENTRY", "EXIT", "ADJUSTMENT"]),
  quantity,
  unit: z.string().trim().min(1).max(60),
  occurredAt: z.string().datetime({ offset: true }),
  comment: z.string().trim().max(500).nullable().optional(),
  reference: z.string().trim().max(120).nullable().optional(),
}).strict().superRefine((value, ctx) => {
  if (value.type !== "ADJUSTMENT" && Number(value.quantity) < 0) {
    ctx.addIssue({ code: "custom", path: ["quantity"], message: "Usa una cantidad positiva para este movimiento." });
  }
  if (value.type === "ADJUSTMENT" && !value.comment?.trim()) {
    ctx.addIssue({ code: "custom", path: ["comment"], message: "El ajuste requiere un motivo." });
  }
});

export function parseInventory<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw badRequest("Datos de inventario inválidos.", result.error.flatten());
  return result.data;
}
