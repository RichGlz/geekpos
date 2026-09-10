# Estado de implementación — Geeksium POS

Corte: 9 de septiembre de 2026. Ronda local-first, catálogo y OTA.
**Parcialmente completo. Preparado para revisión humana local;
NOT_READY_FOR_REMOTE_MIGRATION.** Ningún cambio aplicado a Supabase remoto.

## Alcance comprobado

| Área | Estado local | Límite |
|---|---|---|
| Auth, refresh, tenant y licencia | Pruebas completas pasan | Configuración real de producción pendiente |
| Catálogo global, aliases, barcode, duplicados y archivo | Implementado | Sin importador CSV completo |
| Precio/costo/configuración por sucursal | Implementado | Stock inicial; no hay movimientos |
| IndexedDB, cola y sync incremental | Implementado y probado | Solo escrituras a través del protocolo generan deltas |
| Sesión offline | Implementada y probada | Perfil sin tokens; no es grant firmado ni almacenamiento cifrado |
| Assets WebP y dedupe por organización | Helpers/API probados | Storage real pendiente |
| OTA con canales y bloqueos | Lógica y build probados | Alcance manual detallado en informe |
| Auditoría catálogo/precios/costos | Transaccional | Ajustes, importaciones y administración de permisos pendientes |
| POS, cobro, caja, inventario, compras, traspasos, reportes | No implementados | Rutas restantes son placeholders |
| Portal React raíz | Informativo | No es el producto Vue |

Arquitectura: Vue/PWA → IndexedDB → Sync Manager → Fastify → PostgreSQL.
Sin SDK Supabase en Vue ni Realtime.

```text
Product = organization scope
Price/cost/stock = branch scope
```

## Migraciones

0001_init.sql, 0002_phase0_hardening.sql y 0003_phase0_null_integrity.sql
permanecen sin cambios. La nueva 0004_local_first_catalog.sql es aditiva:
catálogo, aliases, assets, configuración local, log de cambios, recibos,
canal de actualización y columnas de auditoría.

Pasan en PostgreSQL 17.6 local desechable, también al añadir 0004 sobre
0001–0003 con organización/sucursal preexistentes conservadas. Repetir el
migrador indica base actualizada. La API nueva requiere 0004 antes de arrancar,
incluso para auditoría de auth. No se verificaron roles/grants/datos remotos.

## Pruebas y documentos

API: 47/47 (14 unitarias + 33 integración real). Vue: 53/53.
Typecheck de ambos, lint de capas API y build Vue pasan.
Consultar evidencia y límites en [validación A–K](11_VALIDATION_REPORT.md).

- [Local-first/sync](05_LOCAL_FIRST_SYNC.md)
- [Catálogo y permisos](06_PRODUCT_CATALOG.md)
- [Imágenes/assets](07_ASSETS_AND_IMAGES.md)
- [Auditoría](08_AUDIT_LOG.md)
- [PWA/OTA](09_OTA_UPDATES.md)
- [Despliegue y PRE-PILOT BLOCKERS](10_DEPLOYMENT.md)

## PRE-PILOT BLOCKERS

PostgREST/RLS, revisión SQL remota y backup restaurable, Storage privado,
secretos/env, TLS PostgreSQL, HTTPS/cookies/CORS, compatibilidad API/PWA,
y política de acceso/licencia offline. Prioridades y criterios de cierre
están en el documento de despliegue. No son cambios remotos autorizados.
