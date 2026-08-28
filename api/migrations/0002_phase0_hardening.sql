-- ============================================================================
-- Geeksium POS — 0002_phase0_hardening
--
-- Endurecimiento de la Fase 0. Migración APPEND-ONLY: 0001_init.sql se trata
-- como aplicada e inmutable y no se modifica ni en comentarios.
--
-- Objetivo: que la base de datos, y no solo el código de aplicación, impida
-- relaciones cruzadas entre organizaciones y dos sucesores de un mismo refresh
-- token.
--
-- Nota de portabilidad honesta: 0001 ejecuta `CREATE EXTENSION pgcrypto` y esa
-- dependencia sigue siendo un requisito real y vigente de cualquier
-- instalación (Supabase, RDS o Aurora). No es opcional mientras 0001 exista.
--
-- Esta migración es transaccional (la aplica el migrador dentro de BEGIN),
-- idempotente y aborta con un mensaje claro si encuentra datos incompatibles.
-- Nunca borra ni "corrige" filas en silencio.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. Comprobaciones previas: los datos existentes deben ser consistentes
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  bad bigint;
BEGIN
  SELECT count(*) INTO bad
    FROM warehouses w
    JOIN branches b ON b.id = w.branch_id
   WHERE b.organization_id IS DISTINCT FROM w.organization_id;
  IF bad > 0 THEN
    RAISE EXCEPTION 'Datos incompatibles: % almacén(es) apuntan a una sucursal de otra organización. Corrígelos antes de migrar.', bad;
  END IF;

  SELECT count(*) INTO bad
    FROM user_branches ub
    JOIN users u ON u.id = ub.user_id
   WHERE u.organization_id IS DISTINCT FROM ub.organization_id;
  IF bad > 0 THEN
    RAISE EXCEPTION 'Datos incompatibles: % asignación(es) usuario-sucursal con organización distinta a la del usuario.', bad;
  END IF;

  SELECT count(*) INTO bad
    FROM user_branches ub
    JOIN branches b ON b.id = ub.branch_id
   WHERE b.organization_id IS DISTINCT FROM ub.organization_id;
  IF bad > 0 THEN
    RAISE EXCEPTION 'Datos incompatibles: % asignación(es) usuario-sucursal con sucursal de otra organización.', bad;
  END IF;

  SELECT count(*) INTO bad
    FROM sessions s
    JOIN users u ON u.id = s.user_id
   WHERE u.organization_id IS DISTINCT FROM s.organization_id;
  IF bad > 0 THEN
    RAISE EXCEPTION 'Datos incompatibles: % sesión(es) con organización distinta a la del usuario.', bad;
  END IF;

  SELECT count(*) INTO bad
    FROM user_roles ur
    JOIN users u ON u.id = ur.user_id
    JOIN roles r ON r.id = ur.role_id
   WHERE r.organization_id IS NOT NULL
     AND r.organization_id IS DISTINCT FROM u.organization_id;
  IF bad > 0 THEN
    RAISE EXCEPTION 'Datos incompatibles: % asignación(es) de rol de otra organización.', bad;
  END IF;

  SELECT count(*) INTO bad
    FROM refresh_tokens t
   WHERE t.replaced_by IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM refresh_tokens s WHERE s.id = t.replaced_by);
  IF bad > 0 THEN
    RAISE EXCEPTION 'Datos incompatibles: % refresh token(s) con sucesor inexistente.', bad;
  END IF;

  SELECT count(*) INTO bad
    FROM (SELECT replaced_by FROM refresh_tokens
           WHERE replaced_by IS NOT NULL
           GROUP BY replaced_by HAVING count(*) > 1) dup;
  IF bad > 0 THEN
    RAISE EXCEPTION 'Datos incompatibles: % sucesor(es) de refresh token reclamados por más de un token.', bad;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 1. Claves únicas compuestas (organization_id, id)
--
-- `organizations` NO entra aquí: no tiene organization_id, su id ya es la raíz
-- del tenant.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'branches_org_id_key') THEN
    ALTER TABLE branches ADD CONSTRAINT branches_org_id_key UNIQUE (organization_id, id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_org_id_key') THEN
    ALTER TABLE users ADD CONSTRAINT users_org_id_key UNIQUE (organization_id, id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sessions_org_id_key') THEN
    ALTER TABLE sessions ADD CONSTRAINT sessions_org_id_key UNIQUE (organization_id, id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'roles_org_id_key') THEN
    ALTER TABLE roles ADD CONSTRAINT roles_org_id_key UNIQUE (organization_id, id);
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 2. Claves foráneas compuestas: la organización viaja dentro de la relación
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'warehouses_branch_same_org_fkey') THEN
    ALTER TABLE warehouses
      ADD CONSTRAINT warehouses_branch_same_org_fkey
      FOREIGN KEY (organization_id, branch_id)
      REFERENCES branches (organization_id, id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_branches_user_same_org_fkey') THEN
    ALTER TABLE user_branches
      ADD CONSTRAINT user_branches_user_same_org_fkey
      FOREIGN KEY (organization_id, user_id)
      REFERENCES users (organization_id, id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_branches_branch_same_org_fkey') THEN
    ALTER TABLE user_branches
      ADD CONSTRAINT user_branches_branch_same_org_fkey
      FOREIGN KEY (organization_id, branch_id)
      REFERENCES branches (organization_id, id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sessions_user_same_org_fkey') THEN
    ALTER TABLE sessions
      ADD CONSTRAINT sessions_user_same_org_fkey
      FOREIGN KEY (organization_id, user_id)
      REFERENCES users (organization_id, id) ON DELETE CASCADE;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 3. user_roles: "rol global del sistema o rol del mismo tenant"
--
-- organization_id es una columna NORMAL (no generada) con FK compuesta al
-- usuario. La comparación contra `roles` no puede vivir en un CHECK ni en una
-- columna generada porque PostgreSQL prohíbe consultar otras tablas ahí; se
-- resuelve con un CONSTRAINT TRIGGER.
-- ---------------------------------------------------------------------------
ALTER TABLE user_roles ADD COLUMN IF NOT EXISTS organization_id uuid;

UPDATE user_roles ur
   SET organization_id = u.organization_id
  FROM users u
 WHERE u.id = ur.user_id
   AND ur.organization_id IS DISTINCT FROM u.organization_id;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_roles_user_same_org_fkey') THEN
    ALTER TABLE user_roles
      ADD CONSTRAINT user_roles_user_same_org_fkey
      FOREIGN KEY (organization_id, user_id)
      REFERENCES users (organization_id, id) ON DELETE CASCADE;
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION user_roles_tenant_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  role_org uuid;
  role_exists boolean;
BEGIN
  SELECT r.organization_id, true INTO role_org, role_exists
    FROM roles r WHERE r.id = NEW.role_id;

  IF NOT COALESCE(role_exists, false) THEN
    RAISE EXCEPTION 'user_roles: el rol % no existe', NEW.role_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  -- Rol global del sistema: permitido para cualquier usuario.
  IF role_org IS NULL THEN
    RETURN NULL;
  END IF;

  -- Rol de tenant: solo para usuarios de ese mismo tenant.
  IF NEW.organization_id IS NULL OR role_org <> NEW.organization_id THEN
    RAISE EXCEPTION
      'user_roles: aislamiento multiempresa violado (rol % pertenece a otra organización)', NEW.role_id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  RETURN NULL;
END
$$;

DROP TRIGGER IF EXISTS user_roles_tenant_guard_trg ON user_roles;
CREATE CONSTRAINT TRIGGER user_roles_tenant_guard_trg
  AFTER INSERT OR UPDATE ON user_roles
  DEFERRABLE INITIALLY IMMEDIATE
  FOR EACH ROW EXECUTE FUNCTION user_roles_tenant_guard();

CREATE INDEX IF NOT EXISTS user_roles_org_idx ON user_roles (organization_id, user_id);

-- ---------------------------------------------------------------------------
-- 4. refresh_tokens: un token no puede tener dos sucesores
--
-- La garantía primaria es la rotación transaccional (SELECT ... FOR UPDATE +
-- UPDATE condicional) en el repositorio. Esto es la segunda barrera.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'refresh_tokens_replaced_by_fkey') THEN
    ALTER TABLE refresh_tokens
      ADD CONSTRAINT refresh_tokens_replaced_by_fkey
      FOREIGN KEY (replaced_by) REFERENCES refresh_tokens (id) ON DELETE SET NULL;
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS refresh_tokens_replaced_by_unique_idx
  ON refresh_tokens (replaced_by) WHERE replaced_by IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 5. Índices de apoyo para las consultas de tenant + sucursal
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS user_branches_branch_idx ON user_branches (organization_id, branch_id);
CREATE INDEX IF NOT EXISTS sessions_org_user_idx ON sessions (organization_id, user_id) WHERE revoked_at IS NULL;
