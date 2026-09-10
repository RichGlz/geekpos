import type { PendingImage } from "./offline/catalogDb";
export const MAX_PROCESSED_BYTES = 150 * 1024;
export function fitImage(width: number, height: number, max = 640): { width: number; height: number } {
  if (width <= 0 || height <= 0 || !Number.isFinite(width + height)) throw new Error("Dimensiones de imagen inválidas.");
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}
export async function hashBlob(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
export async function processImage(file: Blob): Promise<PendingImage> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 20 * 1024 * 1024) {
    throw new Error("Selecciona una imagen JPG, PNG o WebP de hasta 20 MB.");
  }
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    let size = fitImage(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    let blob: Blob | null = null;
    // Start at requested quality. Reduce dimensions if the encoded image exceeds the cap.
    for (let attempt = 0; attempt < 5; attempt++) {
      canvas.width = size.width; canvas.height = size.height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("No se pudo procesar la imagen.");
      context.drawImage(bitmap, 0, 0, size.width, size.height);
      blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.70));
      if (!blob || blob.type !== "image/webp") throw new Error("Este navegador no permite convertir a WebP. Usa un navegador compatible.");
      if (blob.size <= MAX_PROCESSED_BYTES) break;
      size = fitImage(size.width, size.height, Math.floor(Math.max(size.width, size.height) * 0.8));
    }
    if (!blob || blob.size > MAX_PROCESSED_BYTES) throw new Error("No se pudo reducir la imagen a 150 KB.");
    const contentHash = await hashBlob(blob);
    return { id: contentHash, blob, sizeBytes: blob.size, contentHash, ...size, status: "pending_upload" };
  } finally { bitmap.close(); }
}
