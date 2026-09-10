import { createHash, randomUUID } from "node:crypto";
import type { AppEnv } from "../config/env.js";
import type { TransactionalDb } from "../db/pool.js";
import { AppError, badRequest, notFound } from "../lib/errors.js";
import * as repo from "../repositories/catalog.repository.js";
import type { TenantContext } from "../types/domain.js";
import { demand } from "./catalog.service.js";
import { assertOperationAllowed } from "./license.service.js";

export const MAX_IMAGE_BYTES = 150 * 1024;
/** Validate encoded format/dimensions rather than trusting browser-supplied metadata. */
export function inspectWebP(bytes: Buffer): { width: number; height: number; contentHash: string } {
  if (bytes.length < 30 || bytes.length > MAX_IMAGE_BYTES ||
    bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WEBP" ||
    bytes.readUInt32LE(4) + 8 !== bytes.length) throw badRequest("Se requiere WebP de hasta 150 KB.");
  let width = 0, height = 0;
  let imageChunk = false;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const kind = bytes.toString("ascii", offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4), start = offset + 8;
    if (start + size > bytes.length) throw badRequest("Imagen WebP incompleta.");
    if (kind === "VP8X" && size >= 10) {
      if (bytes[start]! & 2) throw badRequest("Usa una imagen sin animación.");
      width = 1 + bytes.readUIntLE(start + 4, 3);
      height = 1 + bytes.readUIntLE(start + 7, 3);
    } else if (kind === "VP8 " && size >= 10 && bytes.toString("hex", start + 3, start + 6) === "9d012a") {
      const w = bytes.readUInt16LE(start + 6) & 0x3fff, h = bytes.readUInt16LE(start + 8) & 0x3fff;
      if (width && (width !== w || height !== h)) throw badRequest("Dimensiones WebP inconsistentes.");
      width = w; height = h; imageChunk = true;
    } else if (kind === "VP8L" && size >= 5 && bytes[start] === 0x2f) {
      const bits = bytes.readUInt32LE(start + 1);
      const w = 1 + (bits & 0x3fff), h = 1 + ((bits >>> 14) & 0x3fff);
      if (width && (width !== w || height !== h)) throw badRequest("Dimensiones WebP inconsistentes.");
      width = w; height = h; imageChunk = true;
    }
    offset = start + size + (size % 2);
  }
  if (!imageChunk || width < 1 || height < 1 || width > 640 || height > 640) throw badRequest("La imagen debe medir como máximo 640 × 640.");
  return { width, height, contentHash: createHash("sha256").update(bytes).digest("hex") };
}
export function storageClient(env: AppEnv) {
  function url(key: string) {
    if (!env.SUPABASE_STORAGE_URL || !env.SUPABASE_STORAGE_KEY) {
      throw new AppError(503, "STORAGE_NOT_CONFIGURED", "Falta configurar el almacenamiento de imágenes.", { expose: true });
    }
    return env.SUPABASE_STORAGE_URL.replace(/\/$/, "") + "/storage/v1/object/" +
      encodeURIComponent(env.SUPABASE_STORAGE_BUCKET) + "/" + key.split("/").map(encodeURIComponent).join("/");
  }
  const headers = () => ({ Authorization: "Bearer " + env.SUPABASE_STORAGE_KEY, apikey: env.SUPABASE_STORAGE_KEY ?? "" });
  return {
    async upload(key: string, bytes: Buffer) {
      const response = await fetch(url(key), {
        method: "POST", headers: { ...headers(), "Content-Type": "image/webp", "x-upsert": "false" },
        body: new Uint8Array(bytes), signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) {
        // A crash after upload, before DB commit, can leave this immutable hash path.
        // Verify its bytes before reusing it; never overwrite unknown content.
        const existing = await fetch(url(key), { headers: headers(), signal: AbortSignal.timeout(20_000) });
        if (!existing.ok || !Buffer.from(await existing.arrayBuffer()).equals(bytes)) {
          throw new AppError(502, "STORAGE_UPLOAD_FAILED", "No se pudo guardar la imagen.", { expose: true });
        }
      }
    },
    async download(key: string) {
      const response = await fetch(url(key), { headers: headers(), signal: AbortSignal.timeout(20_000) });
      if (!response.ok) throw new AppError(502, "STORAGE_DOWNLOAD_FAILED", "Imagen no disponible.", { expose: true });
      return Buffer.from(await response.arrayBuffer());
    },
  };
}
export async function uploadAsset(db: TransactionalDb, context: TenantContext, bytes: Buffer,
  storage: ReturnType<typeof storageClient>) {
  demand(context, "catalog.manage");
  assertOperationAllowed(context.licenseStatus ?? "SUSPENDED", "POST");
  const inspected = inspectWebP(bytes), org = context.organizationId;
  return db.transaction(async (tx) => {
    // Same organization lock provides concurrency-safe dedupe.
    await repo.lockOrganization(tx, org);
    const existing = await repo.assetByHash(tx, org, inspected.contentHash);
    if (existing) return existing;
    const asset: repo.StoredAsset = {
      id: randomUUID(), organizationId: org, ...inspected, mimeType: "image/webp", sizeBytes: bytes.length,
      storageKey: "organizations/" + org + "/products/" + inspected.contentHash + ".webp",
    };
    await storage.upload(asset.storageKey, bytes);
    await repo.saveAsset(tx, asset);
    return asset;
  });
}
export async function downloadAsset(db: TransactionalDb, context: TenantContext, id: string,
  storage: ReturnType<typeof storageClient>) {
  const asset = await repo.asset(db, context.organizationId, id);
  if (!asset) throw notFound();
  return storage.download(asset.storageKey);
}
