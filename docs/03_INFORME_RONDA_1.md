# Ronda 1 — Estabilización de Fase 0

Informe histórico de aquella ronda. Los números y comandos que aparecen abajo
son los de **ese** momento y no se han actualizado; el estado vigente está en
[`IMPLEMENTATION_STATUS.md`](IMPLEMENTATION_STATUS.md) y en
[`04_INFORME_RONDA_2.md`](04_INFORME_RONDA_2.md).

> **Corrección honesta (Ronda 2).** Al cerrar la Ronda 1 no existían en el
> repositorio, pese a lo que pudo entenderse del resumen entregado en el chat:
> pruebas de la app Vue más allá de las 4 de la cola offline, capa de mocks,
> README propio del proyecto, `docs/IMPLEMENTATION_STATUS.md`, aviso accesible
> de actualización PWA ni indicador de estado sin conexión. Todo eso se añadió
> en la Ronda 2. Además, el índice único sobre `refresh_tokens.replaced_by` que
> se describía como “segunda barrera” **no** impedía dos sucesores de un mismo
> predecesor; esa garantía llegó con `parent_token_id` en la migración `0003`.

---


## 1. Compilación y tipos

| Comando | Resultado |
| --- | --- |
| `api`: `npx tsc --noEmit -p tsconfig.json` | sin errores |
| `api`: `npm run lint` (guardián de capas) | “el SQL vive solo en repositorios y migraciones” |
| `vue-app`: `npx vue-tsc --noEmit` | sin errores |
| `vue-app`: `npm run build` | build + PWA generados (`dist/sw.js`, `manifest.webmanifest`, 20 entradas de precache) |

Fastify ya no emite el aviso `FSTDEP023`: en pruebas el logger se desactiva
por completo en lugar de usar la opción obsoleta `disableRequestLogging`.

---

## 2. Pruebas automatizadas

`api`: **20 pruebas, todas en verde** (`TEST_DATABASE_URL=... npx vitest run`).

- `license.test.ts` (6) — resolución de estado de licencia.
- `loginThrottle.test.ts` (3) — backoff por cuenta e IP.
- `auth.integration.test.ts` (11) — se ejecutan contra PostgreSQL real; sin
  `TEST_DATABASE_URL` el archivo se salta entero en vez de simular la base.

`vue-app`: **4 pruebas en verde** sobre la cola offline, usando una IndexedDB
real (`fake-indexeddb`), no un mock del propio código: orden de creación,
clave de idempotencia, registro de fallos y ausencia de credenciales en el
registro encolado.

---

## 3. PostgreSQL real

Clúster PostgreSQL 17 levantado localmente; `0001_init.sql` y
`0002_phase0_hardening.sql` aplicadas con el runner de migraciones.

Comprobaciones ejecutadas directamente en `psql`:

| Escenario | Resultado esperado | Obtenido |
| --- | --- | --- |
| Almacén apuntando a sucursal de otro tenant | rechazo | rechazo (`warehouses_branch_same_org_fkey`) |
| `user_branches` cruzando tenants | rechazo | rechazo (`user_branches_branch_same_org_fkey`) |
| Sesión con organización distinta a la del usuario | rechazo | rechazo (`sessions_user_same_org_fkey`) |
| `user_roles` con rol global (`roles.organization_id IS NULL`) | aceptado | aceptado |
| `user_roles` con rol del mismo tenant | aceptado | aceptado |
| `user_roles` con rol de otro tenant | rechazo | rechazo (trigger `user_roles_tenant_guard`) |
| `user_roles` cuyo `organization_id` no es el del usuario | rechazo | rechazo (`user_roles_user_same_org_fkey`) |

Sobre la misma base, las pruebas de integración cubren:

- login real con Argon2id y emisión de sesión;
- rotación de refresh token con bloqueo transaccional (`SELECT … FOR UPDATE`)
  y actualización condicional;
- **rotación concurrente**: 5 intentos simultáneos, exactamente un ganador y
  ningún caso con dos sucesores válidos;
- reutilización de un token ya rotado ⇒ revocación de toda la familia;
- aislamiento multiempresa y por sucursal en los listados;
- placeholders privados: 401 sin sesión, 501 con sesión, 404 en rutas
  inexistentes.

`0001_init.sql` se dejó intacta y se trata como migración aplicada e
inmutable; la dependencia de `pgcrypto` sigue siendo obligatoria y está
documentada como tal.

Seed: `scripts/seed-dev.ts` exige `ALLOW_DEV_SEED=true`, es idempotente,
repara instalaciones a medias y solo restablece contraseñas con
`SEED_RESET_PASSWORDS=true`. Las credenciales se muestran una única vez por
consola y no se escriben en ningún archivo del repositorio.

---

## 4. Navegador

API Fastify y la PWA Vue ejecutándose a la vez contra la base real; recorrido
automatizado con Chromium:

1. `/app` sin sesión redirige a `/login?redirect=/app`.
2. Login correcto con credenciales de seed ⇒ `/app`.
3. `localStorage` y `sessionStorage` **vacíos**: ningún token, contraseña ni
   `Bearer` persistido.
4. Única cookie presente: `gks_rt`, `HttpOnly`, `SameSite=Lax`.
5. Placeholder privado `/app/pos` accesible con sesión (ya no rebota al login).
6. Recarga completa en ruta privada: la sesión se restaura con la cookie de
   refresco y el usuario permanece en `/app`.
7. Vista de sesiones activas carga datos reales del tenant.
8. “Salir” cierra sesión y devuelve a `/login`.

Corrección encontrada y resuelta en esta ronda: `bootstrap()` de la store de
sesión nunca se invocaba, de modo que cualquier recarga expulsaba al usuario.
Ahora se ejecuta antes de montar la aplicación, es idempotente y el guard del
router espera a que termine.

Service worker: la regla `NetworkOnly` se generaba con una función que Workbox
serializaba perdiendo las constantes del `vite.config.ts` (habría lanzado
`ReferenceError` en cada `fetch`). Se sustituyó por expresiones regulares
verificadas en el `dist/sw.js` generado, para GET, POST, PUT, PATCH y DELETE,
en los dos escenarios:

- API relativa: `/^https?:\/\/[^/]+\/api\/v1(\/|$)/`
- API absoluta (`VITE_API_BASE_URL=https://api.geeksium.example/v1`):
  `/^https:\/\/api\.geeksium\.example\//`

Iconos PWA 192, 512 y 512 maskable presentes y referenciados en el manifiesto.

---

## 5. Pendiente

- No se verificó comportamiento offline real de extremo a extremo: la cola
  IndexedDB existe y está probada, pero todavía no hay operaciones de negocio
  que encolar ni reenvío automático al recuperar conexión.
- RLS en PostgreSQL sigue planificada como defensa en profundidad futura; hoy
  el aislamiento lo imponen las restricciones de integridad y el filtro
  obligatorio por `organization_id` en los repositorios.
- Sin pruebas en dispositivo móvil ni instalación PWA real; solo Chromium de
  escritorio.
- Sin despliegue: no se validó la ejecución con `COOKIE_SECURE=true` detrás de
  HTTPS ni la configuración de CORS entre dominios en producción.
- Módulos de negocio (Productos, POS, Inventario, Compras, Traspasos, Caja,
  Reportes) siguen como placeholders 501, según el alcance acordado.
