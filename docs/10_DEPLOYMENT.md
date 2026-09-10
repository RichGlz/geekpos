# Despliegue — revisión humana previa

**NOT_READY_FOR_REMOTE_MIGRATION**

La validación local es favorable; falta verificar entorno real y reversión.
No se aplicó nada a Supabase remoto. Este documento no autoriza ejecución remota.

## PRE-PILOT BLOCKERS

| Prioridad | Bloqueo | Criterio de cierre |
|---|---|---|
| P0 | public sensible expuesto por PostgREST sin RLS, reportado por usuario | Auditar roles/grants/esquemas, cerrar acceso directo y probar auth/API |
| P0 | Backup/migración no ensayados con datos representativos | Restaurar backup en staging; aprobar 0004 y probar reversión de aplicación |
| P0 | Secretos/env | Revisar valores de seed no vacíos preexistentes en .env.example sin publicarlos; confirmar que no son credenciales reales y rotar si se expusieron |
| P0 | Storage privado y permisos | Verificar gkspos-buk, backend autorizado y denegación anónima/cross-tenant |
| P1 | TLS PostgreSQL | Pool/migrador preexistentes usan rejectUnauthorized:false con SSL; ensayar CA/hostname antes de endurecer producción |
| P1 | HTTPS, cookies y CORS | Orígenes exactos, Secure/SameSite apropiados y rechazo de origen ajeno |
| P1 | Compatibilidad API/PWA/IndexedDB | Canales coherentes, dos releases/pestañas y cliente viejo offline; conservar hashes/protocolo v1 |
| P1 | Acceso/licencia offline en equipo compartido | Aprobar confianza/desbloqueo; perfil actual no es grant firmado ni almacenamiento cifrado |
| P1 | Recuperación operativa | Monitorear pendientes/conflictos/cuotas y coordinar backup DB/Storage |

P0 bloquea preparación remota. P1 debe cerrarse antes del piloto. POS, inventario
y caja siguen fuera de alcance y no deben anunciarse como operativos.

## PostgREST/RLS: propuesta, no aplicada

Fastify conecta directamente con pg + DATABASE_URL. Sus permisos y FK no
protegen una vía paralela PostgREST con grants amplios. 0004 revoca permisos
anon/authenticated solo en tablas nuevas y si esos roles existen; no corrige
tablas históricas, grants PUBLIC ni herencia de roles.

1. Identificar rol real Fastify, dependencias, grants y esquemas sin volcar secretos.
2. Si no se usa Data API, evaluar deshabilitarla según la
   [guía oficial](https://supabase.com/docs/guides/api/securing-your-api).
   Verificar separadamente los servicios utilizados.
3. Si se necesita, limitar esquemas/grants y diseñar RLS en staging con privilegios
   mínimos. No habilitar políticas indiscriminadas ni asumir protección para BYPASSRLS.
4. Probar acceso anónimo/autenticado, aislamiento tenant y regresión auth/API.

La clave privilegiada Storage solo vive en backend. Revisar
[control de acceso oficial](https://supabase.com/docs/guides/storage/security/access-control).
No se inspeccionaron políticas ni credenciales remotas.

## Variables

No se cambiaron .env reales.

| Lugar | Variables |
|---|---|
| Backend | APP_VERSION (0.2.0), APP_MINIMUM_VERSION (0.1.0), APP_UPDATE_CHANNEL (stable) |
| Storage backend | SUPABASE_STORAGE_URL, SUPABASE_STORAGE_KEY, SUPABASE_STORAGE_BUCKET (gkspos-buk) |
| Build Vue | VITE_APP_VERSION (0.2.0), VITE_UPDATE_CHANNEL (stable), VITE_API_BASE_URL (/api/v1) |
| Desarrollo | VITE_API_PROXY, solo proxy Vite |
| Organización | organizations.update_channel (stable por defecto) |

Los valores VITE_ son públicos. Nunca poner secretos DB/JWT/Storage allí.
Coordinar versiones explícitamente; package.json no selecciona APP_VERSION.

## Orden después de aprobación

1. Fijar artefactos y revisión SQL; restaurar/ensayar backup en staging.
2. Verificar 0001–0003 intactas; aplicar 0004 con migrador transaccional autorizado.
   No ejecutar migradores concurrentes.
3. Desplegar API compatible. **0004 debe precederla incluso para login/refresh,
   porque auditoría utiliza las columnas nuevas.**
4. Smoke health/auth/permisos, aislamiento, catálogo, conflictos, delta y assets;
   aprobar HTTPS/CORS/cookies.
5. Publicar PWA de ese canal atómicamente y conservar assets anteriores.
   No elevar versión mínima sin validar actualización segura.
6. Observar backlog. Preferir rollback de artefacto compatible manteniendo esquema
   aditivo. No hacer DROP: puede haber datos confirmados y pendientes.
   Restaurar backup exige decidir sobre escrituras perdidas/reenvíos idempotentes.

El migrador registra nombres en schema_migrations, no tiene down migrations.
Pruebas locales no sustituyen ensayo con datos representativos ni restauración.
