# Arquitectura — Geeksium POS V1

## Estructura del repositorio

```text
/docs      Fuente de verdad: PRD, arquitectura, seguridad y puesta en marcha
/api       Backend Node.js + TypeScript + Fastify + PostgreSQL
/vue-app   Frontend de producción: Vue 3 + Vite + TypeScript + Pinia + Tailwind + PWA
/src       Portal de estado del proyecto (React/TanStack, solo informativo)
```

El producto real es `/vue-app` + `/api`. La aplicación en `/src` existe únicamente
porque la vista previa de la plataforma sirve la raíz del repositorio; no contiene
lógica de negocio y no debe crecer.

## Backend (`/api`)

Capas, de fuera hacia dentro:

```text
http/routes   → validación Zod de entrada/salida, sin lógica ni SQL
http/*        → autenticación, contexto de petición, manejo de errores
services/     → reglas de negocio (auth, licencia, throttling de login)
repositories/ → ÚNICO lugar donde vive SQL de aplicación
db/pool       → pool de PostgreSQL y transacciones
```

Reglas verificadas automáticamente por `npm run lint` (`scripts/check-layering.mjs`):

- El SQL de aplicación vive solo en `src/repositories` y `migrations/`.
- Ninguna ruta o servicio llama a `pool.query()` directamente.
- Solo `src/db` importa el driver `pg`.

### Portabilidad de base de datos

Las migraciones son SQL puro en `api/migrations/*.sql`, aplicadas por
`api/scripts/migrate.ts` contra una tabla `schema_migrations`. No se usan
extensiones ni funciones propias de un proveedor, de modo que la base puede
moverse de Supabase a AWS RDS/Aurora cambiando únicamente `DATABASE_URL`.

El cliente Supabase **no** se usa en el frontend: la aplicación Vue solo habla con
la API de Fastify.

## Aislamiento multiempresa

- `organization_id` es obligatorio en toda tabla de negocio.
- El `organization_id` **nunca** se toma del cuerpo o de los parámetros de la
  petición: se resuelve en el servidor a partir de la sesión (`http/context.ts`).
- Toda consulta de repositorio recibe el `organization_id` como primer criterio
  del `WHERE`. Un repositorio sin ese filtro se considera un defecto de seguridad.
- Defensa en profundidad prevista: activar RLS en PostgreSQL con políticas por
  `organization_id` una vez que el conjunto de tablas de V1 esté estable.

## Frontend (`/vue-app`)

```text
src/lib          Cliente HTTP con reintento automático de refresh
src/modules/*    Módulos de negocio (api + store + vistas)
src/layouts      Layout desktop-first de la aplicación
src/views        Landing, login, dashboard y placeholders de módulos
src/router       Rutas y guards de navegación (solo UX, no autorización)
```

- Estado con Pinia. El access token vive **solo en memoria**.
- Diseño desktop-first, tokens de color y tipografía en `src/styles/main.css`.
- PWA con `vite-plugin-pwa`; el service worker no cachea `/api` (ver seguridad).
