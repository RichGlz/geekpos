# Geeksium POS — Fase 0 + Fundación de Seguridad Multiempresa

Monorepo con tres piezas: el POS real en `/vue-app` (Vue 3 + Vite + TS + Pinia + Tailwind + PWA), la API propia en `/api` (Node + TypeScript + Fastify + Zod + PostgreSQL), y la app React raíz reducida a un portal de estado del proyecto.

## Alcance de esta entrega

Los 17 puntos de "Primera ejecución" del prompt maestro, más autenticación real y aislamiento multiempresa. **No** se implementan POS, Productos, Inventario, Compras, Traspasos, Caja ni Reportes en esta fase.

## Nota importante sobre la plataforma

Lovable solo ejecuta y publica la app React de la raíz. `/vue-app` y `/api` viven en el repositorio, compilan y pasan pruebas aquí, pero se despliegan fuera de Lovable (por ejemplo Vercel/Netlify para el frontend y Fly/Render/VPS para `api.geeksium.com`). El preview de Lovable mostrará el portal de estado, no el POS.

## 1. Documentación

- `/docs/PRD_Geeksium_POS_V1.md` — copia íntegra del PRD.
- `/docs/DECISIONS.md` — decisiones técnicas con fecha y justificación (Fastify, Argon2id, refresh rotatorio, NUMERIC, SQL puro portable a AWS, sin SDK de Supabase en el cliente).
- `/docs/IMPLEMENTATION_STATUS.md` — tabla de los 15 módulos V1 con estado terminado / en progreso / pendiente / bloqueado.
- `/docs/RUNBOOK.md` — comandos de instalación, desarrollo, build, migraciones y pruebas.
- `/docs/BACKLOG_V2.md` — todo lo que quede fuera de V1.

## 2. API (`/api`)

Fastify + TypeScript estricto, capas `routes → service → repository`, sin ORM propietario (`pg` + SQL).

- `GET /` → JSON con nombre, versión y estado. `GET /health` → chequeo de proceso y base de datos.
- Router versionado `/api/v1` con los espacios de nombres del prompt registrados: `auth`, `products`, `inventory`, `sales`, `purchases`, `transfers`, `reports`, `sync`, `license`, `platform`. En esta fase solo `auth` tiene lógica; el resto responde `501 NOT_IMPLEMENTED` con contrato de error uniforme.
- Validación Zod en cada entrada, formato de error único `{ error: { code, message, details } }`. En producción nunca se exponen stack traces ni detalles internos: se registra el detalle en el log con un `requestId` y se devuelve un mensaje genérico.
- Logs estructurados (pino) con redacción de credenciales y tokens, request id, rate limiting, CORS por lista blanca, helmet.
- Configuración por variables de entorno con validación al arrancar; `.env.example` documentado.
- **Todo el SQL de la aplicación vive exclusivamente en `repositories/` y `migrations/`.** Ni las rutas ni los servicios llaman a `pool.query()`; se añade una regla de lint que falla si `pg`/`pool` se importa fuera de la capa de repositorios.

### Autenticación

- Login correo + contraseña, hash **Argon2id**.
- Access token JWT corto (~15 min) en memoria del cliente; refresh token rotatorio de larga vida en cookie **HttpOnly + SameSite**. `Secure=true` es obligatorio en producción (validado al arrancar) y solo puede desactivarse mediante variable de entorno para desarrollo local en `http://localhost`.
- **Los refresh tokens nunca se guardan en texto plano**: se almacena únicamente un hash (SHA-256 del secreto opaco) junto con `family_id`, `replaced_by`, `expires_at`, `revoked_at` y motivo de revocación. Al rotar se marca el token anterior como reemplazado; presentar un token ya rotado o revocado invalida toda la familia y cierra la sesión (detección de robo), con registro en auditoría.
- Endpoints: `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `GET /auth/me`, `GET /auth/sessions`, `POST /auth/sessions/:id/revoke`.
- Rate limiting en login con **backoff temporal** por combinación correo + IP: retardo creciente y bloqueo de duración limitada que expira solo. Nunca se bloquea una cuenta de forma indefinida ni de forma que un tercero pueda dejar fuera al titular; el bloqueo por IP y el bloqueo por cuenta se cuentan por separado y el mensaje de error es idéntico para credenciales inválidas y usuario inexistente.
- Auditoría de login, logout, refresh, rotación, revocación, reutilización detectada y fallos.

### Multiempresa

- `organization_id` obligatorio en toda entidad de negocio. **Convención documentada:** toda tabla de negocio futura lleva `organization_id`, y `branch_id` cuando el dato pertenezca a una sucursal; se anota en `DECISIONS.md` y en el README de migraciones.
- El `organization_id` se resuelve **siempre** desde el token/sesión; cualquier valor enviado por el cliente se ignora.
- Contexto de petición tipado (`orgId`, `userId`, `roles`) inyectado por hook `preHandler`; los repositorios exigen el contexto y no aceptan consultas sin filtro de organización.
- El aislamiento obligatorio vive en la capa de repositorios. En `DECISIONS.md` se documenta como trabajo futuro una **segunda barrera con PostgreSQL RLS** (políticas por `current_setting('app.org_id')`) como defensa en profundidad, portable a AWS RDS; no se implementa en esta fase.
- Licencia: estados `ACTIVE / GRACE / READ_ONLY / SUSPENDED / CANCELLED` modelados y verificados por middleware (bloqueo de escrituras en `READ_ONLY`), autoridad en servidor.

### Migraciones (`/api/migrations`)

SQL puro numerado y versionado, aplicable en Supabase hoy y en AWS RDS/Aurora después. Sin extensiones ni funciones propietarias de Supabase. `NUMERIC` para toda cantidad y dinero.

`0001_init.sql`: `organizations`, `branches`, `warehouses`, `users`, `roles`, `permissions`, `user_roles`, `user_branches`, `sessions`, `refresh_tokens`, `licenses`, `audit_log`, más índices y claves foráneas.

Seed **DEV ONLY**: no es una migración numerada y no se aplica nunca de forma automática. Se ejecuta con `npm run seed:dev`, que aborta si `NODE_ENV=production`. Crea organización demo, sucursal, licencia ACTIVE y roles base; el usuario administrador toma correo y contraseña de variables de entorno (`SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`) o genera una contraseña aleatoria y la imprime una sola vez en consola. **No se versiona ninguna credencial reutilizable en el repositorio.**

Runner de migraciones propio (`npm run migrate`) con tabla `schema_migrations`.


## 3. Frontend (`/vue-app`)

Vue 3 + Vite + TS + `<script setup>` + Vue Router + Pinia + Tailwind, español (MX), desktop first.

- Estructura por módulos: `src/modules/{auth,dashboard,settings}`, `src/shared/{components,composables,utils}`, `src/stores`, `src/services`.
- Cliente HTTP centralizado (Axios) con base URL por `VITE_API_URL`, envío de access token, refresh automático ante 401 con cola de reintentos, y manejo unificado de errores. **Sin SDK de Supabase en el cliente.**
- Stores Pinia: `auth` (sesión, usuario, permisos), `organization` (org, sucursal activa, licencia), `ui` (tema, marca, estado online).
- Rutas: landing pública `/` con SEO, `/login`, y área privada `/app` con guard de autenticación, `noindex`, layout desktop-first (barra lateral colapsable, topbar con sucursal y estado de conexión, área de contenido) y dashboard placeholder.
- Guard por permisos preparado para los módulos siguientes.
- PWA: `vite-plugin-pwa` con `generateSW`, manifest, iconos, registro solo en producción, `NetworkFirst` para navegaciones. **El Service Worker no cachea nunca `/api/v1/auth/*` ni ninguna respuesta privada del API**: se precachea únicamente el app shell y los assets estáticos con hash, y las rutas del API quedan explícitamente excluidas (`denylist` de navegación + sin runtime caching para el API en esta fase). Wrapper de IndexedDB (`idb`) y stub de cola de sincronización preparados para la fase offline, sin lógica de ventas todavía.
- Estados loading / empty / error / offline como componentes compartidos.
- Build de producción sin sourcemaps y sin secretos.
- Modo mock: `VITE_USE_MOCKS=true` sirve **exclusivamente** para desarrollo de UI sin base de datos. Queda documentado y comprobado por prueba que los mocks nunca se activan en el build de producción, y que **no cuentan como verificación de autenticación, permisos, licencia ni aislamiento multiempresa** — eso solo se valida contra la API real.

## 4. App raíz React (portal)

`src/routes/index.tsx` se reescribe como portal de estado de Geeksium POS: qué es el proyecto, estado de cada módulo V1, comandos de arranque y enlaces a los documentos. Metadatos propios (título, descripción, og/twitter). Sin lógica de negocio del POS.

## 5. Pruebas

Vitest en ambos proyectos. Las pruebas de seguridad corren contra la API real (Postgres de prueba), nunca contra mocks.

- API: login correcto/incorrecto con mensaje indistinguible, backoff y expiración del bloqueo, rotación de refresh, detección de reutilización que revoca la familia, refresh token no legible en base de datos (solo hash), logout revoca sesión, **aislamiento de tenant** (un usuario de la organización A no puede leer ni escribir datos de la B, ni forzándolo por parámetro), permisos por rol, estados de licencia, y forma de error en producción sin stack trace.
- Frontend: store de auth, guards de ruta, interceptor de refresh.


## 6. Criterio de terminado

`npm run build` y `npm run test` verdes en `/api` y `/vue-app`, cero errores de TypeScript, la app raíz compila, y `/docs/IMPLEMENTATION_STATUS.md` refleja el estado real.

## Fuera de esta entrega (fases siguientes del PRD)

Productos, unidades y conversiones, inventario, POS, compras, traspasos, traspasos con saldo, caja, reportes, offline/sync completo, marca blanca y hardening. Nada de V2: sin CFDI/SAT, sin OAuth social, sin IA, sin pago mixto, sin lotes ni producción.
