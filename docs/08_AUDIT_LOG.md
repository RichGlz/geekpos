# Auditoría

Se reutiliza audit_log. La aplicación inserta; no ofrece endpoints normales
UPDATE/DELETE. Es append-only desde aplicación, no inmutabilidad frente a un
administrador PostgreSQL. Revisar grants, retención y backup operacional.

0004 añade branch_id y device_id opcionales e índice por organización/sucursal/
fecha. Cambio de catálogo, auditoría y recibo idempotente comparten transacción;
un reintento no registra el mismo efecto dos veces.

| Evento | Estado |
|---|---|
| Producto creado/editado/archivado/reactivado | Implementado |
| Alias y configuración de sucursal | Implementado |
| Precio/costo cambiado | Implementado, antes/después compactos |
| Duplicado pese a advertencia | Implementado, decisión explícita |
| Login/refresh/reuse/logout/cierre remoto | Conservado |
| Ajuste de inventario | Pendiente de movimientos |
| Importación masiva | Pendiente de importador |
| Cambios administrativos de permisos | Pendiente de esa funcionalidad |

Offline conserva intención en comando; el servidor valida y registra actor y hora
al sincronizar. device_id es información declarada, no identidad hardware.
No se registran JWT, cookies, claves, contraseñas ni imágenes.

**Orden obligatorio:** la API nueva requiere 0004 antes de arrancar, incluso
auditoría de auth inserta columnas nuevas. No se modificó auth para ocultar una
migración faltante ni se cambiaron migraciones históricas.
