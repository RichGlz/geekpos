export type InventoryMovementType =
  | "INITIAL" | "ENTRY" | "EXIT" | "ADJUSTMENT"
  | "SALE" | "RETURN" | "TRANSFER_IN" | "TRANSFER_OUT" | "WASTE";

export interface InventoryMovement {
  id: string;
  organizationId: string;
  branchId: string;
  productId: string;
  warehouseId: string | null;
  type: InventoryMovementType;
  quantity: string;
  unit: string;
  baseQuantityDelta: string;
  userId: string;
  occurredAt: string;
  comment: string | null;
  reference: string | null;
  idempotencyKey: string;
  syncState: "PENDING_SYNC" | "SYNCED";
  createdAt: string;
}

export interface InventoryCommand {
  id: string;
  idempotencyKey: string;
  deviceId: string;
  branchId: string;
  productId: string;
  warehouseId?: string | null;
  type: "INITIAL" | "ENTRY" | "EXIT" | "ADJUSTMENT";
  /** Positiva salvo ADJUSTMENT, que acepta signo. */
  quantity: string;
  unit: string;
  occurredAt: string;
  comment?: string | null;
  reference?: string | null;
}

export class InventoryCalculationError extends Error {
  constructor(public readonly code: "UNIT" | "QUANTITY" | "INSUFFICIENT" | "RANGE", message: string) {
    super(message);
    this.name = "InventoryCalculationError";
  }
}

const SCALE = 1_000_000n;
const MAX_NUMERIC_18_6 = 999_999_999_999_999_999n;
function scaled(value: string): bigint {
  const match = /^(-?)(\d+)(?:\.(\d{1,6}))?$/.exec(value);
  if (!match) throw new InventoryCalculationError("QUANTITY", "La cantidad no es válida.");
  const result = BigInt(match[2]!) * SCALE + BigInt((match[3] ?? "").padEnd(6, "0"));
  return match[1] ? -result : result;
}
function multiply(left: bigint, right: bigint): bigint {
  const product = left * right;
  const quotient = product / SCALE;
  const remainder = product % SCALE;
  if (remainder === 0n) return quotient;
  return (remainder < 0n ? -remainder : remainder) * 2n >= SCALE
    ? quotient + (product < 0n ? -1n : 1n) : quotient;
}
function decimal(value: bigint): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const fraction = (absolute % SCALE).toString().padStart(6, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${absolute / SCALE}${fraction ? `.${fraction}` : ""}`;
}

/** Cálculo decimal exacto (escala 6) compartido por API e IndexedDB. */
export function calculateInventoryStock(
  product: { baseUnit: string; conversions: Array<{ name: string; factor: string }> },
  command: Pick<InventoryCommand, "type" | "quantity" | "unit">,
  currentStock: string,
): { delta: string; nextStock: string } {
  const factorText = command.unit.localeCompare(product.baseUnit, "es", { sensitivity: "base" }) === 0
    ? "1" : product.conversions.find((item) =>
        item.name.localeCompare(command.unit, "es", { sensitivity: "base" }) === 0)?.factor;
  if (!factorText) throw new InventoryCalculationError("UNIT", "La unidad no corresponde al producto.");
  let delta = multiply(scaled(command.quantity), scaled(factorText));
  if (command.type === "EXIT") delta = -(delta < 0n ? -delta : delta);
  if (delta === 0n) throw new InventoryCalculationError("QUANTITY", "La cantidad convertida no es válida.");
  const next = scaled(currentStock) + delta;
  if (next < 0n) throw new InventoryCalculationError("INSUFFICIENT", "La salida dejaría existencias negativas.");
  if (next > MAX_NUMERIC_18_6 || next < -MAX_NUMERIC_18_6) {
    throw new InventoryCalculationError("RANGE", "La existencia excede el rango permitido.");
  }
  return { delta: decimal(delta), nextStock: decimal(next) };
}
