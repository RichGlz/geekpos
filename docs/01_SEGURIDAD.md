# Seguridad — Geeksium POS V1

## Contraseñas

- Hash con **Argon2id** (`api/src/lib/crypto.ts`), parámetros configurables por
  entorno. Nunca se almacena ni se registra la contraseña en claro.
- Los mensajes de error de login son genéricos: no revelan si el correo existe.

## Tokens

| Token | Vida | Dónde vive | Notas |
|---|---|---|---|
| Access (JWT) | corta | memoria del navegador | nunca en localStorage |
| Refresh | larga | cookie HttpOnly | solo se guarda su **hash SHA-256** en la base |

- Rotación en cada refresco: el token usado se marca como rotado y se emite uno nuevo.
- **Detección de reúso**: si llega un refresh ya rotado, se revoca toda la familia
  de tokens y se cierra la sesión; el evento queda en la bitácora de auditoría.
- Cierre de sesión revoca la sesión y su familia de tokens.

## Cookies

- `HttpOnly`, `SameSite=Lax`, ruta acotada al endpoint de refresh.
- `Secure=true` **obligatorio** en producción; configurable solo para desarrollo
  local por HTTP (`COOKIE_SECURE`).

## Intentos de acceso

- Backoff temporal por combinación de correo + IP con retardo creciente y bloqueo
  transitorio que **se libera solo**. No se bloquea la cuenta de forma permanente,
  para que un tercero no pueda dejar fuera a un usuario legítimo.
- Cada intento se registra en `login_attempts` para diagnóstico.

## Auditoría

Eventos de seguridad (login correcto y fallido, refresh, reúso detectado, cierre
de sesión, cierre remoto) se escriben en la tabla **`audit_log`** con
organización, usuario, IP y user agent.

## Errores

- En producción la API devuelve mensajes genéricos con un `requestId`; nunca
  stack traces ni detalles internos. El detalle completo queda en el log del servidor.

## Formato estricto del refresh token

El refresh token viaja como `sessionId.secret`. El servidor exige: UUID válido
en el prefijo, separador presente, prefijo y secreto no vacíos, y que el
`sessionId` coincida con la sesión resuelta a partir del hash del secreto. Un
prefijo que no corresponde se trata como manipulación y quema la familia entera.

## Integridad multiempresa en la propia base

Además de la comprobación en la aplicación:

- claves únicas y foráneas compuestas `(organization_id, id)` en `branches`,
  `users`, `sessions`, `roles`, `warehouses` y `user_branches`;
- `CONSTRAINT TRIGGER` en `sessions` y `user_roles` que compara con
  `IS NOT DISTINCT FROM` contra la organización real del usuario, de modo que un
  `organization_id` **NULL** para un usuario de tenant también se rechaza;
- índice único parcial sobre `refresh_tokens.parent_token_id`: un token no puede
  tener dos hijos. El índice sobre `replaced_by` **no** daba esa garantía (impide
  que un mismo sucesor sea reclamado dos veces, que es lo contrario), por eso se
  añadió la relación hija explícita en `0003_phase0_null_integrity.sql`.

La primera barrera sigue siendo la rotación transaccional
(`SELECT ... FOR UPDATE` + `UPDATE` condicional) en el repositorio; el índice es
la segunda y ya sí es real.

## Service Worker

El service worker **no** cachea:

- ninguna ruta bajo `/api`, ni en URL relativa ni absoluta, en ningún método;
- respuestas de autenticación o de datos privados.

Solo se precachean los recursos estáticos del shell de la aplicación.

## Semillas de desarrollo

No existe ninguna migración de semillas: `0002_seed_dev.sql` **no está en el
repositorio** y no se creará. El único mecanismo es `api/scripts/seed-dev.ts`:

- se ejecuta **solo bajo demanda** (`npm run seed:dev`), nunca de forma automática,
- aborta si `NODE_ENV=production` y exige `ALLOW_DEV_SEED=true`,
- no contiene credenciales reutilizables: la contraseña se genera al azar y se
  imprime una única vez en la consola de quien ejecuta el comando.

