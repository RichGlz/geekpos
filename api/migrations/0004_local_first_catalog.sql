-- Incremental, additive catalog foundation. Existing auth migrations are immutable.
ALTER TABLE organizations ADD COLUMN update_channel text NOT NULL DEFAULT 'stable'
  CHECK (update_channel IN ('development', 'pilot', 'stable'));

CREATE TABLE product_assets (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  content_hash text NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  storage_key text NOT NULL,
  mime_type text NOT NULL CHECK (mime_type = 'image/webp'),
  width integer NOT NULL CHECK (width BETWEEN 1 AND 640),
  height integer NOT NULL CHECK (height BETWEEN 1 AND 640),
  size_bytes integer NOT NULL CHECK (size_bytes BETWEEN 1 AND 153600),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, content_hash)
);
CREATE TABLE products (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 180),
  normalized_name text NOT NULL,
  compact_key text NOT NULL,
  barcode text CHECK (barcode IS NULL OR length(barcode) BETWEEN 1 AND 80),
  description text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT '',
  sku text NOT NULL DEFAULT '',
  item_type text NOT NULL DEFAULT 'product' CHECK (item_type IN ('product','service')),
  base_unit text NOT NULL,
  conversions jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(conversions) = 'array'),
  asset_id uuid,
  active boolean NOT NULL DEFAULT true,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, barcode),
  FOREIGN KEY (organization_id, asset_id) REFERENCES product_assets(organization_id, id)
);
CREATE INDEX products_name_idx ON products (organization_id, normalized_name);
CREATE INDEX products_compact_idx ON products (organization_id, compact_key);
CREATE INDEX products_updated_idx ON products (organization_id, updated_at, id);
CREATE TABLE product_aliases (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  product_id uuid NOT NULL,
  display_name text NOT NULL,
  normalized_name text NOT NULL,
  compact_key text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, product_id, compact_key),
  FOREIGN KEY (organization_id, product_id) REFERENCES products(organization_id, id)
);
CREATE INDEX aliases_compact_idx ON product_aliases (organization_id, compact_key);
CREATE TABLE branch_products (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL,
  product_id uuid NOT NULL,
  price numeric(14,2) NOT NULL CHECK (price >= 0),
  cost numeric(14,2) NOT NULL CHECK (cost >= 0),
  stock numeric(18,6) NOT NULL DEFAULT 0,
  track_inventory boolean NOT NULL DEFAULT true,
  active boolean NOT NULL DEFAULT true,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, branch_id, product_id),
  FOREIGN KEY (organization_id, branch_id) REFERENCES branches(organization_id, id),
  FOREIGN KEY (organization_id, product_id) REFERENCES products(organization_id, id)
);
CREATE INDEX branch_products_sync_idx ON branch_products (organization_id, branch_id, updated_at, id);

-- A transactional, per-organization counter serializes writers until COMMIT.
-- A bare sequence or updated_at cursor can miss transactions committed out of order.
CREATE TABLE catalog_sync_state (
  organization_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  version bigint NOT NULL DEFAULT 0 CHECK (version >= 0)
);
CREATE TABLE catalog_changes (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  version bigint NOT NULL,
  entity text NOT NULL CHECK (entity IN ('products','productAliases','branchProducts')),
  entity_id uuid NOT NULL,
  branch_id uuid,
  data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, version)
);
CREATE INDEX catalog_changes_branch_idx ON catalog_changes (organization_id, branch_id, version);
CREATE TABLE sync_receipts (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  idempotency_key uuid NOT NULL,
  user_id uuid NOT NULL,
  payload_hash text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, idempotency_key)
);
ALTER TABLE audit_log ADD COLUMN branch_id uuid;
ALTER TABLE audit_log ADD COLUMN device_id uuid;
CREATE INDEX audit_branch_idx ON audit_log (organization_id, branch_id, created_at DESC);

-- Extend the current permission vocabulary instead of adding a second role system.
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r
CROSS JOIN (VALUES ('catalog.read'), ('catalog.manage'), ('catalog.duplicate'),
  ('price.change'), ('cost.change'), ('cost.read')) AS p(code)
WHERE r.is_system AND r.organization_id IS NULL AND r.code IN ('OWNER','ADMIN','SUPERVISOR')
ON CONFLICT DO NOTHING;

-- New internal tables must not inherit Supabase's automatic public API grants.
-- No RLS changes to existing auth tables. Fastify's direct DB role is unaffected
-- unless it was incorrectly using anon/authenticated (see PRE-PILOT BLOCKER).
DO $$
DECLARE role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE ALL ON product_assets, products, product_aliases, branch_products, catalog_sync_state, catalog_changes, sync_receipts FROM %I', role_name);
    END IF;
  END LOOP;
END $$;
