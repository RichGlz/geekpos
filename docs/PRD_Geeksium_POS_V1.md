# PRD maestro — Geeksium POS
## Punto de venta, inventario, traspasos internos y reportería multiempresa

**Versión del documento:** 1.0  
**Estado:** Alcance V1 congelado para inicio de desarrollo  
**Idioma del producto:** Español (México)  
**Nombre provisional del producto:** Geeksium POS  
**Tipo de producto:** SaaS / PWA multiempresa y multisucursal  
**Frontend de producción objetivo:** Vue 3 + Vite + TypeScript + Pinia + Tailwind CSS  
**Backend objetivo:** API propia Node.js + TypeScript  
**Base de datos inicial:** PostgreSQL administrado mediante Supabase, usado principalmente como PostgreSQL  
**API inicial:** `https://api.geeksium.com`  
**Estrategia de crecimiento:** portable a AWS RDS/Aurora PostgreSQL sin reescribir el frontend  
**Diseño:** Desktop first, responsive para tablet y celular  
**SEO:** relevante solo para la landing page pública  
**Autenticación:** propia, correo + contraseña; sin Google/Facebook en V1  
**Impresión:** ticket de 80 mm mediante sistema operativo; agente Windows opcional posterior  
**Offline V1:** ventas locales mediante IndexedDB + cola de sincronización  

---

# 0. Cómo debe usarse este documento

Este documento es la fuente de verdad funcional y técnica para la primera versión de Geeksium POS.

No debe interpretarse como una lista de ideas opcionales. Cuando una característica aparece marcada como **V1**, forma parte del alcance aprobado salvo que exista una nota explícita que indique lo contrario.

La aplicación deberá construirse evitando que nuevas ideas surgidas durante el desarrollo desplacen el alcance. Las ideas no críticas deberán añadirse a V2/V3 y no modificar V1.

Este PRD tiene cinco objetivos:

1. Definir exactamente qué problema resuelve el producto.
2. Definir módulos, pantallas, procesos y reglas.
3. Definir la arquitectura técnica que permita crecer a múltiples clientes.
4. Evitar decisiones que obliguen a reescribir el sistema al migrar a AWS.
5. Servir como documento maestro para Lovable, Codex y futuras herramientas de desarrollo.

---

# 1. Contexto del producto

Geeksium POS nace como un sistema de punto de venta e inventario para negocios que necesitan controlar venta, existencias, entradas, salidas, compras, traspasos y reportes sin depender de una computadora dedicada.

Los primeros casos de uso previstos son:

- Un molino de tortillas.
- Bodegas y sucursales de Pollo Feliz en Mérida.
- Potencial despliegue posterior a otras sucursales del mismo grupo en México.
- Otros comercios con necesidades similares.

El sistema debe ser suficientemente genérico para utilizarse en negocios distintos, pero debe cubrir desde V1 particularidades importantes de alimentos, almacenes y venta por peso/unidad.

La referencia de producto analizada muestra que un POS comercial normalmente crece desde un núcleo de venta + existencias hacia compras, traspasos, permisos, reportes, dispositivos, fabricación, crédito y funciones financieras. Geeksium POS seguirá esa lógica de crecimiento, pero V1 se concentrará en las funciones que crean valor operativo inmediato.

---

# 2. Problemas que debe resolver

## 2.1 Problemas principales

1. Registrar ventas de forma rápida.
2. Saber cuánto inventario existe realmente.
3. Registrar por qué aumenta o disminuye una existencia.
4. Controlar inventarios expresados en unidades distintas.
5. Convertir empaques a unidades base.
6. Registrar compras y proveedores.
7. Transferir mercancía entre sucursales o bodegas.
8. Controlar traspasos con cargo y saldo pendiente entre sucursales.
9. Consultar reportes operativos.
10. Exportar y compartir información.
11. Operar aunque temporalmente no exista Internet.
12. Imprimir tickets de 80 mm.
13. Manejar múltiples organizaciones y sucursales en una sola plataforma.
14. Aplicar roles y permisos.
15. Administrar licencias por organización.
16. Personalizar nombre, logotipo y apariencia por cliente.
17. Mantener la lógica crítica fuera del navegador.
18. Permitir migración futura de la infraestructura a AWS.

## 2.2 Qué NO pretende ser V1

V1 no será un ERP contable completo.

No pretende resolver desde el inicio:

- contabilidad general;
- conciliación bancaria;
- timbrado CFDI;
- complemento de pago;
- facturación global;
- nómina;
- ecommerce;
- logística de última milla;
- producción/fabricación avanzada;
- CRM;
- marketing;
- contabilidad fiscal.

---

# 3. Principios de diseño del producto

## 3.1 Operación primero

La interfaz debe estar diseñada para que una persona pueda vender, recibir material o consultar existencias con pocos pasos.

## 3.2 Trazabilidad sobre edición destructiva

Una venta, movimiento de inventario, pago interno o traspaso no deberá borrarse silenciosamente.

Las correcciones deberán realizarse mediante cancelación, reversa, ajuste o movimiento compensatorio.

## 3.3 Multiempresa desde la base

Aunque el primer cliente tenga una sola sucursal, la arquitectura deberá soportar desde el inicio:

- múltiples organizaciones;
- múltiples sucursales;
- múltiples almacenes;
- múltiples cajas;
- múltiples usuarios;
- aislamiento estricto entre clientes.

## 3.4 Base de datos portable

La aplicación deberá usar PostgreSQL estándar, migraciones versionadas y una capa de API propia.

No se deberá acoplar el frontend directamente a consultas específicas de Supabase.

## 3.5 Seguridad en servidor

La autorización, licencia, validaciones críticas, cálculo definitivo de saldos y movimientos deberán ejecutarse en la API.

## 3.6 Offline controlado

La pérdida temporal de Internet no debe detener una venta.

El sistema utilizará IndexedDB como almacenamiento operativo temporal y una cola de sincronización.

## 3.7 Interfaz desktop first

La experiencia principal será escritorio/tablet.

Celular estará soportado principalmente para consulta, reportería y operaciones simples, sin impedir técnicamente una venta cuando sea necesario.

---

# 4. Stack tecnológico aprobado

## 4.1 Frontend de producción

- Vue 3.
- Vite.
- TypeScript.
- Composition API.
- `<script setup>`.
- Vue Router.
- Pinia.
- Tailwind CSS.
- PWA.
- Service Worker.
- IndexedDB mediante una capa de abstracción.
- Validación de formularios con esquemas.
- Cliente HTTP centralizado.
- Componentes accesibles y reutilizables.

Usar patrones propios de Vue:

- `v-for`
- `v-if`
- `v-show`
- `v-model`
- `computed`
- `ref`
- `reactive`
- `watch` solo cuando sea necesario
- composables
- stores Pinia
- componentes desacoplados

Evitar implementar patrones de React dentro de Vue.

## 4.2 Lovable

A partir de mayo de 2026 los proyectos nuevos de Lovable utilizan TanStack Start dentro del ecosistema React.

Por esa razón:

- NO cambiar el requisito del producto final a React.
- Mantener el proyecto raíz requerido por Lovable para compatibilidad de la herramienta.
- Crear el producto real como subproyecto independiente `/vue-app`.
- La lógica funcional definitiva debe vivir en `/vue-app` y/o `/api`.
- El shell React/TanStack de Lovable no debe convertirse en la fuente de verdad del producto.
- No duplicar reglas críticas en React y Vue.
- Lovable podrá utilizarse para generación, edición de archivos y apoyo visual, pero el build de producción del frontend se realizará desde `/vue-app`.

## 4.3 Backend/API

Propuesta:

- Node.js.
- TypeScript.
- Fastify.
- Zod para validación de payloads.
- Drizzle ORM o consultas PostgreSQL encapsuladas detrás de repositorios.
- Migraciones SQL versionadas.
- OpenAPI generado o mantenido junto a la API.
- Logs estructurados.
- Rate limiting.
- Pruebas de integración.

La API se desplegará inicialmente en:

`https://api.geeksium.com`

Rutas versionadas:

`https://api.geeksium.com/api/v1/...`

## 4.4 Base de datos

Inicial:

- PostgreSQL administrado en Supabase.

Supabase se utilizará como proveedor de PostgreSQL; V1 no debe depender obligatoriamente de Supabase Auth.

La aplicación deberá poder migrarse a:

- AWS RDS PostgreSQL; o
- Amazon Aurora PostgreSQL-Compatible.

## 4.5 Convenciones de datos

- IDs: UUID.
- Fechas en BD: `timestamptz`, guardadas en UTC.
- Presentación: zona horaria configurable por organización; default México.
- Cantidades: `NUMERIC(16,4)`.
- Dinero: `NUMERIC(14,2)`.
- Porcentajes: `NUMERIC`, nunca `float` para cálculos financieros.
- No usar `FLOAT` para cantidades o dinero que deban ser exactos.
- Los datos transaccionales no se eliminan físicamente.
- Catálogos pueden usar `deleted_at` o `active=false`.
- Cada tabla multi-tenant debe tener `organization_id`.
- Agregar `branch_id` cuando el registro pertenezca a una sucursal.

---

# 5. Arquitectura general

```text
                               ┌───────────────────────┐
                               │ Landing pública      │
                               │ + Login              │
                               └──────────┬────────────┘
                                          │
                                Vue 3 PWA │
                                          │ HTTPS
                                          ▼
                              ┌────────────────────────┐
                              │ api.geeksium.com       │
                              │ API Node/TS            │
                              └──────────┬─────────────┘
                                         │
                        ┌────────────────┼─────────────────┐
                        │                │                 │
                        ▼                ▼                 ▼
                 PostgreSQL        Storage          Email/servicios
                 Supabase          logos/docs       auxiliares
                        │
                        │ migración futura
                        ▼
                  AWS RDS/Aurora
```

El navegador nunca deberá recibir:

- contraseñas de base de datos;
- service-role keys;
- secretos SMTP;
- claves privadas;
- lógica de licenciamiento editable;
- credenciales AWS;
- claves administrativas.

---

# 6. Estructura sugerida del repositorio

```text
/
├── docs/
│   ├── PRD_Geeksium_POS_V1.md
│   ├── API.md
│   ├── DATABASE.md
│   └── DECISIONS.md
│
├── vue-app/
│   ├── package.json
│   ├── vite.config.ts
│   ├── src/
│   │   ├── app/
│   │   ├── assets/
│   │   ├── components/
│   │   ├── composables/
│   │   ├── layouts/
│   │   ├── modules/
│   │   │   ├── auth/
│   │   │   ├── dashboard/
│   │   │   ├── pos/
│   │   │   ├── inventory/
│   │   │   ├── operations/
│   │   │   ├── transfers/
│   │   │   ├── reports/
│   │   │   ├── settings/
│   │   │   └── platform-admin/
│   │   ├── router/
│   │   ├── services/
│   │   ├── stores/
│   │   ├── types/
│   │   └── utils/
│   └── public/
│
├── api/
│   ├── package.json
│   ├── src/
│   │   ├── modules/
│   │   ├── middleware/
│   │   ├── repositories/
│   │   ├── services/
│   │   ├── security/
│   │   ├── db/
│   │   └── server.ts
│   └── migrations/
│
└── [archivos requeridos por Lovable/React/TanStack]
```

El proyecto raíz de Lovable se conserva para que la plataforma continúe funcionando. El producto final no depende de ese shell.

---

# 7. Navegación principal

Navegación propuesta:

1. Inicio
2. POS
3. Inventario
4. Operaciones
5. Traspasos
6. Reportes
7. Ajustes

Para usuarios plataforma:

8. Administración de plataforma

Los módulos deberán ocultarse según permisos.

---

# 8. Landing page pública

## 8.1 Objetivo

Única sección con prioridad SEO.

Debe explicar:

- qué hace el producto;
- POS;
- inventario;
- multisucursal;
- reportería;
- operación offline;
- personalización;
- llamada a acción;
- inicio de sesión.

## 8.2 Rutas

- `/`
- `/login`
- `/recuperar-contrasena`

Las rutas privadas deberán usar `noindex`.

## 8.3 Login

Campos:

- Correo electrónico.
- Contraseña.
- Recordar sesión opcional.
- Botón iniciar sesión.
- Enlace recuperar contraseña.

No incluir en V1:

- Login Google.
- Login Facebook.
- Login Apple.
- OAuth social.

---

# 9. Autenticación propia

## 9.1 Flujo

1. Usuario introduce correo y contraseña.
2. Vue envía `POST /api/v1/auth/login`.
3. API busca usuario y organización.
4. API valida contraseña.
5. API verifica:
   - usuario activo;
   - organización activa;
   - licencia;
   - acceso a sucursal;
   - políticas básicas.
6. API devuelve sesión.
7. Frontend carga configuración y permisos.

## 9.2 Contraseñas

- Hash Argon2id.
- Nunca almacenar contraseña en texto plano.
- Nunca enviar hash al frontend.
- Política inicial sugerida: mínimo 10 caracteres.
- Permitir aumentar política por organización más adelante.

## 9.3 Tokens

Usar estándares existentes; NO crear criptografía propia.

Propuesta:

- Access token corto: aproximadamente 10–15 minutos.
- Refresh token rotatorio.
- Refresh token en cookie `HttpOnly`, `Secure`, `SameSite`.
- Access token en memoria del frontend.
- Rotar refresh token después de utilizarlo.
- Revocar cadena de refresh tokens ante comportamiento anómalo.
- Invalidar sesiones al desactivar usuario.

El requisito de una “clave dinámica cambiante” se resuelve mediante tokens de corta duración y rotación, no mediante cifrado casero.

## 9.4 Protección adicional

- HTTPS obligatorio.
- Rate limit de login.
- Registro de intentos fallidos.
- Delay progresivo o bloqueo temporal.
- CORS restringido a dominios permitidos.
- CSRF cuando corresponda.
- `X-Request-ID`.
- Idempotency keys en operaciones críticas.
- Validación de payload en servidor.
- Auditoría.
- Headers de seguridad.
- No exponer stack traces en producción.

---

# 10. Modelo multiempresa / multi-tenant

## 10.1 Organización

Entidad raíz de un cliente.

Ejemplos:

- Molino San José.
- Pollo Feliz.
- Cliente futuro.

Cada organización tiene:

- nombre;
- slug;
- logo;
- colores;
- configuración;
- licencia;
- usuarios;
- sucursales;
- productos;
- proveedores;
- clientes;
- movimientos;
- reportes.

## 10.2 Aislamiento

Una organización jamás debe poder consultar IDs de otra organización.

Regla obligatoria:

> `organization_id` se obtiene de la sesión autenticada, no se confía en un `organization_id` arbitrario enviado por el navegador.

## 10.3 Sucursales

Campos sugeridos:

- ID.
- organization_id.
- nombre.
- código.
- tipo: sucursal / bodega / molino / otro.
- dirección.
- latitud.
- longitud.
- radio geográfico.
- zona horaria.
- teléfono.
- activo.

## 10.4 Almacenes

La base de datos debe soportar varios almacenes por sucursal aunque V1 muestre inicialmente un almacén principal.

Campos:

- ID.
- organization_id.
- branch_id.
- nombre.
- código.
- activo.

## 10.5 Cajas

- caja por sucursal;
- código;
- nombre;
- terminal;
- impresora configurada;
- estado.

---

# 11. Personalización / marca blanca

Desde Ajustes:

## 11.1 Empresa

- Nombre comercial.
- Razón social opcional.
- RFC opcional.
- Teléfono.
- Correo.
- Dirección.
- Logotipo.
- Moneda.
- Zona horaria.
- Formato de fecha.
- Mensaje de ticket.

## 11.2 Apariencia

- Color principal.
- Color secundario.
- Logo claro.
- Logo oscuro opcional.
- Ícono.
- Nombre visible de la app.

La UI utilizará variables CSS derivadas de esta configuración.

## 11.3 Ticket

Configuración:

- Mostrar logo.
- Mostrar nombre.
- Mostrar dirección.
- Mostrar teléfono.
- Mostrar cajero.
- Mostrar sucursal.
- Mostrar folio.
- Mostrar forma de pago.
- Mostrar cambio.
- Texto del pie.
- Número de copias.
- Impresión automática opcional.

---

# 12. Subdominios

Arquitectura preparada para:

```text
www.producto.com
cliente1.producto.com
pollofeliz.producto.com
molinosanjose.producto.com
api.producto.com
```

No crear un subdominio por sucursal.

El subdominio identifica a la organización.

La sucursal se resuelve por:

- selección del usuario;
- acceso autorizado;
- dispositivo;
- geolocalización opcional.

Mientras no exista el dominio definitivo, el frontend debe poder funcionar con selección de tenant posterior al login.

El URL del API debe vivir en variable de entorno.

---

# 13. Roles y permisos

## 13.1 Roles V1

### Superadministrador de plataforma
Uso de Geeksium.

Puede:

- crear organizaciones;
- administrar licencias;
- suspender/reactivar;
- definir límites;
- consultar estado técnico;
- administrar planes/features.

No debe editar ventas normales sin un proceso especial auditado.

### Administrador de organización
- configuración;
- sucursales;
- usuarios;
- inventario;
- ventas;
- reportes;
- traspasos;
- compras.

### Encargado de sucursal
- POS;
- inventario de su sucursal;
- compras;
- traspasos;
- reportes permitidos;
- corte de caja.

### Inventario/Bodega
- consultar inventario;
- entradas;
- salidas;
- conteos;
- compras;
- traspasos.

### Cajero
- POS;
- consultar productos;
- reimprimir tickets;
- ventas en espera;
- corte de su caja según permiso.

### Consulta/Reportes
- lectura;
- reportes;
- exportación según permiso.

## 13.2 Permisos granulares

Definir permisos como códigos:

```text
pos.sale.create
pos.sale.cancel
pos.sale.discount
pos.sale.reprint
inventory.view
inventory.entry.create
inventory.exit.create
inventory.adjust
inventory.count
transfer.create
transfer.dispatch
transfer.receive
transfer.payment
purchase.create
purchase.cancel
reports.view
reports.export
settings.organization
settings.branches
settings.users
settings.roles
```

V1 puede usar roles predefinidos, pero la arquitectura debe permitir roles personalizados después.

---

# 14. Licenciamiento

## 14.1 Objetivo

Controlar comercialmente el acceso sin depender de archivos locales fáciles de modificar.

## 14.2 Licencia por organización

Campos sugeridos:

- license_id.
- organization_id.
- plan_id.
- status.
- starts_at.
- expires_at.
- grace_until.
- max_branches.
- max_users.
- feature_flags.
- notes.
- updated_by.
- updated_at.

Estados:

- `ACTIVE`
- `GRACE`
- `READ_ONLY`
- `SUSPENDED`
- `CANCELLED`

## 14.3 Comportamiento

### ACTIVE
Uso normal.

### GRACE
Uso normal con avisos visibles.

### READ_ONLY
Puede:

- iniciar sesión;
- consultar información;
- exportar datos;
- revisar reportes.

No puede:

- crear ventas;
- registrar movimientos;
- crear compras;
- realizar traspasos.

### SUSPENDED
Acceso bloqueado salvo pantalla informativa y contacto.

## 14.4 Validación

La API es autoridad final.

No confiar en:

- LocalStorage;
- variables JS;
- fecha del equipo;
- flags del frontend.

El frontend solo refleja la decisión del servidor.

## 14.5 Offline y licencia

Para evitar detener el negocio por una caída de Internet:

- API puede emitir un `offline_license_grant` firmado.
- Vigencia sugerida inicial: 7 días.
- Guardar snapshot local.
- La PWA puede continuar ventas offline durante la ventana aprobada.
- Operaciones administrativas sensibles requieren servidor.
- Al reconectar, validar licencia inmediatamente.

La duración deberá ser configurable en el backend.

## 14.6 Administración de licencias

Pantalla Superadmin:

- organización;
- plan;
- estado;
- fecha inicio;
- fecha vencimiento;
- gracia;
- sucursales contratadas;
- usuarios;
- features;
- activar;
- suspender;
- reactivar;
- historial.

V1 puede manejar cobro/licencia manual. Integrar cobro recurrente queda para una versión posterior.

---

# 15. Módulo Inicio / Dashboard

## 15.1 Objetivo

Mostrar el estado operativo sin saturar.

## 15.2 Tarjetas V1

- Ventas de hoy.
- Número de ventas.
- Ticket promedio.
- Efectivo.
- Tarjeta.
- Transferencia.
- Inventario bajo.
- Compras de hoy.
- Traspasos pendientes.
- Saldo pendiente entre sucursales.
- Estado de sincronización.

## 15.3 Gráficas

V1:

- ventas por hora;
- ventas últimos 7 días;
- top productos;
- movimientos de inventario recientes.

Filtros:

- sucursal;
- periodo.

No hacer dashboards financieros complejos en V1.

---

# 16. Módulo POS

## 16.1 Objetivo

Registrar una venta en pocos pasos.

## 16.2 Layout desktop

```text
┌─────────────────────────────────────────────────────────────────┐
│ Logo | POS | Sucursal | Caja | Usuario | Sync | Estado licencia│
├────────────────────────────────────┬────────────────────────────┤
│ Buscar producto / código           │ VENTA ACTUAL               │
│ Categorías                         │                            │
│                                    │ Producto A   2.5 kg        │
│ [Producto] [Producto] [Producto]   │ Producto B   1 pieza       │
│ [Producto] [Producto] [Producto]   │                            │
│                                    │ Subtotal                   │
│                                    │ Descuento                  │
│                                    │ TOTAL                      │
│                                    │                            │
│                                    │ [COBRAR]                   │
└────────────────────────────────────┴────────────────────────────┘
```

## 16.3 Productos

Mostrar:

- imagen opcional;
- nombre;
- precio;
- unidad;
- disponibilidad;
- categoría.

Búsqueda por:

- nombre;
- SKU;
- código de barras.

## 16.4 Cantidad

Debe aceptar decimales.

Ejemplos:

- 0.250 kg.
- 0.500 kg.
- 1.250 kg.
- 2.000 piezas cuando aplique.

Input:

- numérico;
- `min > 0`;
- paso según unidad;
- impedir letras;
- validación adicional en API.

## 16.5 Atajos

Para productos por peso permitir atajos configurables:

- 250 g.
- 500 g.
- 1 kg.
- 2 kg.
- Otro.

## 16.6 Métodos de pago V1

Una sola forma de pago por venta:

- efectivo;
- tarjeta;
- transferencia;
- método personalizado.

Pago mixto queda fuera de V1.

## 16.7 Efectivo

Campos:

- total;
- recibido;
- cambio.

No permitir finalizar si recibido < total, salvo tipo de operación autorizado (p. ej. crédito futuro).

## 16.8 Descuentos

V1:

- descuento porcentual o monto;
- límite por rol;
- registrar quién lo aplicó;
- motivo opcional/obligatorio configurable.

## 16.9 Venta en espera

Permitir:

- guardar venta temporal;
- nombre/referencia;
- recuperar;
- cancelar.

## 16.10 Cancelación

No eliminar.

Generar estado `CANCELLED` y movimientos inversos.

Guardar:

- quién;
- cuándo;
- motivo;
- autorización si aplica.

## 16.11 Devoluciones

V1 mínima:

- devolución total o corrección mediante operación reversa controlada.

Devolución parcial compleja se puede mover a V2 si retrasa la entrega.

## 16.12 Folios

Cada venta tendrá:

- UUID técnico.
- Folio humano.

El folio debe poder generarse offline sin colisiones.

Formato sugerido:

`SUC-CAJA-AAAAMMDD-######`

Ejemplo:

`MID-C01-20260827-000183`

## 16.13 Resultado de venta

Después de cobrar:

- Venta exitosa.
- Folio.
- Total.
- Cambio.
- Botón Imprimir.
- Botón WhatsApp.
- Botón Correo/Compartir.
- Botón Nueva venta.

---

# 17. Impresión de tickets

## 17.1 V1

La PWA deberá generar una vista imprimible de 80 mm.

Flujo:

```text
PWA → window.print() → navegador/SO → driver → impresora EasyLine
```

CSS:

- `@media print`.
- ancho optimizado para 80 mm.
- ocultar navegación.
- tipografía legible.
- evitar fondos innecesarios.

## 17.2 Ticket

Contenido configurable:

- logo;
- empresa;
- sucursal;
- dirección;
- teléfono;
- folio;
- fecha/hora;
- cajero;
- productos;
- cantidad/unidad;
- precio;
- descuentos;
- total;
- forma de pago;
- recibido/cambio;
- mensaje;
- QR/enlace opcional.

## 17.3 V2 / complemento

`Geeksium POS Agent` en Windows:

- .NET.
- segundo plano.
- comunicación local autenticada.
- impresora predeterminada.
- impresión silenciosa.
- cajón de dinero.
- posibles básculas.
- respaldo SQLite opcional.

No es requisito para cerrar V1 si la impresión del SO funciona.

---

# 18. Catálogo de productos

## 18.1 Tipos

Campo `item_type`:

- producto terminado;
- materia prima;
- insumo;
- servicio;
- otro.

## 18.2 Campos

- ID.
- organización.
- categoría.
- SKU.
- código de barras opcional.
- nombre.
- descripción.
- imagen.
- unidad base.
- precio de venta.
- costo de referencia.
- controla existencia.
- stock mínimo.
- stock recomendado.
- activo.
- permite decimal.
- impuestos informativos si se requieren más adelante.

## 18.3 Eliminación

Un producto usado en transacciones no se elimina.

Se desactiva.

---

# 19. Unidades y conversiones

## 19.1 Requisito V1

Obligatorio.

Casos:

- reja → pollos;
- costal → kilogramos;
- caja → piezas;
- paquete → piezas;
- kilogramo → gramos.

## 19.2 Unidad base

Todo producto que controle inventario tiene una unidad base.

Ejemplo:

```text
Harina
Unidad base: kg
```

## 19.3 Presentaciones

Ejemplo:

```text
1 costal = 20 kg
1 medio costal = 10 kg
```

## 19.4 Conversión fija

Ejemplo:

```text
1 caja = 24 piezas
```

## 19.5 Conversión variable

Necesaria para negocios donde el empaque tiene peso real variable.

Ejemplo:

```text
Costal nominal: 20 kg
Peso real capturado: 19.850 kg
```

Por tanto, una presentación debe permitir:

- `FIXED`
- `VARIABLE`

En conversión variable el usuario captura equivalencia real durante la entrada/movimiento.

## 19.6 Regla de inventario

La existencia final se guarda/contabiliza en unidad base.

La presentación utilizada también se conserva para auditoría.

---

# 20. Módulo Inventario

## 20.1 Vista de existencias

Columnas:

- producto;
- SKU;
- sucursal;
- almacén;
- existencia;
- unidad;
- stock mínimo;
- stock recomendado;
- estado;
- última actualización.

Estados:

- OK.
- Bajo.
- Agotado.
- Negativo.
- Exceso opcional.

## 20.2 Acciones

- Entrada.
- Salida.
- Conteo.
- Ajuste.
- Traspaso.
- Historial.

## 20.3 Libro de movimientos

No almacenar solamente “existencia = X”.

Cada cambio genera un movimiento.

Ejemplo:

```text
+200 kg  Compra
- 50 kg  Venta
-  2 kg  Merma
+  1 kg  Ajuste de conteo
```

## 20.4 Movimiento

Campos sugeridos:

- movement_id.
- organization_id.
- branch_id.
- warehouse_id.
- product_id.
- movement_type.
- direction.
- quantity_base.
- base_unit_id.
- source_unit_id.
- source_quantity.
- conversion_factor.
- reference_type.
- reference_id.
- reason.
- user_id.
- occurred_at.
- created_at.
- offline_origin.
- sync_id.

## 20.5 Entradas

Tipos V1:

- compra;
- devolución;
- recepción de traspaso;
- ajuste positivo;
- inventario inicial;
- producción terminada reservada para futuro.

## 20.6 Salidas

Tipos V1:

- venta;
- merma;
- traspaso enviado;
- ajuste negativo;
- consumo interno;
- devolución a proveedor opcional.

## 20.7 Formulario de entrada

Campos:

- tipo;
- sucursal;
- almacén;
- producto;
- presentación/unidad;
- cantidad;
- equivalencia si variable;
- proveedor si compra;
- costo;
- documento/referencia;
- fecha;
- notas.

Mostrar antes de confirmar:

```text
Existencia actual
Movimiento
Existencia resultante
```

## 20.8 Formulario de salida

Campos:

- motivo;
- producto;
- cantidad;
- unidad;
- notas;
- existencia actual;
- resultante.

Validar stock salvo política configurada.

## 20.9 Merma

Debe ser un tipo propio para reportarla.

Campos:

- cantidad;
- motivo;
- comentario;
- evidencia/foto futura;
- usuario.

---

# 21. Conteo físico

## 21.1 Objetivo

Comparar sistema vs realidad.

## 21.2 Flujo

1. Crear conteo.
2. Seleccionar sucursal/almacén.
3. Capturar existencias físicas.
4. Mostrar diferencias.
5. Confirmar.
6. Crear ajustes compensatorios.
7. Registrar auditoría.

Ejemplo:

```text
Sistema: 152.500 kg
Físico: 149.000 kg
Diferencia: -3.500 kg
```

Nunca cambiar el balance sin movimiento de ajuste.

---

# 22. Stock mínimo

Cada producto/sucursal puede manejar:

- mínimo;
- recomendado;
- máximo futuro.

V1:

- indicador visual;
- reporte de bajo stock;
- dashboard;
- sugerencia de compra informativa.

No crear compras automáticas.

---

# 23. Compras

## 23.1 Alcance V1

Registro operativo de compras.

No implementar cuentas por pagar completas.

## 23.2 Proveedores

Campos:

- nombre;
- RFC opcional;
- teléfono;
- correo;
- contacto;
- notas;
- activo.

## 23.3 Compra

Cabecera:

- proveedor;
- sucursal/almacén receptor;
- fecha;
- referencia;
- subtotal;
- total;
- método/estado de pago opcional;
- notas.

Líneas:

- producto;
- cantidad;
- unidad/presentación;
- equivalencia;
- costo unitario;
- total.

Confirmar compra crea entradas de inventario.

Cancelar compra confirmada crea reversa, no borrado.

## 23.4 Operaciones

La pantalla Operaciones tendrá pestañas:

- Ventas.
- Compras.

Con búsqueda, filtros y detalle.

---

# 24. Traspasos de inventario

## 24.1 Requisito V1

Obligatorio.

## 24.2 Flujo normal

Estados:

1. `DRAFT`
2. `REQUESTED`
3. `APPROVED`
4. `DISPATCHED`
5. `RECEIVED`
6. `CANCELLED`

Una implementación más simple puede iniciar en `DISPATCHED` para usuarios con permiso suficiente.

## 24.3 Efecto en stock

Al despachar:

- disminuye origen;
- mercancía puede quedar “en tránsito”.

Al recibir:

- aumenta destino.

Registrar diferencias de recepción.

## 24.4 Traspaso sin cargo

Solo movimiento físico.

## 24.5 Traspaso con cargo / venta interna

Caso prioritario para Pollo Feliz.

La bodega entrega mercancía a una sucursal y la sucursal puede pagar posteriormente.

El sistema debe manejar:

- precio/costo interno;
- monto total;
- monto pagado;
- saldo;
- fecha de vencimiento opcional;
- estado financiero;
- pagos parciales;
- historial.

Estados financieros:

- `UNPAID`
- `PARTIAL`
- `PAID`
- `OVERDUE`

## 24.6 Importante

Esto NO pretende ser contabilidad formal.

Es un **control operativo de saldo entre sucursales**.

## 24.7 Pago interno

Campos:

- traspaso;
- origen;
- destino;
- importe;
- fecha;
- método;
- referencia;
- notas;
- usuario.

## 24.8 Reportes internos

- saldo por sucursal;
- antigüedad;
- traspasos pendientes de recibir;
- traspasos pendientes de pago;
- pagos recibidos;
- historial de cuenta interna.

Esta función es uno de los diferenciadores de V1.

---

# 25. Corte de caja

## 25.1 Apertura

- caja;
- usuario;
- fecha/hora;
- fondo inicial.

## 25.2 Durante turno

Registrar:

- ventas;
- entradas de efectivo manuales;
- retiros;
- cancelaciones.

## 25.3 Cierre

Mostrar:

- fondo inicial;
- ventas efectivo;
- ventas tarjeta;
- transferencias;
- entradas;
- retiros;
- efectivo esperado.

Usuario captura:

- efectivo contado.

Sistema calcula:

- diferencia.

Registrar cierre inmutable.

---

# 26. Reportería

## 26.1 Principio

Reportes deben responder preguntas operativas, no solo mostrar tablas.

## 26.2 Filtros comunes

- fecha desde;
- fecha hasta;
- hoy;
- ayer;
- semana;
- mes;
- sucursal;
- almacén;
- usuario;
- producto;
- categoría;
- proveedor;
- forma de pago.

## 26.3 Reportes V1

### Ventas
- valor vendido por día;
- número de ventas;
- ticket promedio;
- ventas por producto;
- ventas por categoría;
- ventas por sucursal;
- ventas por cajero;
- ventas por método de pago;
- descuentos;
- cancelaciones.

### Compras
- compras por fecha;
- compras por proveedor;
- compras por producto;
- costos.

### Inventario
- existencia actual;
- inventario valorizado;
- bajo stock;
- entradas;
- salidas;
- mermas;
- ajustes;
- movimientos por producto.

### Traspasos
- enviados;
- recibidos;
- en tránsito;
- pendientes;
- saldos internos;
- pagos internos.

### Caja
- cortes;
- diferencias;
- movimientos.

## 26.4 Exportación

- CSV.
- XLSX.
- PDF.

---

# 27. Compartir por WhatsApp y correo

## 27.1 Venta individual

Después de vender:

- imprimir;
- compartir resumen;
- WhatsApp;
- correo;
- copiar enlace.

## 27.2 Enlace de comprobante

Preferido:

```text
https://dominio.com/r/<token>
```

El token debe:

- ser impredecible;
- tener expiración;
- permitir solo lectura;
- no revelar IDs internos;
- poder revocarse.

## 27.3 WhatsApp

Generar texto URL-encoded con:

- empresa;
- folio;
- total;
- fecha;
- enlace.

No almacenar credenciales de WhatsApp.

## 27.4 Web Share API

Cuando esté disponible:

- mostrar botón Compartir;
- dejar que el SO ofrezca WhatsApp, correo u otras aplicaciones.

Fallback:

- botón WhatsApp;
- copiar enlace;
- descargar PDF.

## 27.5 Correo

V1 debe soportar por lo menos una de estas dos opciones:

1. API + SMTP para envío real.
2. `mailto:` con asunto/cuerpo y reporte enlazado.

Preferida para producto comercial: API + SMTP configurable.

## 27.6 “Ventas de hoy”

En Reportes:

`Compartir ventas de hoy`

Generar:

- resumen;
- PDF;
- XLSX;
- enlace seguro.

Acciones:

- Correo.
- WhatsApp.
- Compartir.
- Descargar.

---

# 28. Geolocalización

## 28.1 Objetivo

Opcionalmente impedir o advertir ventas realizadas fuera de la sucursal.

## 28.2 Configuración

Por organización/sucursal:

- desactivada;
- solo registrar;
- advertir;
- bloquear.

Campos:

- latitud;
- longitud;
- radio permitido en metros.

## 28.3 Venta

Cuando está habilitada:

1. solicitar permiso de ubicación;
2. obtener coordenadas;
3. obtener precisión;
4. comparar con sucursal;
5. aplicar política.

Guardar:

- latitude;
- longitude;
- accuracy;
- captured_at;
- result.

## 28.4 Excepciones

- permiso denegado;
- GPS no disponible;
- ubicación imprecisa;
- dispositivo fijo;
- autorización de encargado.

Registrar override.

## 28.5 Privacidad

No solicitar geolocalización para simplemente consultar reportes si la función no lo requiere.

---

# 29. PWA

## 29.1 Requisitos

- instalable;
- manifest;
- íconos;
- service worker;
- caché de app shell;
- offline fallback;
- actualización controlada;
- responsive.

## 29.2 Actualizaciones

No recargar automáticamente durante una venta.

Mostrar:

`Hay una nueva versión disponible. Actualizar cuando termine la operación.`

---

# 30. Offline e IndexedDB

## 30.1 Fuente de verdad

Servidor PostgreSQL = fuente de verdad central.

IndexedDB = caché operativa y cola local.

No intentar mantener dos bases espejo bidireccionales permanentes.

## 30.2 Qué guardar localmente

- configuración mínima;
- usuario/rol para sesión offline autorizada;
- sucursal;
- catálogo de productos;
- precios;
- unidades;
- existencias conocidas;
- ventas offline;
- líneas;
- cola de sincronización;
- estado de sync;
- licencia offline firmada;
- versión de catálogo.

Nunca guardar:

- contraseña en texto plano;
- service keys;
- credenciales de BD;
- datos completos de tarjetas.

## 30.3 Flujo de venta

1. Crear UUID local.
2. Guardar venta en IndexedDB.
3. Estado `PENDING_SYNC`.
4. Imprimir ticket local.
5. Si hay Internet, enviar inmediatamente.
6. API procesa idempotentemente.
7. Respuesta exitosa.
8. Marcar `SYNCED`.
9. Si falla, mantener pendiente.

## 30.4 Cola

Estados:

- pending;
- syncing;
- synced;
- error;
- requires_review.

## 30.5 Idempotencia

El mismo UUID/idempotency key enviado varias veces debe generar una sola venta.

## 30.6 Conflicto de stock

V1 debe priorizar no perder una venta ya cobrada.

Regla sugerida:

- online: aplicar política normal de stock;
- offline: utilizar última existencia conocida;
- al sincronizar, aceptar operación idempotente;
- si provoca stock negativo por concurrencia, crear alerta de reconciliación.

## 30.7 Alcance offline V1

Obligatorio:

- abrir app previamente instalada;
- consultar catálogo cacheado;
- crear venta;
- imprimir ticket;
- poner venta en cola;
- sincronizar.

Preferiblemente online:

- compras;
- conteos;
- ajustes;
- traspasos;
- configuración;
- usuarios;
- licencias.

Esto reduce conflictos multi-sucursal.

## 30.8 Indicador visible

Topbar:

- En línea.
- Sin conexión.
- X operaciones pendientes.
- Error de sincronización.

No ocultar el estado.

---

# 31. File System Access API

## 31.1 Rol

Complemento opcional, no dependencia.

## 31.2 Cuando exista soporte

En navegadores Chromium compatibles:

- permitir seleccionar carpeta de respaldos;
- exportar snapshots;
- guardar copias de operaciones pendientes;
- exportar reportes automáticamente si el usuario lo configura.

## 31.3 Cuando no exista soporte

La aplicación continúa con IndexedDB.

## 31.4 No usar como fuente de verdad

Nunca hacer que la aplicación falle porque el usuario revocó acceso a carpeta.

## 31.5 Futuro Windows Agent

Cuando se implemente el agente:

- SQLite local;
- impresión;
- respaldo;
- sincronización reforzada;
- dispositivos.

---

# 32. Seguridad del frontend / DevTools

## 32.1 Realidad técnica

No es posible ocultar completamente el código JavaScript que debe ejecutar un navegador.

## 32.2 Medidas V1

- build de producción;
- minificación;
- sourcemaps desactivados;
- tree shaking;
- nombres/archivos compilados;
- opcional ofuscación adicional si no rompe rendimiento/debug;
- no publicar secretos;
- lógica crítica en API;
- validaciones repetidas en servidor.

## 32.3 Regla

> Cualquier regla que, si fuera alterada por el usuario, permita robar datos, modificar inventario, evadir licencia o crear ventas inválidas debe validarse en servidor.

---

# 33. API

## 33.1 Raíz

No requiere HTML.

`GET /`

Respuesta simple:

```json
{
  "service": "Geeksium POS API",
  "status": "ok"
}
```

## 33.2 Salud

`GET /health`

Para monitoreo.

## 33.3 Prefijo

`/api/v1`

## 33.4 Endpoints sugeridos

### Auth
```text
POST /auth/login
POST /auth/refresh
POST /auth/logout
GET  /auth/me
POST /auth/forgot-password
POST /auth/reset-password
```

### Configuración
```text
GET /tenant/config
GET /branches
GET /warehouses
```

### Productos
```text
GET    /products
POST   /products
GET    /products/:id
PATCH  /products/:id
POST   /products/import
GET    /products/export
```

### Inventario
```text
GET  /inventory/balances
GET  /inventory/movements
POST /inventory/entries
POST /inventory/exits
POST /inventory/adjustments
POST /inventory/counts
```

### Ventas
```text
GET  /sales
POST /sales
GET  /sales/:id
POST /sales/:id/cancel
POST /sales/:id/share
```

### Compras
```text
GET  /purchases
POST /purchases
GET  /purchases/:id
POST /purchases/:id/cancel
```

### Traspasos
```text
GET  /transfers
POST /transfers
GET  /transfers/:id
POST /transfers/:id/approve
POST /transfers/:id/dispatch
POST /transfers/:id/receive
POST /transfers/:id/cancel
POST /transfers/:id/payments
GET  /interbranch-balances
```

### Caja
```text
POST /cash-sessions/open
POST /cash-sessions/:id/movements
POST /cash-sessions/:id/close
GET  /cash-sessions
```

### Reportes
```text
GET /reports/dashboard
GET /reports/sales
GET /reports/purchases
GET /reports/inventory
GET /reports/movements
GET /reports/transfers
GET /reports/cash
POST /reports/share
```

### Sync
```text
POST /sync/push
GET  /sync/pull
GET  /sync/status
```

### Licencia
```text
GET /license/status
```

### Plataforma
```text
GET   /platform/organizations
POST  /platform/organizations
PATCH /platform/organizations/:id
PATCH /platform/organizations/:id/license
```

---

# 34. Reglas de API

1. No confiar en IDs de tenant enviados por frontend.
2. Validar permisos en cada operación.
3. Validar licencia para operaciones de escritura.
4. Usar transacciones PostgreSQL para operaciones que cambian varias tablas.
5. Usar idempotency key para:
   - ventas;
   - compras;
   - movimientos;
   - traspasos;
   - pagos;
   - sincronización.
6. Nunca devolver hashes ni secretos.
7. Paginar listados.
8. Limitar exportaciones grandes.
9. Registrar auditoría.
10. Manejar códigos HTTP consistentes.
11. No mostrar stack trace en producción.

---

# 35. Modelo de datos sugerido

## 35.1 Plataforma

### organizations
- id
- name
- slug
- status
- created_at
- updated_at

### organization_settings
- organization_id
- logo_url
- primary_color
- secondary_color
- timezone
- currency
- ticket_settings
- geolocation_policy

### plans
- id
- code
- name

### licenses
- id
- organization_id
- plan_id
- status
- starts_at
- expires_at
- grace_until
- max_branches
- max_users
- feature_flags

## 35.2 Ubicaciones

### branches
- id
- organization_id
- code
- name
- type
- address
- latitude
- longitude
- radius_meters
- active

### warehouses
- id
- organization_id
- branch_id
- code
- name
- active

### cash_registers
- id
- organization_id
- branch_id
- code
- name
- active

## 35.3 Usuarios

### users
- id
- organization_id
- email
- password_hash
- name
- status
- created_at

### roles
- id
- organization_id nullable para roles sistema
- code
- name

### user_roles
- user_id
- role_id

### user_branch_access
- user_id
- branch_id

### sessions
- id
- user_id
- refresh_token_hash
- expires_at
- revoked_at
- device_info

## 35.4 Catálogos

### categories
### units
### products
### product_units
### suppliers
### customers
### payment_methods

## 35.5 Inventario

### inventory_balances
- organization_id
- warehouse_id
- product_id
- quantity

### inventory_movements
- id
- organization_id
- branch_id
- warehouse_id
- product_id
- movement_type
- direction
- quantity_base
- source_quantity
- source_unit_id
- conversion_factor
- reference_type
- reference_id
- reason
- user_id
- occurred_at

### inventory_counts
### inventory_count_lines

## 35.6 Ventas

### sales
- id
- organization_id
- branch_id
- cash_register_id
- user_id
- customer_id nullable
- folio
- status
- subtotal
- discount
- total
- payment_method_id
- amount_received
- change_amount
- sale_latitude
- sale_longitude
- sale_location_accuracy
- offline_origin
- created_at

### sale_items
- id
- sale_id
- product_id
- quantity
- unit_id
- quantity_base
- unit_price
- discount
- total

## 35.7 Compras

### purchases
### purchase_items

## 35.8 Traspasos

### transfers
- id
- organization_id
- source_branch_id
- source_warehouse_id
- destination_branch_id
- destination_warehouse_id
- transfer_type
- logistics_status
- financial_status
- total_amount
- paid_amount
- due_amount
- created_by
- dispatched_at
- received_at

### transfer_items
- transfer_id
- product_id
- quantity
- unit_id
- quantity_base
- internal_unit_price
- total

### interbranch_payments
- id
- transfer_id
- amount
- payment_method
- reference
- paid_at
- user_id

## 35.9 Caja

### cash_sessions
### cash_movements

## 35.10 Auditoría

### audit_logs
- id
- organization_id
- branch_id
- user_id
- action
- entity
- entity_id
- before_json
- after_json
- ip
- user_agent
- request_id
- created_at

## 35.11 Compartir

### shared_links
- id
- organization_id
- token_hash
- resource_type
- resource_id
- expires_at
- revoked_at

---

# 36. Transacciones e integridad

## 36.1 Venta

Una transacción de venta en servidor deberá:

1. validar usuario;
2. validar sucursal;
3. validar licencia;
4. validar productos;
5. validar cantidades;
6. calcular total;
7. guardar venta;
8. guardar líneas;
9. guardar pago;
10. generar movimientos de inventario;
11. actualizar balances;
12. escribir auditoría;
13. confirmar transacción.

Si falla un punto crítico, hacer rollback.

## 36.2 Compra

Compra confirmada:

- crea compra;
- líneas;
- movimientos de entrada;
- actualiza balance;
- auditoría.

## 36.3 Traspaso

Despacho:

- validar stock origen;
- crear salida;
- marcar tránsito.

Recepción:

- crear entrada;
- actualizar estado.

Traspaso con cargo:

- generar saldo interno;
- no requerir pago inmediato.

---

# 37. Validación de formularios

Todos los inputs tendrán validación frontend + backend.

## 37.1 Cantidad

- numérico;
- decimal;
- > 0;
- máximo razonable;
- precisión configurada;
- no aceptar letras.

## 37.2 Precio

- decimal;
- >= 0;
- 2 decimales visuales;
- servidor recalcula.

## 37.3 Email

- formato válido;
- normalizar minúsculas.

## 37.4 Fechas

- validación;
- servidor define `created_at`;
- no confiar únicamente en reloj del cliente.

## 37.5 Selects

No permitir IDs que el usuario no tenga permiso de usar.

## 37.6 Mensajes

Errores en español claro.

Ejemplo:

`La cantidad debe ser mayor que cero.`

No:

`Invalid payload 422`.

---

# 38. Responsive

## 38.1 Desktop

Objetivo primario:

- 1366×768.
- 1920×1080.

Sidebar persistente o colapsable.

## 38.2 Tablet

- 8–13".
- botones táctiles.
- POS plenamente operativo.
- sidebar colapsable.

## 38.3 Celular

Prioridad:

- dashboard;
- inventario;
- reportes;
- operaciones;
- consulta.

POS funcional con layout simplificado.

Navegación móvil sugerida:

- Inicio.
- POS.
- Inventario.
- Reportes.
- Más.

---

# 39. Diseño visual

Objetivo:

- empresarial;
- limpio;
- rápido;
- moderno;
- sin exceso de efectos.

Usar:

- tarjetas;
- tablas;
- chips de estado;
- drawers/modales solo cuando ayuden;
- iconografía consistente;
- skeletons de carga;
- toasts;
- confirmación para acciones críticas.

Evitar:

- animaciones innecesarias;
- fondos pesados;
- gradientes excesivos;
- interfaces “marketing” dentro del POS.

---

# 40. Accesibilidad y usabilidad

- labels visibles;
- focus states;
- teclado;
- contraste suficiente;
- tamaños táctiles adecuados;
- tablas navegables;
- no depender únicamente del color;
- confirmación clara de éxito/error;
- evitar doble envío.

Atajos futuros:

- F2 buscar.
- F4 cobrar.
- Esc cerrar.
- etc.

No son bloqueantes V1.

---

# 41. Importación / exportación de inventario

## 41.1 Importar

V1 recomendado para onboarding.

Formatos:

- CSV.
- XLSX.

Previsualización antes de guardar.

Columnas sugeridas:

- SKU.
- Nombre.
- Categoría.
- Unidad base.
- Presentación.
- Conversión.
- Precio.
- Costo.
- Stock inicial.
- Stock mínimo.

## 41.2 Validación

Mostrar:

- filas correctas;
- errores;
- duplicados;
- campos faltantes.

No importar parcialmente sin que el usuario conozca el resultado.

## 41.3 Exportar

- catálogo;
- inventario;
- existencias.

---

# 42. Códigos de barras

V1 recomendado.

La mayoría de lectores USB funcionan como teclado.

Por tanto:

- input de búsqueda puede recibir código;
- si coincide exactamente, agregar producto;
- no requiere integración de hardware compleja.

Creación/impresión de etiquetas queda V2.

---

# 43. Báscula

No integrar hardware específico en V1.

Preparar arquitectura.

Futuro:

- Windows Agent;
- serial/USB;
- peso leído;
- producto seleccionado;
- validación estable.

Para V1 el peso se captura manualmente.

---

# 44. Auditoría

Auditar como mínimo:

- login;
- logout;
- intentos fallidos relevantes;
- ventas;
- cancelaciones;
- descuentos;
- entradas/salidas;
- ajustes;
- conteos;
- compras;
- traspasos;
- recepción;
- pagos internos;
- cambios de usuario;
- cambios de rol;
- cambios de configuración;
- cambios de licencia.

---

# 45. Backup y recuperación

## 45.1 Servidor

- backups automáticos del PostgreSQL según plan/proveedor;
- exportaciones verificables;
- migraciones versionadas.

## 45.2 Aplicación

No generar archivos por cada transacción en el hosting.

El número de inodos del hosting no corresponde al número de consultas API.

## 45.3 Local

IndexedDB mantiene pendientes.

File System Access puede guardar backup adicional donde exista soporte.

---

# 46. Migración futura a AWS

## 46.1 Requisito arquitectónico

La migración no debe requerir reescribir componentes Vue.

## 46.2 Estrategia

Inicial:

```text
Vue → api.geeksium.com → PostgreSQL Supabase
```

Futuro:

```text
Vue → API → AWS RDS/Aurora PostgreSQL
```

## 46.3 Reglas de portabilidad

- PostgreSQL estándar.
- Migraciones propias.
- Evitar lógica crítica en Supabase Edge Functions.
- Evitar llamadas `supabase.from(...)` desde componentes Vue.
- No usar Supabase Auth como identidad interna obligatoria.
- Usar tabla propia `users`.
- Abstraer Storage.
- Abstraer proveedor de email.
- Variables de entorno.
- No usar extensiones PostgreSQL exóticas sin necesidad.
- Documentar extensiones utilizadas.

## 46.4 Migración

PostgreSQL permite dump/restore.

AWS soporta migración PostgreSQL hacia RDS/Aurora mediante herramientas nativas o DMS.

Antes de migrar:

- validar versión;
- extensiones;
- tamaño;
- índices;
- backups;
- pruebas de restauración.

---

# 47. Observabilidad

V1:

- logs API;
- request ID;
- errores centralizados;
- logs de auth;
- estado de sync;
- health endpoint.

V2:

- APM;
- métricas;
- tracing;
- alertas.

---

# 48. Requerimientos de rendimiento

Objetivos iniciales:

- interacción POS local inmediata;
- búsquedas de producto percibidas como instantáneas;
- no recargar página por operación;
- paginar listados;
- índices por organización/sucursal/fecha;
- dashboard con consultas agregadas;
- evitar recalcular reportes enormes por cada render.

Cuando el volumen crezca:

- caché;
- vistas/materialized views;
- reportes preagregados;
- workers.

No optimizar prematuramente.

---

# 49. Benchmark funcional — transcripción del POS analizado

Del video/transcripción suministrada se rescatan:

| Idea observada | Decisión Geeksium POS |
|---|---|
| Sistema genérico | Sí |
| Uso en distintos giros | Sí |
| Interfaz gráfica con productos | Sí |
| Mesas | No V1 |
| Servicio rápido | Sí |
| Cancelaciones | Sí |
| Descuentos | Sí |
| Dashboard | Sí |
| Indicadores | Sí |
| 20–25 reportes | No fijar cantidad; priorizar reportes útiles |
| Excel | Sí |
| PDF | Sí |
| Tablet | Sí, prioridad |
| Celular | Sí, responsive |
| Cajón de dinero | Posterior con Agent |
| Impresora | Sí |
| Recibo por correo | Sí |
| Control de caja | Sí |

---

# 50. Benchmark funcional — PulPOS

La lista suministrada se evaluó elemento por elemento.

Leyenda:

- **V1**: incluir.
- **V2**: preparar o agregar después.
- **N/A**: no prioritario para producto inicial.

| Función de referencia | Geeksium POS |
|---|---|
| Usuarios | V1 |
| Productos y ventas ilimitados | V1, sujeto a límites técnicos/licencia |
| Facturas por ventas | V2; CFDI fuera de V1 |
| Sucursales | V1 |
| Multisucursal | V1 |
| Almacenes | V1 en modelo; UI básica |
| Cajas registradoras | V1 |
| App móvil | PWA responsive V1, no app nativa |
| Gestión de existencias | V1 |
| Importar inventario Excel | V1 |
| Descargar inventario Excel | V1 |
| Variantes | V2 |
| Lotes y caducidades | V2 |
| Recetas médicas | N/A |
| Creación de etiquetas | V2 |
| Fotos de productos | V1 |
| Kits de productos | V2 |
| Traspasos de inventario | V1 |
| Entradas y salidas | V1 |
| Productos apartados | V2 |
| Conteo de inventario | V1 |
| Punto de venta | V1 |
| Elegir métodos de pago | V1 |
| Descuentos | V1 |
| Clientes | V1 básico |
| Devoluciones | V1 básica / V2 avanzada |
| Recargas y servicios | N/A inicial |
| Venta a crédito | V2 para cliente externo |
| Ventas en espera | V1 |
| Múltiples listas de precios | V2 |
| Precios personalizados | V2 |
| Cotizaciones | V2 |
| Devoluciones parciales | V2 |
| Promociones | V2 |
| Monedero electrónico | V2 |
| Posponer entrega | V2 |
| Dirección de entrega | V2 |
| Creación de pedidos | V2 |
| Métodos de pago personalizados | V1 |
| Abono de múltiples deudas | V2 |
| Atribuir ventas a vendedores | V2; V1 atribuye al cajero |
| Límite de crédito personalizado | V2 |
| Cuentas por cobrar | V2 cliente externo; saldo intersucursal sí V1 |
| Listas de precios por cliente | V2 |
| Precios por cantidad | V2 |
| Facturas globales | V2 |
| Factura público general | V2 |
| Cancelación de facturas | V2 |
| Retención IVA/ISR | V2 |
| Notas de crédito | V2 |
| Complementos de pago | V2 |
| Autofacturas | V2 |
| Tienda en línea | V2/V3 |
| Mercado Pago | V2 |
| Comisión Mercado Pago | N/A V1 |
| Compras | V1 |
| Proveedores | V1 |
| Importar compras XML | V2 |
| Gastos | V2 |
| Pagos a proveedores | V2 |
| Cuentas por pagar | V2 |
| Reporte valor vendido por día | V1 |
| Reportes de ventas | V1 |
| Reportes de compras | V1 |
| Reportes de inventario | V1 |
| Reportes de entradas/salidas | V1 |
| Reportes de movimientos de dinero | V1 básico |
| Reportes financieros | V2 |
| Cortes de caja | V1 |
| Permisos básicos | V1 |
| Permisos avanzados | V1 base / V2 personalizados |
| Impresora de tickets | V1 |
| Báscula | V2 |
| Cajón de dinero | V2 con Agent |
| Lector de códigos de barras | V1 por teclado |
| Marca blanca | V1 |
| Fabricación | V2, modelo preparado |
| Conciliación bancaria | V2/V3 |
| Catálogo Plus / mayoreo especializado | V2 |

---

# 51. Producción / fabricación futura

El molino eventualmente puede requerir:

```text
Materia prima → proceso → producto terminado
```

Ejemplo:

- harina;
- agua;
- gas;
- bolsas;
- tortilla.

No implementar motor de fabricación completo en V1.

Sí preparar:

- `item_type`;
- unidades;
- movimientos;
- referencias;
- campos que permitan posteriormente recetas/BOM.

V2:

- recetas;
- lotes de producción;
- consumo automático;
- rendimiento;
- merma;
- costo de producción.

---

# 52. Lotes y caducidades futuras

Relevante para alimentos, pero no debe retrasar V1.

Preparar sin implementar UI completa.

V2:

- lote;
- fecha fabricación;
- caducidad;
- FEFO;
- trazabilidad.

---

# 53. Funciones V1 aprobadas

## Plataforma
- Landing.
- Login propio.
- Recuperación de contraseña.
- Multiempresa.
- Multisucursal.
- Almacenes.
- Cajas.
- Usuarios.
- Roles.
- Permisos.
- Licenciamiento.
- Marca blanca.
- Auditoría.

## POS
- Catálogo.
- Búsqueda.
- Código de barras.
- Cantidades decimales.
- Unidades.
- Conversiones.
- Carrito.
- Un método de pago por venta.
- Efectivo/tarjeta/transferencia/personalizado.
- Cambio.
- Descuento.
- Venta en espera.
- Cancelación/reversa.
- Ticket 80 mm.
- Reimpresión.
- Compartir.
- Offline.

## Inventario
- Existencias.
- Entradas.
- Salidas.
- Compras.
- Proveedores.
- Merma.
- Ajustes.
- Conteo.
- Stock mínimo.
- Historial.
- Importar/exportar.
- Traspasos.
- Traspasos con cargo.
- Saldo intersucursal.
- Pagos parciales intersucursal.

## Reportes
- Dashboard.
- Ventas.
- Compras.
- Inventario.
- Movimientos.
- Traspasos.
- Saldos internos.
- Caja.
- PDF.
- XLSX/CSV.
- Compartir por correo/WhatsApp.

## PWA
- Installable.
- Responsive.
- Service worker.
- IndexedDB.
- Cola.
- Sincronización.
- Indicador online/offline.
- File System Access opcional.

---

# 54. Funciones expresamente fuera de V1

No incorporar sin una razón bloqueante:

- CFDI.
- SAT.
- factura global.
- notas de crédito fiscales.
- complementos de pago.
- retenciones.
- venta a crédito para clientes externos.
- cuentas por cobrar completas.
- cuentas por pagar completas.
- gastos financieros.
- conciliación bancaria.
- ecommerce.
- Mercado Pago.
- promociones complejas.
- monedero.
- puntos.
- múltiples listas de precio.
- precios por cliente.
- precios por volumen.
- pedidos/logística.
- apartado.
- lotes/caducidad completos.
- fabricación completa.
- app móvil nativa.
- báscula integrada.
- cajón integrado.
- impresión silenciosa mediante agente.
- custom roles visuales avanzados.
- analítica financiera profunda.
- IA.

---

# 55. Estados vacíos y errores

Cada módulo debe tener:

- loading;
- empty;
- error;
- offline;
- permission denied.

Ejemplo Inventario sin productos:

`Aún no hay productos. Crea uno o importa tu inventario.`

No mostrar tabla vacía sin orientación.

---

# 56. Confirmaciones críticas

Solicitar confirmación para:

- cancelar venta;
- ajuste manual;
- cerrar caja;
- despachar traspaso;
- recibir con diferencia;
- registrar pago interno;
- suspender organización;
- cambiar licencia.

No solicitar confirmación para acciones reversibles simples como filtros.

---

# 57. Notificaciones

Usar toast para:

- guardado correcto;
- sincronización;
- error de red;
- impresión;
- exportación.

Usar modal para:

- acciones destructivas;
- diferencias de inventario;
- cancelaciones;
- licencia.

---

# 58. Sincronización visual

Indicador:

```text
● En línea
✓ Todo sincronizado
```

Offline:

```text
● Sin conexión
3 operaciones pendientes
```

Error:

```text
⚠ 1 operación requiere revisión
```

Pantalla diagnóstica:

- última sincronización;
- pendientes;
- errores;
- reintentar;
- exportar respaldo local.

---

# 59. Privacidad / almacenamiento esencial

No mezclar funcionamiento offline con analítica publicitaria.

Almacenamiento técnico esencial:

- IndexedDB;
- service worker;
- sesión;
- preferencias necesarias.

Si se añade analítica en futuro, manejarla de forma separada según política aplicable.

---

# 60. Criterios de aceptación — autenticación

- Usuario válido entra.
- Usuario inválido no entra.
- Usuario inactivo no entra.
- Organización suspendida no crea operaciones.
- Rol restringido no accede a rutas prohibidas.
- Tokens expiran y se renuevan.
- Logout revoca sesión.
- Ningún secreto aparece en bundle.
- Intentos repetidos se limitan.

---

# 61. Criterios de aceptación — multiempresa

Prueba crítica:

1. Crear Org A y Org B.
2. Crear productos/ventas en ambas.
3. Usuario A intenta consultar ID de B.
4. API responde 403/404.
5. Ningún dato de B aparece.

Esto debe formar parte de pruebas automatizadas.

---

# 62. Criterios de aceptación — POS

- Agregar producto.
- Cambiar cantidad decimal.
- Usar conversión.
- Calcular total.
- Cobrar.
- Calcular cambio.
- Generar movimiento.
- Imprimir.
- Consultar venta.
- Cancelar con permiso.
- Restituir inventario.
- No duplicar al doble clic.

---

# 63. Criterios de aceptación — inventario

- Entrada aumenta.
- Salida disminuye.
- Movimiento queda registrado.
- Conteo crea ajuste.
- Merma aparece en reporte.
- Conversión se calcula.
- Historial explica balance.

---

# 64. Criterios de aceptación — traspaso con saldo

Caso:

1. Bodega tiene 100 unidades.
2. Envía 20 a sucursal.
3. Se despacha.
4. Origen queda 80.
5. Destino recibe 20.
6. Cargo interno $1,000.
7. Sucursal paga $400.
8. Saldo queda $600.
9. Reporte muestra $600 pendiente.
10. Segundo pago $600.
11. Estado pasa a PAID.

Todo debe ser auditable.

---

# 65. Criterios de aceptación — offline

1. Usuario inicia online.
2. Catálogo sincroniza.
3. Se desconecta Internet.
4. PWA sigue abierta.
5. Realiza venta.
6. Ticket se genera.
7. Venta queda `PENDING_SYNC`.
8. Cierra/reabre PWA si caché está disponible.
9. Regresa Internet.
10. Venta se envía.
11. API reconoce UUID.
12. Venta se guarda una sola vez.
13. Estado local cambia a `SYNCED`.

---

# 66. Criterios de aceptación — licencia

1. ACTIVE → ventas permitidas.
2. GRACE → ventas + aviso.
3. READ_ONLY → lectura/exportación; sin nuevas ventas.
4. SUSPENDED → acceso restringido.
5. Cambio en servidor se refleja al reconectar.
6. Manipular LocalStorage no reactiva licencia.
7. Offline grant expirado no se renueva sin servidor.

---

# 67. Criterios de aceptación — impresión

- Ticket cabe en 80 mm.
- No imprime navegación.
- Muestra folio.
- Muestra productos.
- Muestra total.
- Muestra método.
- Efectivo muestra cambio.
- Reimpresión identifica que es copia si se desea.
- Chrome/Edge pueden usar driver del SO.

---

# 68. Criterios de aceptación — responsive

Desktop:
- POS sin scroll horizontal.
- tabla usable.

Tablet:
- botones táctiles.
- POS completo.

Celular:
- dashboard legible;
- tablas adaptadas;
- filtros en drawer;
- POS utilizable aunque no sea experiencia primaria.

---

# 69. Plan de desarrollo recomendado

## Fase 0 — Fundación
- estructura;
- Vue;
- Tailwind;
- Router;
- Pinia;
- PWA;
- API;
- migrations;
- CI/build;
- env;
- health.

## Fase 1 — Identidad y multi-tenant
- login;
- usuarios;
- roles;
- organizaciones;
- sucursales;
- licencia;
- layouts.

## Fase 2 — Catálogo e inventario base
- categorías;
- productos;
- unidades;
- conversiones;
- balances;
- movimientos;
- entradas/salidas.

## Fase 3 — POS
- carrito;
- pagos;
- ticket;
- cancelación;
- ventas en espera.

## Fase 4 — Compras
- proveedores;
- compras;
- entradas automáticas.

## Fase 5 — Traspasos
- envío;
- recepción;
- saldo;
- pagos parciales.

## Fase 6 — Caja
- apertura;
- movimientos;
- cierre.

## Fase 7 — Reportes
- dashboard;
- exportación;
- compartir.

## Fase 8 — Offline
- IndexedDB;
- service worker;
- cola;
- idempotencia;
- sync.

## Fase 9 — Ajustes / marca blanca
- logo;
- colores;
- ticket;
- políticas.

## Fase 10 — Hardening
- pruebas;
- seguridad;
- multi-tenant tests;
- rendimiento;
- backups;
- errores.

---

# 70. Orden de prioridad si hay que recortar

No recortar:

1. Auth.
2. Multiempresa.
3. POS.
4. Inventario.
5. Unidades/conversiones.
6. Movimientos.
7. Traspasos.
8. Saldo intersucursal.
9. Reportes básicos.
10. Licencia.
11. Offline ventas.
12. Ticket.

Recortables temporalmente:

- gráficas decorativas;
- clientes avanzados;
- PDF muy elaborado;
- colores avanzados;
- geofence bloqueante;
- importación XLSX si CSV funciona;
- devolución parcial.

---

# 71. Definition of Done V1

V1 se considera lista cuando:

- build Vue pasa;
- build API pasa;
- migrations reproducibles;
- login funciona;
- multi-tenant probado;
- licencias funcionan;
- roles funcionan;
- POS vende;
- inventario cambia correctamente;
- unidades convierten;
- compras generan entradas;
- traspasos funcionan;
- saldo intersucursal funciona;
- caja funciona;
- reportes básicos funcionan;
- ticket 80 mm imprime;
- ventas offline sincronizan;
- no hay secretos frontend;
- sourcemaps producción desactivados;
- responsive verificado;
- auditoría crítica existe;
- documentación de despliegue existe.

---

# 72. Decisiones congeladas

A partir de este PRD quedan aprobadas:

1. Producto final en Vue 3.
2. Lovable solo como herramienta de construcción; su React/TanStack no cambia el stack final.
3. Tailwind CSS.
4. TypeScript.
5. API propia.
6. `api.geeksium.com`.
7. PostgreSQL.
8. Supabase inicialmente como proveedor de PostgreSQL.
9. Preparación de migración AWS.
10. Login correo + contraseña.
11. Sin social login.
12. Multiempresa.
13. Multisucursal.
14. Licenciamiento por organización.
15. POS.
16. Inventario.
17. Compras.
18. Reportería.
19. Traspasos.
20. Traspasos con saldo pendiente.
21. Unidades/conversiones.
22. Un método de pago por venta en V1.
23. Sin CFDI V1.
24. Offline POS con IndexedDB.
25. File System Access opcional.
26. Ticket 80 mm vía SO.
27. Agente Windows posterior.
28. Desktop first.
29. Celular responsive.
30. Español únicamente V1.
31. SEO solo landing.
32. WhatsApp/correo para compartir.
33. Geolocalización configurable.
34. No intentar ocultar el JavaScript como mecanismo de seguridad.
35. Lógica crítica en API.
36. Nuevas ideas no bloqueantes pasan a V2.

---

# 73. Lista V2 priorizada

## Alta prioridad
- agente Windows;
- SQLite local a través de agente;
- impresión silenciosa;
- báscula;
- cajón;
- lotes/caducidad;
- fabricación;
- devolución parcial;
- listas de precios;
- precios por volumen;
- venta a crédito cliente;
- cuentas por cobrar;
- proveedores a crédito;
- cuentas por pagar;
- etiquetas.

## Media
- ecommerce;
- pedidos;
- promociones;
- monedero;
- Mercado Pago;
- app nativa;
- roles personalizados visuales;
- reportes programados.

## Fiscal/administrativo
- CFDI;
- factura global;
- notas de crédito;
- complementos;
- retenciones.

---

# 74. Fuentes y referencias de decisión

## Material proporcionado por el usuario
- `pos.txt`: transcripción de video de POS genérico y listado comparativo de funciones de PulPOS.
- Sitio de referencia indicado por el usuario: `https://pulpos.com/precios/`.

## Verificaciones técnicas actuales
- Lovable: proyectos nuevos desde mayo de 2026 utilizan TanStack Start/React.
  - `https://lovable.dev/blog/building-apps-using-tanstack-start`
- PostgreSQL/Supabase:
  - `https://supabase.com/docs/guides/platform/migrating-to-supabase/postgres`
  - `https://supabase.com/docs/guides/self-hosting/restore-from-platform`
- AWS PostgreSQL migration:
  - `https://docs.aws.amazon.com/dms/latest/sbs/chap-manageddatabases.postgresql-rds-postgresql.html`
- File System Access:
  - `https://caniuse.com/native-filesystem-api`

---

# 75. Instrucción final de alcance

Este documento debe tratarse como **alcance congelado de V1**.

Si durante la construcción aparece una nueva función, aplicar esta regla:

> “¿Es necesaria para vender, controlar inventario, transferir mercancía, cobrar saldos internos, reportar, autenticar, licenciar o mantener integridad/seguridad?”

Si la respuesta es no, registrar como V2 y continuar con V1.

La meta no es construir el POS con más funciones del mercado.

La meta es construir una V1 que pueda operar realmente en un molino o bodega, sea confiable, permita crecer a múltiples clientes y no obligue a reescribir la arquitectura cuando aumente el volumen.
