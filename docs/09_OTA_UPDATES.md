# PWA y OTA

Canales soportados:

```text
development
pilot
stable
```

Cada canal requiere origen/despliegue coherente. El SW pertenece al origen;
no selecciona un bundle por organización. Canal del build, backend y organización
deben coincidir. No hay panel SaaS de releases.

Store: currentVersion, latestVersion, minimumSupportedVersion, updateChannel,
updateAvailable, updateRequired y UPDATE_READY. Versiones de tres componentes
numéricos. Una versión mínima superior muestra aviso; no fuerza recarga.
El worker se comprueba como máximo una vez por hora mientras funciona sync.

## Protección

Registro prompt, skipWaiting:false, clientsClaim:false. Aplicación explícita.
Formulario y sync toman lease crítico compartido. OTA exige Web Lock exclusivo
entre pestañas y ausencia de comandos/imágenes pendientes de cualquier cuenta.
Espera activación y recarga solo la pestaña que aplica; las otras no se recargan.
Sin Web Locks rehúsa aplicar automáticamente y pide terminar/cerrar pestañas.

Ventas, cobros y cierres aún no existen. Deberán tomar el mismo lease hasta
terminar/persistir, incluyendo cualquier estado sensible no guardado.
No se afirma haber probado ventas activas.

## Cachés y compatibilidad

SW precachea app shell/estáticos. API: NetworkOnly para GET y mutaciones,
excluida del fallback de navegación; endpoints dinámicos también no-store.
IndexedDB es el caché de datos explícito. loadEnv(mode) respeta modo Vite.

cleanupOutdatedCaches elimina precachés viejos al activar. IndexedDB v1 → v2 es
aditiva, preserva cola/meta y cierra conexiones antiguas ante versionchange.
No se borra la base por cambiar build o cerrar sesión.

Hosting debe conservar assets con hash de versiones anteriores durante la
ventana de compatibilidad: una pestaña vieja puede pedir un chunk lazy anterior
tras activarse otro worker. Publicación atómica; HTML/sw.js revalidables y
assets con hash inmutables. Mantener protocolo sync v1 para clientes offline.

Tests verifican estados, bloqueos, pendientes, canal y pestaña pasiva mediante
eventos simulados. Build genera worker. Falta OTA real con dos releases HTTPS,
dos pestañas y una PWA instalada que vuelva tras días offline.
