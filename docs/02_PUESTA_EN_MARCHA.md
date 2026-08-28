# Puesta en marcha — Geeksium POS V1

Requisitos: Node.js 20+, npm 10+ y una base PostgreSQL accesible.

`migrations/0001_init.sql` ejecuta `CREATE EXTENSION IF NOT EXISTS pgcrypto`.
Es una dependencia **vigente y obligatoria**, no opcional: el usuario de la base
debe poder crear esa extensión (Supabase, RDS y Aurora la soportan).

## 1. Backend (`/api`)

```bash
cd api
npm install
cp .env.example .env      # completa DATABASE_URL y JWT_SECRET
npm run migrate           # aplica migrations/*.sql en orden
npm run seed:dev          # opcional, solo desarrollo; exige ALLOW_DEV_SEED=true
npm run dev               # http://localhost:3000
```

Otros comandos:

```bash
npm run lint       # verifica las reglas de capas (SQL solo en repositorios y migraciones)
npm run typecheck  # tsc --noEmit
npm test           # unitarias + integración contra PostgreSQL real
npm run build      # compila a dist/
npm start          # ejecuta dist/index.js
```

Las pruebas de integración se **saltan** si no defines `TEST_DATABASE_URL`.
Debe apuntar a una base desechable con `npm run migrate` ya aplicado:

```bash
TEST_DATABASE_URL=postgres://usuario:password@localhost:5432/geeksium_test npm test
```

Variables de entorno (validadas con Zod al arrancar; el proceso no levanta si
falta alguna obligatoria):

| Variable | Descripción |
|---|---|
| `PORT` | Puerto HTTP. **3000** por defecto |
| `HOST` | Interfaz de escucha (`0.0.0.0` por defecto) |
| `DATABASE_URL` | Cadena de conexión PostgreSQL |
| `DATABASE_SSL` | `true` para conexiones administradas que lo exigen |
| `JWT_SECRET` | **Único** secreto de firma del access token (mínimo 32 caracteres). El refresh token no es un JWT: es un secreto opaco del que solo se guarda el hash |
| `ACCESS_TOKEN_TTL_SECONDS` | Vida del access token (900 por defecto) |
| `REFRESH_TOKEN_TTL_DAYS` | Vida del refresh token (30 por defecto) |
| `COOKIE_SECURE` | `true` obligatorio en producción; el arranque falla si no lo es |
| `COOKIE_SAMESITE` | `lax` por defecto; `none` si la API vive en otro dominio |
| `COOKIE_DOMAIN` | Opcional, para compartir la cookie entre subdominios |
| `CORS_ORIGINS` | Orígenes permitidos **separados por coma** |
| `LOGIN_MAX_ATTEMPTS`, `LOGIN_WINDOW_SECONDS`, `LOGIN_LOCK_MAX_SECONDS` | Backoff de login |
| `ALLOW_DEV_SEED` | Debe ser `true` para que `npm run seed:dev` haga algo |
| `TEST_DATABASE_URL`, `TEST_DATABASE_SSL` | Base desechable para las pruebas de integración |

No existen `JWT_ACCESS_SECRET` ni `JWT_REFRESH_SECRET`, ni una variable
`CORS_ORIGIN` en singular.

## 2. Frontend (`/vue-app`)

```bash
cd vue-app
npm install
cp .env.example .env.local
npm run dev        # http://localhost:5173, con proxy /api → localhost:3000
```

Otros comandos:

```bash
npm run typecheck  # vue-tsc
npm test           # vitest: store de sesión, permisos, guards, interceptor HTTP y cola offline
npm run build      # build de producción + service worker
npm run preview    # sirve el build
```

Variables (`VITE_*`, públicas: nunca pongas secretos):

| Variable | Descripción |
|---|---|
| `VITE_API_BASE_URL` | Base de la API. `/api/v1` en desarrollo |
| `VITE_API_PROXY` | Destino del proxy del dev server (`http://localhost:3000`) |
| `VITE_USE_MOCKS` | `true` activa la capa de mocks **solo en desarrollo**, con banner “MODO MOCK — SOLO UI” |

## 3. Portal de estado (raíz)

La aplicación React de la raíz es solo el tablero de avance que se ve en la vista
previa de la plataforma. No requiere configuración ni forma parte del producto.

## Mover la base de datos a AWS

Las migraciones son SQL estándar y el acceso pasa siempre por `DATABASE_URL`.
Para migrar a RDS/Aurora: restaurar el volcado, garantizar `pgcrypto`, apuntar
`DATABASE_URL` a la nueva instancia y ejecutar `npm run migrate`. No hay
dependencias del SDK de Supabase.
