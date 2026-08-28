-- ============================================================================
-- Geeksium POS — 0001_init
-- Fundamento multiempresa: organizaciones, sucursales, almacenes, usuarios,
-- roles/permisos, licenciamiento, sesiones y auditoría.
--
-- Portabilidad: SQL estándar de PostgreSQL. Sin extensiones propietarias ni
-- dependencias del esquema `auth` de Supabase, para poder mover la base a
-- AWS RDS/Aurora sin reescribir migraciones.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- Organizaciones
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS organizations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text        NOT NULL,
  slug          text        NOT NULL UNIQUE,
  legal_name    text,
  timezone      text        NOT NULL DEFAULT 'America/Mexico_City',
  currency      char(3)     NOT NULL DEFAULT 'MXN',
  status        text        NOT NULL DEFAULT 'ACTIVE'
                CHECK (status IN ('ACTIVE', 'SUSPENDED', 'CANCELLED')),
  branding      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Sucursales
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS branches (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code                text NOT NULL,
  name                text NOT NULL,
  address             text,
  phone               text,
  latitude            numeric(9, 6),
  longitude           numeric(9, 6),
  geofence_radius_m   integer,
  geolocation_policy  text NOT NULL DEFAULT 'OFF'
                      CHECK (geolocation_policy IN ('OFF', 'RECORD', 'WARN', 'BLOCK')),
  is_active           boolean     NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code)
);
CREATE INDEX IF NOT EXISTS branches_organization_idx ON branches (organization_id);

-- ---------------------------------------------------------------------------
-- Almacenes (un almacén pertenece siempre a una sucursal)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS warehouses (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id       uuid NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  code            text NOT NULL,
  name            text NOT NULL,
  is_default      boolean     NOT NULL DEFAULT false,
  is_active       boolean     NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code)
);
CREATE INDEX IF NOT EXISTS warehouses_branch_idx ON warehouses (organization_id, branch_id);

-- ---------------------------------------------------------------------------
-- Licencias (la autoridad del estado vive en el servidor)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS licenses (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
  status          text NOT NULL DEFAULT 'ACTIVE'
                  CHECK (status IN ('ACTIVE', 'GRACE', 'READ_ONLY', 'SUSPENDED', 'CANCELLED')),
  plan            text        NOT NULL DEFAULT 'STANDARD',
  starts_at       timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz,
  grace_until     timestamptz,
  max_branches    integer,
  max_users       integer,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Usuarios
-- organization_id NULL == administrador de plataforma (Superadmin Geeksium).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid REFERENCES organizations(id) ON DELETE CASCADE,
  email             text NOT NULL,
  email_normalized  text NOT NULL UNIQUE,
  full_name         text NOT NULL,
  password_hash     text NOT NULL,
  is_active         boolean     NOT NULL DEFAULT true,
  is_platform_admin boolean     NOT NULL DEFAULT false,
  last_login_at     timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS users_organization_idx ON users (organization_id);

-- Un usuario puede operar en varias sucursales de su organización.
CREATE TABLE IF NOT EXISTS user_branches (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  branch_id       uuid NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, branch_id)
);

-- ---------------------------------------------------------------------------
-- Roles y permisos
-- Los roles NUNCA se guardan como columna del usuario: tabla aparte.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS roles (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  code            text NOT NULL,
  name            text NOT NULL,
  description     text,
  is_system       boolean     NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS roles_org_code_idx
  ON roles (COALESCE(organization_id, '00000000-0000-0000-0000-000000000000'::uuid), code);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id         uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_code text NOT NULL,
  PRIMARY KEY (role_id, permission_code)
);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id    uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role_id)
);

-- ---------------------------------------------------------------------------
-- Sesiones y refresh tokens rotativos
-- Solo se persiste el HASH del refresh token. El secreto en claro vive
-- exclusivamente en la cookie HttpOnly del cliente.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sessions (
  id              uuid PRIMARY KEY,
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_agent      text,
  ip_address      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_seen_at    timestamptz NOT NULL DEFAULT now(),
  revoked_at      timestamptz,
  revoked_reason  text
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id             uuid PRIMARY KEY,
  session_id     uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  family_id      uuid NOT NULL,
  token_hash     text NOT NULL UNIQUE,
  expires_at     timestamptz NOT NULL,
  used_at        timestamptz,
  replaced_by    uuid,
  revoked_at     timestamptz,
  revoked_reason text CHECK (revoked_reason IN ('ROTATED','LOGOUT','SESSION_REVOKED','REUSE_DETECTED','EXPIRED')),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS refresh_tokens_family_idx ON refresh_tokens (family_id);
CREATE INDEX IF NOT EXISTS refresh_tokens_session_idx ON refresh_tokens (session_id);

-- ---------------------------------------------------------------------------
-- Intentos de login (backoff temporal, nunca bloqueo permanente)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS login_attempts (
  id               uuid PRIMARY KEY,
  email_normalized text NOT NULL,
  ip_address       text,
  succeeded        boolean     NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS login_attempts_email_idx ON login_attempts (email_normalized, created_at DESC);
CREATE INDEX IF NOT EXISTS login_attempts_ip_idx ON login_attempts (ip_address, created_at DESC);

-- ---------------------------------------------------------------------------
-- Auditoría
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_log (
  id              uuid PRIMARY KEY,
  organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL,
  user_id         uuid REFERENCES users(id) ON DELETE SET NULL,
  action          text NOT NULL,
  entity          text,
  entity_id       text,
  ip_address      text,
  user_agent      text,
  metadata        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_log_org_idx ON audit_log (organization_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Catálogo de roles del sistema (plantillas globales, organization_id NULL)
-- ---------------------------------------------------------------------------
INSERT INTO roles (id, organization_id, code, name, description, is_system)
VALUES
  ('11111111-1111-4111-8111-000000000001', NULL, 'OWNER',      'Propietario',  'Control total de la organización', true),
  ('11111111-1111-4111-8111-000000000002', NULL, 'ADMIN',      'Administrador','Administración operativa completa', true),
  ('11111111-1111-4111-8111-000000000003', NULL, 'SUPERVISOR', 'Supervisor',   'Supervisión de sucursal y autorizaciones', true),
  ('11111111-1111-4111-8111-000000000004', NULL, 'CASHIER',    'Cajero',       'Operación de punto de venta', true),
  ('11111111-1111-4111-8111-000000000005', NULL, 'WAREHOUSE',  'Almacenista',  'Inventario y traspasos', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
VALUES
  ('11111111-1111-4111-8111-000000000001', '*'),
  ('11111111-1111-4111-8111-000000000002', 'org.read'),
  ('11111111-1111-4111-8111-000000000002', 'org.manage'),
  ('11111111-1111-4111-8111-000000000002', 'users.manage'),
  ('11111111-1111-4111-8111-000000000002', 'catalog.manage'),
  ('11111111-1111-4111-8111-000000000002', 'inventory.manage'),
  ('11111111-1111-4111-8111-000000000002', 'sales.read'),
  ('11111111-1111-4111-8111-000000000003', 'org.read'),
  ('11111111-1111-4111-8111-000000000003', 'sales.read'),
  ('11111111-1111-4111-8111-000000000003', 'sales.authorize'),
  ('11111111-1111-4111-8111-000000000003', 'inventory.manage'),
  ('11111111-1111-4111-8111-000000000004', 'pos.operate'),
  ('11111111-1111-4111-8111-000000000004', 'sales.create'),
  ('11111111-1111-4111-8111-000000000004', 'catalog.read'),
  ('11111111-1111-4111-8111-000000000005', 'inventory.manage'),
  ('11111111-1111-4111-8111-000000000005', 'transfers.manage'),
  ('11111111-1111-4111-8111-000000000005', 'catalog.read')
ON CONFLICT DO NOTHING;
