# Ronda 1 — Estabilización de Fase 0 (Geeksium POS)

Ronda de corrección sobre la fundación existente. No se implementa ningún módulo funcional (Productos, POS, Inventario, Compras, Traspasos, Caja, Reportes). Se conserva `/vue-app` + `/api` como producto real y la raíz React como portal.

## Auditoría inicial (ya verificada contra el código vigente)

Confirmados los hallazgos del documento:

- `api/src/http/context.ts` compara permisos por igualdad exacta: el wildcard `*` del rol OWNER no concede acceso en la API.
- `/api/v1/organization/branches` y `/warehouses` filtran solo por `organization_id`; no aplican `user_branches`.
- `0001_init.sql` usa FKs simples (`branch_id`, `user_id`, `role_id`) que permiten combinaciones cross-tenant; `refresh_tokens.replaced_by` es un `uuid` sin FK; declara portabilidad pero ejecuta `CREATE EXTENSION pgcrypto`.
- `api/src/http/app.ts` no expone `GET /`; `GET /health` solo devuelve uptime; no hay namespaces 501 registrados.
- `vue-app/public` solo tiene `favicon.svg`: los iconos 192/512 del manifest no existen.
- No existe `vue-app/src/offline/` (idb instalado sin usar), ni capa de mocks, ni `.env.example` de Vue.
- README raíz sigue siendo el genérico de Lovable; `api/.env.example` documenta `SEED_ADMIN_*` mientras el seed usa `SEED_OWNER_PASSWORD`/`SEED_CASHIER_PASSWORD`. El seed **sí** exige ya `ALLOW_DEV_SEED=true`: esa protección se conserva; lo que falta es documentarla y probarla.
- Pruebas API existentes: solo `license` y `loginThrottle`. Vue: ninguna.

Verificación disponible en este entorno: PostgreSQL 17 está instalado en el sandbox, así que las pruebas de integración correrán contra una base real efímera (`initdb` + cluster temporal, `TEST_DATABASE_URL`), y el recorrido de login se comprobará en navegador headless contra API + Vue reales. Nada de eso se versiona ni queda con credenciales en el repo.

## Trabajo a realizar

### 1. Integridad SQL — `api/migrations/0002_phase0_hardening.sql` (append-only)

Migración nueva, transaccional, idempotente y que aborta con mensaje claro si encuentra datos incompatibles (nunca borra ni corrige en silencio):

- Claves únicas compuestas `(organization_id, id)` en `branches`, `users`, `roles` y `sessions`. `organizations` queda fuera: no tiene `organization_id`, su `id` ya es la raíz del tenant.
- FKs compuestas: `warehouses(organization_id, branch_id)`, `user_branches(organization_id, user_id)` y `(organization_id, branch_id)`, `sessions(organization_id, user_id)`.
- `user_roles`: la regla "rol global del sistema o rol del mismo tenant" se garantiza en SQL. `organization_id` es una **columna normal** (no generada) con FK compuesta a `users(organization_id, id)`; la validación cruzada contra `roles` se hace con un `CONSTRAINT TRIGGER` en `INSERT`/`UPDATE`, ya que PostgreSQL no permite consultar otra tabla desde un `CHECK` ni desde una columna generada. Regla del trigger: acepta si `roles.organization_id IS NULL` (rol global) o `roles.organization_id = user_roles.organization_id`; en cualquier otro caso aborta. Pruebas SQL directas para los tres casos: rol global aceptado, rol del mismo tenant aceptado, rol de otro tenant rechazado.
- `refresh_tokens.replaced_by`: FK autorreferente `ON DELETE SET NULL` y unicidad efectiva del sucesor (`parent_token_id` único o índice único equivalente). La garantía primaria contra dos sucesores es la rotación transaccional con bloqueo y actualización condicional (paquete 4); el constraint es la segunda barrera.
- Índices para las consultas nuevas de tenant + sucursal.
- `ON DELETE` de tablas de seguridad y auditoría revisados y documentados.
- `0001_init.sql` se trata como aplicada e **inmutable**: no se toca ni siquiera en comentarios. Mientras `0001` ejecute `CREATE EXTENSION pgcrypto`, la dependencia de `pgcrypto` se documenta como requisito real y vigente de la instalación, no como opcional.

### 2. Permisos y contexto autenticado (`/api`)

- Función única `hasPermission(context, permission)`: platform admin → permitido; `*` → permitido; permiso exacto → permitido; resto → 403 `PERMISSION_DENIED`. `users.*` no es wildcard.
- `authenticate` exige coincidencia completa de tenant entre `users.organization_id`, `sessions.organization_id` y el claim `org` del access token. Cualquier discrepancia invalida la sesión (401 genérico + registro interno de auditoría) sin revelar detalles internos. Verifica además que el usuario siga activo.
- Ventana de revocación de permisos (vida del access token) documentada en `docs/01_SEGURIDAD.md`.

### 3. Aislamiento por sucursal

- Repositorio y endpoints: `/organization/branches` devuelve solo sucursales de `user_branches` del usuario; `/warehouses` solo almacenes de esas sucursales. Sin listas de branch IDs aceptadas desde el cliente.
- El seed asigna sucursales explícitas a todo usuario tenant, incluido OWNER (sin acceso total implícito).
- Helper `assertBranchAllowed(tenant, branchId)` preparado para módulos futuros.

### 4. Refresh concurrente y auth

- Rotación atómica dentro de transacción: `SELECT ... FOR UPDATE` sobre la fila del token + `UPDATE ... WHERE replaced_by IS NULL AND revoked_at IS NULL` que solo puede ganar una vez (o `parent_token_id` único equivalente). Como máximo un sucesor; la segunda petición se rechaza como reutilización y revoca la familia. La prueba concurrente ejecuta dos refresh simultáneos contra PostgreSQL real y comprueba en base que nunca quedan dos sucesores válidos.
- Validación del prefijo `sessionId` del token contra el registro resuelto por hash.
- Logout idempotente, revocación de sesiones limitada al propietario, usuario inactivo/licencia suspendida bloqueados.

### 5. Root, health y 501

- `GET /` → `{ name, version, status }` con la versión leída de una sola fuente.
- `GET /health` → `SELECT 1` con timeout; 200 con `{ status, database, uptime }`, 503 con `{ status, database, requestId }`; sin detalles de driver.
- Namespaces `products, inventory, sales, purchases, transfers, reports, sync, license, platform` registrados como placeholders **privados**: sin sesión válida responden 401, con sesión válida responden 501 en el contrato uniforme. Una ruta realmente inexistente sigue respondiendo 404.

### 6. Vue: PWA, IndexedDB y mocks

- Iconos reales 192/512 (incluye `maskable`) en `vue-app/public/icons`; manifest coherente sin referencias rotas.
- Service worker: precache de app shell y estáticos; `NetworkOnly` para toda la API, tanto con base relativa (`/api`) como cuando `VITE_API_BASE_URL` es una URL absoluta o de otro origen (la regla se construye en build a partir de esa variable y cubre además cualquier `/auth/*`), con `denylist` de navegación; fallback offline honesto; aviso accesible de actualización disponible.
- `vue-app/src/offline/`: wrapper `idb` con nombre/versión centralizados, store `syncQueue`, índices por estado y fecha, y funciones open/enqueue/list/updateStatus. Marcado como STUB; no guarda tokens ni permisos.
- Capa de mocks aislada activada por `VITE_USE_MOCKS` (por defecto `false`, imposible en build de producción) con banner "MODO MOCK — SOLO UI".

### 7. Env, seed, README y docs

- `api/.env.example` alineado con los nombres reales del código (incluye `ALLOW_DEV_SEED`, `SEED_OWNER_PASSWORD`, `SEED_CASHIER_PASSWORD`); nuevo `vue-app/.env.example` con `VITE_API_BASE_URL`, `VITE_API_PROXY`, `VITE_USE_MOCKS` y explicación de la diferencia.
- Seed: se conserva la protección existente (`ALLOW_DEV_SEED=true` obligatorio y aborto en producción); se documenta en `.env.example`/README y se cubre con prueba. Se añade la reparación segura de entornos demo parciales (organización, sucursal, almacén, licencia, roles, usuarios, asignaciones) sin sobrescribir contraseñas, con flag explícito de reseteo de contraseñas demo. Usuarios `owner@demo.local` y `caja@demo.local`. Ejemplos en PowerShell y POSIX.
- README raíz específico de Geeksium POS; `docs/IMPLEMENTATION_STATUS.md` con estados DONE/IMPLEMENTED/IN_PROGRESS/STUB/NOT_STARTED/BLOCKED; portal React actualizado con esos mismos estados y sin lógica de negocio.

### 8. Pruebas

- API integración con Fastify `inject` contra PostgreSQL real efímero: auth completa (login, mensajes indistinguibles, usuario inactivo, backoff, cookie dev/prod, rotación, reuse, concurrencia, logout, sesiones ajenas, token expirado/issuer inválido), permisos y licencia, tenant y sucursal con dos organizaciones, constraints SQL cross-tenant rechazadas, `/`, `/health` 200 y 503, 501 y 404, y error 500 sin fugas en producción.
- Migraciones: base vacía, incremental sobre `0001`, segunda ejecución sin duplicar, rollback en fallo.
- Vue con Vitest: auth store, `can()` con wildcard, guards público/privado, interceptor bearer, 401 concurrentes con una sola renovación, fallo de refresh que limpia sesión, mocks solo en dev, IndexedDB con `fake-indexeddb`.

### 9. Verificación y informe

Se ejecutarán y registrarán con resultado real: build raíz; en `/api` typecheck, lint, test, build, migrate (limpio + incremental + repetido) y seed; en `/vue-app` typecheck, test y build. Recorrido en navegador headless: login → `/app` → `/auth/me` → recarga con refresh → logout → bloqueo de ruta privada, más inspección de Cache Storage.

El informe final separará: qué compiló, qué pruebas automáticas pasaron, qué se verificó contra PostgreSQL real, qué se verificó en navegador y qué queda pendiente. Mocks, TypeScript o un build verde no se presentarán como prueba de autenticación o aislamiento.

## Fuera de alcance de esta ronda

Productos, POS, Inventario, Compras, Traspasos, Caja, Reportes, sync offline de ventas, Storage, Analytics, SMTP/WhatsApp/pagos, Realtime, RLS activa (solo estrategia documentada) y cualquier función de V2.
