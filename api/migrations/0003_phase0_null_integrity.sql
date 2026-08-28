-- ============================================================================
-- Geeksium POS — 0003_phase0_null_integrity
--
-- Cierre de Fase 0. Migración APPEND-ONLY: 0001 y 0002 se tratan como
-- aplicadas e inmutables.
--
-- Corrige dos afirmaciones que la Ronda 1 dejó a medias:
--
--  1. NULL no era un valor seguro. Una sesión o una asignación user_roles de
--     un usuario que SÍ pertenece a un tenant podía guardarse con
--     organization_id = NULL y esquivar las FK compuestas (en SQL, una FK
--     compuesta con una columna NULL simplemente no se comprueba).
--     Se compara ahora contra la organización real del usuario con
--     IS NOT DISTINCT FROM, que trata NULL como un valor comparable.
--
--  2. `refresh_tokens_replaced_by_unique_idx` NO impide que un mismo
--     predecesor tenga dos sucesores: impide que un mismo sucesor sea
--     reclamado por dos predecesores. Son cosas distintas. La garantía real
--     se añade aquí con `parent_token_id` y su índice único parcial.
--
-- Transaccional, idempotente y aborta con mensaje claro ante datos
-- incompatibles. Nunca borra ni "corrige" filas en silencio.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. Comprobaciones previas
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  bad bigint;
BEGIN
  SELECT count(*) INTO bad
    FROM sessions s
    JOIN users u ON u.id = s.user_id
   WHERE s.organization_id IS DISTINCT FROM u.organization_id;
  IF bad > 0 THEN
    RAISE EXCEPTION 'Datos incompatibles: % sesión(es) cuyo organization_id no coincide exactamente con el del usuario (incluye NULL).', bad;
  END IF;

  SELECT count(*) INTO bad
    FROM user_roles ur
    JOIN users u ON u.id = ur.user_id
   WHERE ur.organization_id IS DISTINCT FROM u.organization_id;
  IF bad > 0 THEN
    RAISE EXCEPTION 'Datos incompatibles: % asignación(es) user_roles cuyo organization_id no coincide exactamente con el del usuario (incluye NULL).', bad;
  END IF;

  SELECT count(*) INTO bad
    FROM (SELECT t.replaced_by
            FROM refresh_tokens t
           WHERE t.replaced_by IS NOT NULL
           GROUP BY t.replaced_by
          HAVING count(*) > 1) dup;
  IF bad > 0 THEN
    RAISE EXCEPTION 'Datos incompatibles: % sucesor(es) reclamados por más de un predecesor.', bad;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 1. sessions: la organización de la sesión es EXACTAMENTE la del usuario
--
-- No puede resolverse con un CHECK ni con una columna generada: PostgreSQL
-- prohíbe consultar otras tablas en ambos casos. Se usa un CONSTRAINT TRIGGER,
-- igual que en user_roles.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION sessions_tenant_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  user_org uuid;
  user_exists boolean;
BEGIN
  SELECT u.organization_id, true INTO user_org, user_exists
    FROM users u WHERE u.id = NEW.user_id;

  IF NOT COALESCE(user_exists, false) THEN
    RAISE EXCEPTION 'sessions: el usuario % no existe', NEW.user_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  -- IS NOT DISTINCT FROM: NULL solo es válido si el usuario tampoco tiene
  -- organización (usuarios de plataforma sin tenant).
  IF NOT (NEW.organization_id IS NOT DISTINCT FROM user_org) THEN
    RAISE EXCEPTION
      'sessions: aislamiento multiempresa violado (la sesión declara una organización distinta a la del usuario %)', NEW.user_id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  RETURN NULL;
END
$$;

DROP TRIGGER IF EXISTS sessions_tenant_guard_trg ON sessions;
CREATE CONSTRAINT TRIGGER sessions_tenant_guard_trg
  AFTER INSERT OR UPDATE ON sessions
  DEFERRABLE INITIALLY IMMEDIATE
  FOR EACH ROW EXECUTE FUNCTION sessions_tenant_guard();

-- ---------------------------------------------------------------------------
-- 2. user_roles: reemplaza al guard de 0002 añadiendo el caso NULL
--
-- Reglas:
--   - organization_id debe ser EXACTAMENTE el del usuario (IS NOT DISTINCT
--     FROM), así que un usuario con tenant ya no puede guardar NULL.
--   - un rol global del sistema (roles.organization_id IS NULL) sigue siendo
--     asignable a cualquier usuario.
--   - un rol de tenant solo es asignable a usuarios de ese mismo tenant.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION user_roles_tenant_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  role_org uuid;
  role_exists boolean;
  user_org uuid;
  user_exists boolean;
BEGIN
  SELECT r.organization_id, true INTO role_org, role_exists
    FROM roles r WHERE r.id = NEW.role_id;
  IF NOT COALESCE(role_exists, false) THEN
    RAISE EXCEPTION 'user_roles: el rol % no existe', NEW.role_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  SELECT u.organization_id, true INTO user_org, user_exists
    FROM users u WHERE u.id = NEW.user_id;
  IF NOT COALESCE(user_exists, false) THEN
    RAISE EXCEPTION 'user_roles: el usuario % no existe', NEW.user_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  -- La columna organization_id de la asignación no puede mentir ni quedarse
  -- en NULL cuando el usuario pertenece a un tenant.
  IF NOT (NEW.organization_id IS NOT DISTINCT FROM user_org) THEN
    RAISE EXCEPTION
      'user_roles: aislamiento multiempresa violado (organization_id no coincide con el del usuario %)', NEW.user_id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  -- Rol global del sistema: permitido para cualquier usuario.
  IF role_org IS NULL THEN
    RETURN NULL;
  END IF;

  IF role_org IS DISTINCT FROM user_org THEN
    RAISE EXCEPTION
      'user_roles: aislamiento multiempresa violado (el rol % pertenece a otra organización)', NEW.role_id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  RETURN NULL;
END
$$;

-- ---------------------------------------------------------------------------
-- 3. refresh_tokens: un predecesor NO puede tener dos sucesores
--
-- `replaced_by` apunta hacia adelante; su índice único garantiza "un sucesor
-- pertenece a un solo predecesor". La garantía inversa exige apuntar hacia
-- atrás: `parent_token_id` con índice único parcial.
-- ---------------------------------------------------------------------------
ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS parent_token_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'refresh_tokens_parent_fkey') THEN
    ALTER TABLE refresh_tokens
      ADD CONSTRAINT refresh_tokens_parent_fkey
      FOREIGN KEY (parent_token_id) REFERENCES refresh_tokens (id) ON DELETE SET NULL;
  END IF;
END
$$;

-- Relleno coherente con el histórico ya existente.
UPDATE refresh_tokens child
   SET parent_token_id = parent.id
  FROM refresh_tokens parent
 WHERE parent.replaced_by = child.id
   AND child.parent_token_id IS DISTINCT FROM parent.id;

CREATE UNIQUE INDEX IF NOT EXISTS refresh_tokens_parent_unique_idx
  ON refresh_tokens (parent_token_id) WHERE parent_token_id IS NOT NULL;

-- Un token no puede ser su propio predecesor.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'refresh_tokens_parent_not_self_chk') THEN
    ALTER TABLE refresh_tokens
      ADD CONSTRAINT refresh_tokens_parent_not_self_chk
      CHECK (parent_token_id IS NULL OR parent_token_id <> id);
  END IF;
END
$$;
