# Geeksium POS

Punto de venta multiempresa con inventario, sucursales y control de licencias.
Este repositorio es un monorepo con tres piezas y una única fuente de verdad
funcional: `docs/PRD_Geeksium_POS_V1.md`.

| Carpeta | Qué es | Estado |
|---|---|---|
| `vue-app/` | **Producto final**: PWA Vue 3 + Vite + TypeScript + Pinia + Tailwind | Catálogo local-first, cola offline y OTA |
| `api/` | **Backend**: Node.js + TypeScript + Fastify + Zod + PostgreSQL | Auth, catálogo multiempresa, sync y assets |
| `src/` | Portal de estado en React/TanStack Start que la plataforma Lovable muestra en la vista previa | informativo, no es el producto |
| `docs/` | PRD, arquitectura, seguridad, puesta en marcha y estado de implementación | vigente |

Lo que hoy existe y lo que todavía no está en
[`docs/IMPLEMENTATION_STATUS.md`](docs/IMPLEMENTATION_STATUS.md). Catálogo y sync
ya son funcionales. POS, Inventario, Compras, Traspasos, Caja y Reportes siguen
pendientes. La validación local no autoriza migraciones remotas: consultar
[el informe](docs/11_VALIDATION_REPORT.md) y
[PRE-PILOT BLOCKERS](docs/10_DEPLOYMENT.md).

## Arranque rápido

Requisitos: Node.js 20+, npm 10+ y un PostgreSQL accesible con la extensión
`pgcrypto` disponible (la migración `0001_init.sql` la crea y sigue siendo un
requisito vigente en Supabase, RDS o Aurora).

```bash
# 1. Backend en http://localhost:3000
cd api
npm install
cp .env.example .env        # completa DATABASE_URL y JWT_SECRET
npm run migrate
npm run seed:dev            # opcional; exige ALLOW_DEV_SEED=true
npm run dev

# 2. PWA en http://localhost:5173 (proxy /api -> localhost:3000)
cd ../vue-app
npm install
npm run dev
```

Detalle completo en [`docs/02_PUESTA_EN_MARCHA.md`](docs/02_PUESTA_EN_MARCHA.md).

## Verificación

```bash
cd api      && npm run lint && npm run typecheck && npm test   # necesita TEST_DATABASE_URL
cd vue-app  && npm run typecheck && npm test && npm run build
```

Las pruebas de integración de `api` se **saltan** si no defines
`TEST_DATABASE_URL`; nunca usan mocks de base de datos.

## Modo mock de la interfaz

`vue-app` puede arrancar sin backend con `VITE_USE_MOCKS=true` (solo en
desarrollo). Muestra un banner permanente **“MODO MOCK — SOLO UI”** para que
nadie confunda la demo con datos reales.

## Base de datos

PostgreSQL puro, migraciones en SQL estándar aplicadas por `npm run migrate`.
La API usa PostgreSQL directamente y un adaptador REST opcional para imágenes
en Supabase Storage. Vue no usa SDK de Supabase. Migrar de proveedor requiere
restaurar PostgreSQL, configurar TLS/conexión y adaptar/copiar Storage si se usa.
Las migraciones aditivas `0004_local_first_catalog.sql` y
`0005_inventory_v1.sql` deben preceder al despliegue de esta API. La 0005 deja
el costo opcional y agrega movimientos/stock transaccional; sigue pendiente de
aplicarse y validarse en PostgreSQL local o desechable (nunca se aplicó remoto).

## Documentación

- [`docs/PRD_Geeksium_POS_V1.md`](docs/PRD_Geeksium_POS_V1.md) — fuente de verdad
- [`docs/00_ARQUITECTURA.md`](docs/00_ARQUITECTURA.md)
- [`docs/01_SEGURIDAD.md`](docs/01_SEGURIDAD.md)
- [`docs/02_PUESTA_EN_MARCHA.md`](docs/02_PUESTA_EN_MARCHA.md)
- [`docs/IMPLEMENTATION_STATUS.md`](docs/IMPLEMENTATION_STATUS.md)
- [Local-first y sync](docs/05_LOCAL_FIRST_SYNC.md)
- [Catálogo](docs/06_PRODUCT_CATALOG.md), [assets](docs/07_ASSETS_AND_IMAGES.md)
  y [auditoría](docs/08_AUDIT_LOG.md)
- [OTA](docs/09_OTA_UPDATES.md) y [despliegue](docs/10_DEPLOYMENT.md)
- [Validación A–K](docs/11_VALIDATION_REPORT.md)
- [`docs/03_INFORME_RONDA_1.md`](docs/03_INFORME_RONDA_1.md) y
  [`docs/04_INFORME_RONDA_2.md`](docs/04_INFORME_RONDA_2.md)
