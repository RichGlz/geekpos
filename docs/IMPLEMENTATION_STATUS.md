# Estado de implementación — Geeksium POS

Fecha de corte: cierre de la Ronda 2 (Fase 0).
Este documento dice qué existe **en el repositorio** y qué no. Si algo no aparece
como “Listo”, no está hecho, aunque el PRD lo describa.

## Leyenda

- **Listo** — implementado y verificado con pruebas o evidencia reproducible.
- **Parcial** — hay base funcional, faltan piezas nombradas explícitamente.
- **No iniciado** — no hay código de negocio; las rutas responden `501`.

## Backend (`api/`)

| Área | Estado | Detalle |
|---|---|---|
| Arranque Fastify + Zod + validación de entorno | Listo | Puerto 3000, `COOKIE_SECURE=true` obligatorio en producción |
| Errores uniformes y sin fugas | Listo | 500 genérico con `requestId`, sin stack en la respuesta |
| `/health` | Listo | 200 con base arriba, 503 con base caída |
| Login con Argon2id | Listo | Mensajes genéricos, sin revelar si el correo existe |
| Backoff de login | Listo | Por correo + IP, temporal y auto-liberado |
| Access token JWT | Listo | Issuer, audience, expiración y firma verificados |
| Refresh rotatorio en cookie HttpOnly | Listo | Solo se guarda el hash SHA-256; formato `sessionId.secret` estricto |
| Detección de reúso y quema de familia | Listo | Cubierto por pruebas de integración |
| Rotación concurrente | Listo | `FOR UPDATE` + `UPDATE` condicional: un único ganador |
| Aislamiento multiempresa | Listo | Usuario, sesión y claim `org` deben coincidir |
| Aislamiento por sucursal | Listo | `/organization/branches` y `/warehouses` filtran por `user_branches` |
| Permisos con comodín `*` | Listo | Verificado contra `/organization/users` |
| Licencias (ACTIVE / GRACE / READ_ONLY) | Listo | `READ_ONLY` bloquea escrituras por método HTTP |
| Auditoría en `audit_log` | Listo | Login, refresh, reúso, logout, cierre remoto |
| Integridad multiempresa en SQL | Listo | Migraciones `0002` y `0003` |
| Módulos de negocio | No iniciado | `products`, `inventory`, `sales`, `purchases`, `transfers`, `reports`, `sync`, `license`, `platform` → `501` |

## Base de datos (`api/migrations/`)

| Migración | Contenido |
|---|---|
| `0001_init.sql` | Esquema inicial. **Inmutable**; crea `pgcrypto` (dependencia vigente) |
| `0002_phase0_hardening.sql` | Claves únicas y FK compuestas `(organization_id, id)`, trigger de tenant en `user_roles` |
| `0003_phase0_null_integrity.sql` | Triggers con `IS NOT DISTINCT FROM` en `sessions` y `user_roles` (rechazan `NULL`), `parent_token_id` con índice único |

No existe `0002_seed_dev.sql` ni ninguna migración de semillas.

## Frontend (`vue-app/`)

| Área | Estado | Detalle |
|---|---|---|
| Shell Vue 3 + Pinia + Tailwind | Listo | Landing, login, dashboard, sesiones, placeholders |
| Sesión en memoria + restauración | Listo | El access token nunca toca `localStorage` |
| Guards de navegación | Listo | Solo experiencia de usuario; la autorización real es del servidor |
| Interceptor HTTP con refresco único | Listo | Varios 401 concurrentes comparten un refresco |
| Modo mock (`VITE_USE_MOCKS`) | Listo | Solo desarrollo, capa aislada, banner “MODO MOCK — SOLO UI” |
| PWA instalable + aviso de actualización accesible | Listo | `role="status"`, `aria-live` y botón “Actualizar” |
| Indicador de estado sin conexión | Listo | Honesto: avisa de que la operación offline **aún no existe** |
| Cola de sincronización en IndexedDB | Parcial | Estructura y pruebas listas; **no** hay operación offline real ni sincronización con el servidor |
| POS, inventario, impresión, traspasos | No iniciado | — |

## Pruebas

| Suite | Cantidad | Cómo se ejecuta |
|---|---|---|
| `api` unitarias (licencias, backoff) | 9 | `cd api && npm test` |
| `api` integración contra PostgreSQL real | 21 | `TEST_DATABASE_URL=... npm test` (se saltan sin esa variable) |
| `vue-app` (store, permisos, guards, interceptor, cola offline) | 20 | `cd vue-app && npm test` |

## Deuda consciente

- No hay RLS en PostgreSQL: el aislamiento se impone en aplicación + constraints.
  Está previsto como defensa en profundidad en una fase posterior.
- No hay pruebas en dispositivo móvil real ni instalación PWA fuera de Chromium.
- El portal React de la raíz es informativo y no forma parte del producto.
