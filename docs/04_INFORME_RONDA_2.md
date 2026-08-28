# Ronda 2 — Cierre de Fase 0

Ronda pequeña y localizada. No se avanzó a Productos, POS, Inventario, Compras,
Traspasos, Caja ni Reportes. Todo lo que se afirma aquí se ejecutó; lo que no se
pudo comprobar está en “Pendiente”.

---

## 1. Qué se corrigió

| Punto pedido | Qué se hizo | Archivos |
|---|---|---|
| Integridad SQL con `NULL` | `CONSTRAINT TRIGGER` en `sessions` y `user_roles` que compara con `IS NOT DISTINCT FROM` la organización real del usuario: un usuario de tenant no puede tener sesión ni rol con `organization_id = NULL` | `api/migrations/0003_phase0_null_integrity.sql` |
| Afirmación sobre `replaced_by` | Se reconoce que ese índice **no** impedía dos sucesores del mismo predecesor. Se añadió `parent_token_id` con índice único parcial, que sí lo impide, y se escribe en la rotación | `0003_...sql`, `refreshToken.repository.ts`, `auth.service.ts`, `docs/01_SEGURIDAD.md` |
| Formato estricto del refresh | `parseRefreshToken`: UUID válido, separador obligatorio, prefijo y secreto no vacíos, exactamente dos partes, y coincidencia con la sesión resuelta | `api/src/lib/refreshToken.ts`, `auth.service.ts` |
| Pruebas Vue prometidas | Store de sesión, comodín de permisos, guards, interceptor, 401 concurrentes y fallo de refresco | `vue-app/src/modules/auth/__tests__/`, `src/lib/__tests__/http.test.ts`, `src/router/__tests__/guards.test.ts`, `vitest.config.ts` |
| Pruebas API incompletas | Comodín contra `/organization/users`, aislamiento en rutas reales, `/health` 503, usuario desactivado, cookies, issuer/audience/expiración, tenant manipulado, los 9 placeholders, error 500 sin stack y constraints con `NULL` | `api/src/__tests__/integration/auth.integration.test.ts` |
| Modo `VITE_USE_MOCKS` | Capa aislada cargada con `import()` dinámico solo en desarrollo, con banner permanente “MODO MOCK — SOLO UI” | `vue-app/src/lib/mocks/index.ts`, `main.ts`, `.env.example` |
| README y documentación | README propio del proyecto; puerto 3000, `JWT_SECRET` único, `CORS_ORIGINS`, `ALLOW_DEV_SEED`, `audit_log`, ausencia de `0002_seed_dev.sql` y `pgcrypto` como dependencia vigente | `README.md`, `docs/01`, `docs/02`, `docs/IMPLEMENTATION_STATUS.md` |
| Aviso de actualización PWA y estado offline honesto | Aviso accesible (`role="status"`, `aria-live="polite"`, botón “Actualizar”), indicador de sin conexión que dice explícitamente que la operación offline aún no existe, y landing sin promesas de sincronización | `vue-app/src/components/AppStatusBar.vue`, `LandingView.vue`, `vite.config.ts` |
| Informe de Ronda 1 | Encabezado de corrección que enumera lo que **no** existía entonces | `docs/03_INFORME_RONDA_1.md` |

---

## 2. Evidencia — API (Fastify)

Comandos ejecutados:

```bash
cd api && npm install
npm run lint       # ✔ capas correctas: el SQL vive solo en repositorios y migraciones
npm run typecheck  # tsc -p tsconfig.json --noEmit → sin salida (sin errores)
TEST_DATABASE_URL="postgres://postgres@localhost:5433/geeksium_test?host=/tmp" npx vitest run
```

Resultado: **3 archivos, 30 pruebas, todas en verde**.

- `license.test.ts` (6) y `loginThrottle.test.ts` (3) — unitarias.
- `auth.integration.test.ts` (21) — contra PostgreSQL real.

Casos nuevos y lo que demuestran:

| Prueba | Evidencia |
|---|---|
| Comodín de permisos | `OWNER` (`*`) obtiene 200 en `/organization/users`; el cajero, 403 |
| Usuario desactivado | Token válido emitido antes de la baja ⇒ 401 `SESSION_REVOKED` |
| Cookies | `HttpOnly`, `Path=/api/v1/auth`, `SameSite` presente; el refresh nunca viaja en el cuerpo; el logout limpia la cookie con el mismo `Path` |
| JWT | Issuer erróneo, audience errónea y token caducado ⇒ 401; claim `org` manipulado hacia otro tenant ⇒ 401 |
| Placeholders | Los 9 módulos: 401 sin sesión y 501 `NOT_IMPLEMENTED` con sesión |
| Formato del refresh | `""`, `sin-separador`, `uuid.`, `.secreto`, `no-es-uuid.secreto`, `uuid.secreto.extra` ⇒ 401 sin tocar la sesión legítima; prefijo de otra sesión ⇒ 401 **y quema de la familia** |
| Constraints `NULL` | `INSERT` de sesión y de `user_roles` con `organization_id = NULL` ⇒ excepción “aislamiento multiempresa violado” |
| Dos hijos del mismo token | `INSERT` con `parent_token_id` repetido ⇒ violación de `refresh_tokens_parent_unique_idx` |
| `/health` 503 | App levantada contra una base inalcanzable ⇒ 503 con `database: "down"` |
| Error 500 | Instancia con `NODE_ENV=production` y una ruta que lanza: 500, `INTERNAL_ERROR`, sin el mensaje interno ni stack en la respuesta (el detalle solo aparece en el log del servidor) |

---

## 3. Evidencia — PostgreSQL

Clúster PostgreSQL **17.9** local, base desechable `geeksium_test`:

```bash
pg_ctl -D /tmp/pgdata2 -o "-p 5433" start
createdb geeksium_test
DATABASE_URL=... npm run migrate
▶ aplicando 0001_init.sql
▶ aplicando 0002_phase0_hardening.sql
▶ aplicando 0003_phase0_null_integrity.sql
✔ 3 migración(es) aplicada(s)
```

Tablas reales confirmadas con `psql`: `audit_log`, `branches`, `licenses`,
`login_attempts`, `organizations`, `refresh_tokens`, `role_permissions`, `roles`,
`schema_migrations`, `sessions`, `user_branches`, `user_roles`, `users`,
`warehouses`. La tabla de auditoría se llama `audit_log` (la documentación decía
`audit_events`; corregido).

Las tres migraciones son idempotentes y `0001_init.sql` sigue intacta.

---

## 4. Evidencia — Vue (Vitest)

```bash
cd vue-app && npm test
✓ src/lib/offline/__tests__/syncQueue.test.ts (4)
✓ src/lib/__tests__/http.test.ts (5)
✓ src/modules/auth/__tests__/auth.store.test.ts (7)
✓ src/router/__tests__/guards.test.ts (4)
Test Files 4 passed · Tests 20 passed
```

Qué demuestran, en términos de producto:

- iniciar sesión deja la app usable y **nada** se escribe en `localStorage`;
- el comodín `*` concede todo, `users.*` **no** es comodín, y el administrador
  de plataforma pasa siempre;
- `bootstrap()` es idempotente: tres llamadas concurrentes hacen un solo refresco;
- si el refresco falla, la app arranca igualmente con sesión cerrada;
- un 401 dispara un refresco y reintenta la petición original;
- dos 401 concurrentes comparten un único refresco;
- si el refresco falla, se avisa de la sesión perdida y se propaga `ApiError`;
- las llamadas de `/auth/*` no entran en el bucle de renovación;
- un invitado en ruta privada acaba en `/login?redirect=…` y un autenticado no
  vuelve al login.

También: `npm run typecheck` sin errores y `npm run build` genera el service
worker (`dist/sw.js`, 21 entradas de precache).

---

## 5. Evidencia — Navegador

PWA servida con `VITE_USE_MOCKS=true` en `http://localhost:5199`, recorrido con
Chromium (capturas en la ejecución):

1. Banner leído en pantalla: **“MODO MOCK — SOLO UI”**.
2. Con mocks activos la sesión se restaura y la app aterriza en `/app`.
3. Al perder conexión aparece el aviso con `aria-live="polite"`:
   “Sin conexión. Puedes seguir consultando lo que ya está en pantalla;
   registrar operaciones requiere conexión (la operación sin conexión aún no
   está disponible).”
4. `localStorage` vacío: `{}`.
5. Cero errores en la consola.

---

## 6. Pendiente (honesto)

- **No hay operación offline**: la cola IndexedDB existe y está probada, pero no
  se encolan operaciones de negocio ni hay reenvío al recuperar conexión. La
  interfaz ya no promete lo contrario.
- El aviso de actualización de la PWA se comprobó a nivel de interfaz y de
  registro del service worker, no con dos despliegues reales encadenados.
- Sin RLS en PostgreSQL: sigue planificada como defensa en profundidad.
- Sin pruebas en dispositivo móvil ni despliegue con `COOKIE_SECURE=true` tras
  HTTPS y CORS entre dominios.
- Módulos de negocio intactos como placeholders `501`, según el alcance acordado.
