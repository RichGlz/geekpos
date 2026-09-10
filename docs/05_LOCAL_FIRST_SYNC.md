# Local-first y sincronización

Vue/PWA → IndexedDB → Sync Manager → Fastify → PostgreSQL.
Montar Resumen o escribir en el buscador no dispara HTTP. El store central
sincroniza al iniciar sesión, manualmente, al reconectar, al volver a primer plano
y cada cinco minutos. Regresar a primer plano puede adelantar una sincronización.
Errores transitorios aplican backoff exponencial; no hay polling por ruta o tecla.

## Persistencia y aislamiento

IndexedDB v2 conserva cola y metadata de v1; añade productos, aliases, datos de
sucursal, assets y fotos pendientes. Scope: organización + usuario + sucursal.
No se persisten JWT, contraseñas o refresh tokens. La sesión offline requiere
un perfil previamente autenticado y una licencia local válida; el primer acceso
requiere conexión.

Comandos e imagen se guardan juntos en una transacción local antes del HTTP.
La secuencia durable preserva orden entre lotes/pestañas. Logout conserva
pendientes; otra cuenta no puede enviarlos. Revocar una sucursal elimina sus
lecturas locales al reconectar; retirar cost.read oculta/purga costos. Reiniciar
cursores permite reconstruir datos autorizados. Los pendientes se conservan.

El aislamiento evita mezclas accidentales, pero IndexedDB no está cifrada:
un administrador del navegador/dispositivo puede inspeccionarla. Una revocación
remota no puede conocerse mientras el dispositivo permanezca offline.

## Protocolo API v1

Base: /api/v1.

- GET /sync/context: organización, sucursales activas asignadas, acceso vigente,
  resumen de licencia y release.
- GET /license: estado, lastLicenseValidationAt y licenseOfflineValidUntil.
- GET /sync?version=1&since=0&branchId=<uuid>: páginas de hasta 500 eventos,
  changes, syncVersion, hasMore y serverTime.
- POST /sync/operations: un comando idempotente.

El cursor es un entero transportado como string. El servidor bloquea el contador
de organización hasta COMMIT. Cambio, log, recibo y auditoría son transaccionales;
una transacción que termina tarde no queda detrás de un cursor ya consumido.
ORDER BY usa el valor numérico, no su representación textual.

Página y cursor se aplican atómicamente en IndexedDB. Una interrupción permite
repetir sin saltos. No hay retención/compactación del historial en esta ronda:
introducirla requiere snapshot/resync compatible con equipos que pasan días offline.
Escrituras directas SQL fuera de este protocolo no generan automáticamente deltas.

El delta incluye datos globales y solo la sucursal solicitada y autorizada;
omite costo sin cost.read. Tenant procede de sesión. X-Expected-Organization y
X-Expected-User detectan cambio de sesión durante envío; no conceden acceso.

## Reintentos y conflictos

Idempotency key UUID, actor y hash del comando validado permiten repetir la misma
intención sin duplicar efectos. Reutilizar una clave con otro comando es conflicto.
Revisión esperada protege productos y precio/costo: el segundo equipo recibe 409
y REQUIRES_REVIEW, sin last-write-wins silencioso. Conflictos/permisos se revisan;
errores transitorios conservan cola.

Hay single-flight por store y Web Lock entre pestañas cuando está disponible.
Sin locks, la API mantiene idempotencia y revisiones. Una imagen fallida no
impide enviar comandos independientes.

## Licencia offline

Hasta tres días normal; desde tres aviso; desde siete gracia visible; a los diez
o al límite anterior del servidor requiere validación. Se conserva la mayor hora
observada y se detectan retrocesos de reloj; no se fuerza una recarga en operación.

Es una política de experiencia de usuario, no una prueba criptográfica:
perfil, reloj y almacenamiento son manipulables. Aprobar confianza del dispositivo,
desbloqueo del operador y concesión offline verificable antes de piloto comercial.
No se amplió esa arquitectura en esta ronda.
