# Catálogo, sucursales y permisos

```text
Product = organization scope
Price/cost/stock = branch scope
```

products contiene nombre, normalización, barcode, aliases asociados, categoría,
SKU, descripción, tipo, unidad, conversiones, asset principal y estado.
branch_products contiene precio, costo, stock y configuración local.

Seleccionar un producto existente copia solo información global; precio y costo
empiezan vacíos y son obligatorios para activarlo. Editar catálogo global sin
vínculo local no crea una asignación involuntaria. Los importes viajan como string
decimal y se almacenan como numeric. Stock inicial cero; no hay movimientos de
inventario. Archivo/reactivación cambia active y produce deltas; no existe DELETE
de producto. El barcode sigue reservado al archivar.

## Coincidencias

Se conserva displayName; normalizedName elimina diferencias de acentos,
mayúsculas/separadores y compactKey elimina espacios preservando diferencias
numéricas relevantes. Aliases participan en búsqueda local.
«Coca cola 600ml», «Cocacola 600ml» y «Coca Cola 600 ml» coinciden.
«Coca-Cola Zero 600 ml» no se fusiona automáticamente con la versión original.

Prioridad: barcode, nombre/alias compacto exacto, similitud por bigramas.
Sin barcode concluyente se exige decisión explícita; no se fusiona fuzzy.
Un barcode existente reutiliza el producto sin sobrescribir una sucursal ya
vinculada. Fastify vuelve a validar duplicados porque la copia local puede ser vieja.
Búsqueda/autocomplete trabaja sobre IndexedDB hidratada, sin request por tecla.
La clasificación de filas CSV es helper; no hay importador masivo completo.

## Permisos efectivos

| Rol de sistema | Leer | Modificar global | Precio/costo | Ignorar aviso |
|---|---|---|---|---|
| OWNER | Sí | Sí | Sí | Sí, auditado |
| ADMIN | Sí | Sí | Sí | Sí, auditado |
| SUPERVISOR | Sí | Sí | Sí | Sí, auditado |
| CASHIER | Sí | No | No | No |
| WAREHOUSE | Sí | No | No | No |

Vocabulario: catalog.read/manage/duplicate, price.change, cost.change/read.
Roles personalizados siguen permisos efectivos; ignorar un aviso además exige
OWNER/ADMIN/SUPERVISOR. Fastify consulta acceso actual aunque el JWT siga vigente.
Ocultar botones no autoriza; INVENTORY_ADJUST no se implementó.

POST /products y POST /sync/operations comparten product.create, product.edit,
branch.set y alias.add. Se exige revisión en edición/configuración local y se
rechazan mezclas de payload que eludan ese control. Alta con vínculo inicial
es atómica; posteriores cambios global/local son comandos independientes.
Puede confirmarse el global y quedar el local en conflicto, visible para revisión.
