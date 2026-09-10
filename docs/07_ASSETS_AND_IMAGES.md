# Assets e imágenes

Una imagen principal por producto, compartida por organización.
Servicios usan public/icons/service.svg.
El navegador procesa orientación con createImageBitmap, conserva proporción,
reduce a máximo 640 × 640 sin ampliar, exporta WebP con calidad inicial 0.70 y
reduce de nuevo o rechaza si supera 150 KiB. No se envía el original.

SHA-256 se calcula sobre el WebP procesado y se recalcula en servidor.
La API valida cabecera, dimensiones, tamaño y ausencia de animación.
product_assets guarda UUID, hash, MIME, dimensiones, tamaño y storage_key,
sin blobs PostgreSQL. Unicidad: organization_id + content_hash; no hay dedupe
entre tenants. La ruta Storage es inmutable bajo organización; un reintento tras
caída comprueba bytes existentes antes de reutilizar un objeto.

## Persistencia

Blob y comando se guardan juntos offline, con preview y reintento.
Tras upload confirmado se cambia el hash local por UUID servidor y se conserva
el blob como caché descargable. Límite global: 25 MiB de imágenes pendientes
(no se expulsan) y otros 25 MiB para assets descargados (expulsión por antigüedad).
La cuota del navegador también puede fallar y debe informarse.
Logout no elimina imágenes pendientes. Si falla una subida, otros comandos
independientes siguen sincronizándose.

## API y despliegue

- GET /assets/by-hash/:hash: dedupe del tenant; exige gestión.
- POST /assets: body image/webp; exige gestión.
- GET /assets/:id/content: descarga autorizada por API, no-store.

Solo backend: SUPABASE_STORAGE_URL (base del proyecto), SUPABASE_STORAGE_KEY,
SUPABASE_STORAGE_BUCKET (default gkspos-buk).
Transporte REST servidor a servidor, sin SDK/clave en Vue.
Bucket privado y clave gestionada como secreto. Sin configuración funciona
catálogo de texto; una imagen puede permanecer pendiente.

Tests usan transporte controlado y PostgreSQL real para metadata. No certifican
políticas, disponibilidad ni privacidad del bucket remoto. Validar en staging
subida/lectura, rechazo anónimo, aislamiento tenant y permisos del backend.
