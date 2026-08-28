# Ronda 2 — Cierre de Fase 0 (correcciones localizadas)

Ronda pequeña y acotada. No se avanza a Productos, POS, Inventario, Compras, Traspasos, Caja ni Reportes, y no se hace refactor general.

## 1. Integridad SQL con valores NULL

Nueva migración append-only `api/migrations/0003_phase0_null_integrity.sql` (0001 y 0002 quedan intactas):

- Chequeo previo que aborta si hay filas incompatibles (mensaje claro, sin borrar nada).
- `sessions.organization_id`: `NOT NULL` cuando el usuario pertenece a un tenant; comparación real contra el usuario con `IS NOT DISTINCT FROM` mediante trigger de restricción `sessions_tenant_guard`.
- `user_roles`: se extiende `user_roles_tenant_guard` para rechazar `organization_id = NULL` cuando el usuario tiene organización, comparando con `IS NOT DISTINCT FROM u.organization_id`.
- Índices ya existentes se conservan.

## 2. Honestidad sobre `refresh_tokens.replaced_by`

Se corrige la afirmación: el índice único sobre `replaced_by` impide que un token sea sucesor de dos padres, no que un padre tenga dos sucesores. Solución real:

- Columna `parent_token_id uuid REFERENCES refresh_tokens(id)` con `CREATE UNIQUE INDEX ... ON refresh_tokens (parent_token_id) WHERE parent_token_id IS NOT NULL`.
- El repositorio escribe `parent_token_id` al insertar el sucesor, dentro de la misma transacción de rotación.
- Se actualizan comentarios de 0002 (solo texto en docs, no en el SQL aplicado) y `docs/01_SEGURIDAD.md` para describir con exactitud qué garantiza cada barrera.

## 3. Formato estricto del refresh token

En el servicio de autenticación, el valor de la cookie se valida como `sessionId.secret`:

- separador `.` obligatorio y único,
- `sessionId` UUID válido,
- secreto no vacío,
- el `sessionId` debe coincidir con la sesión resuelta por el hash; si no, 401 genérico y revocación de familia.

Cualquier fallo de formato devuelve el mismo error genérico, sin pistas al atacante.

## 4. Pruebas Vue (Vitest + Testing Library)

Nueva configuración `vue-app/vitest.config.ts` y pruebas:

- store de auth: login, logout, bootstrap idempotente, token solo en memoria;
- `can()` con comodín `*` y con admin de plataforma;
- guards del router: invitado a `/login`, autenticado a `/dashboard`;
- interceptor HTTP: refresh en 401 y reintento;
- dos 401 concurrentes comparten un único refresh;
- fallo de refresh: limpia sesión y expulsa al login.

## 5. Pruebas API que faltaban o estaban incompletas

En `api/src/__tests__/integration`:

- comodín de permisos contra una ruta protegida real;
- aislamiento de tenant contra una ruta existente (no inventada);
- `/health` devolviendo 503 con base caída;
- usuario inactivo → 401;
- cookies: `HttpOnly`, `SameSite`, `Secure` según entorno, y borrado en logout;
- JWT: issuer, audience y expiración inválidos;
- los tres estados de cada placeholder (401 / 501 / 404);
- error 500 sin stack en producción;
- token con `org` manipulado;
- constraints SQL con `organization_id NULL` (sesiones y user_roles).

## 6. Modo mocks

- `VITE_USE_MOCKS` en `vue-app/.env.example`, activo solo con `import.meta.env.DEV`.
- Capa aislada en `vue-app/src/lib/mocks/` que intercepta únicamente en modo mock; el código de producción no la importa.
- Banner fijo y accesible “MODO MOCK — SOLO UI” en `App.vue`.

## 7. Documentación

- README raíz reescrito para el monorepo real (portal React, `vue-app`, `api`, docs y comandos verificados).
- Corrección en toda la documentación: puerto 3000, `JWT_SECRET`, `CORS_ORIGINS`, `ALLOW_DEV_SEED`, tabla `audit_log`, inexistencia de `0002_seed_dev.sql`, y `pgcrypto` como dependencia vigente.
- Nuevo `docs/IMPLEMENTATION_STATUS.md`: qué existe, qué no, y qué queda pendiente por módulo.

## 8. PWA y estado offline honesto

- Aviso accesible de actualización (`role="status"`, foco gestionado, botón “Actualizar”) conectado a `registerSW`.
- Indicador honesto de conexión (en línea / sin conexión) sin prometer sincronización.
- Se elimina de `LandingView.vue` toda afirmación de operación o sincronización offline aún inexistente.

## 9. Informe de Ronda 1

`docs/03_INFORME_RONDA_1.md` se corrige para no afirmar la existencia de pruebas Vue, mocks, README ni documentación ausentes; se añade nota de rectificación y enlace al nuevo informe de esta ronda.

## Entrega

Informe final `docs/04_INFORME_RONDA_2.md` con archivos tocados, comandos realmente ejecutados y evidencia separada en cuatro bloques: API, PostgreSQL, Vue y navegador.
