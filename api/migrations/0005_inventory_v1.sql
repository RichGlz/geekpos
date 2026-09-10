-- Inventario V1 local-first. Incremental; no modifica migraciones publicadas.

-- El costo desconocido es NULL, nunca cero.
ALTER TABLE branch_products ALTER COLUMN cost DROP NOT NULL;
ALTER TABLE branch_products ADD CONSTRAINT branch_products_stock_nonnegative
  CHECK (stock >= 0) NOT VALID;

-- Permite comprobar que un almacén opcional pertenece a la misma sucursal.
ALTER TABLE warehouses
  ADD CONSTRAINT warehouses_org_branch_id_key UNIQUE (organization_id, branch_id, id);

CREATE TABLE inventory_movements (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL,
  product_id uuid NOT NULL,
  warehouse_id uuid,
  movement_type text NOT NULL CHECK (movement_type IN (
    'INITIAL', 'ENTRY', 'EXIT', 'ADJUSTMENT',
    'SALE', 'RETURN', 'TRANSFER_IN', 'TRANSFER_OUT', 'WASTE'
  )),
  quantity numeric(18,6) NOT NULL CHECK (quantity <> 0),
  unit text NOT NULL CHECK (length(unit) BETWEEN 1 AND 60),
  base_quantity_delta numeric(18,6) NOT NULL CHECK (base_quantity_delta <> 0),
  user_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL,
  comment text CHECK (comment IS NULL OR length(comment) <= 500),
  reference text CHECK (reference IS NULL OR length(reference) <= 120),
  idempotency_key uuid NOT NULL,
  sync_state text NOT NULL DEFAULT 'SYNCED' CHECK (sync_state IN ('PENDING_SYNC', 'SYNCED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, idempotency_key),
  FOREIGN KEY (organization_id, branch_id)
    REFERENCES branches(organization_id, id),
  FOREIGN KEY (organization_id, product_id)
    REFERENCES products(organization_id, id),
  FOREIGN KEY (organization_id, user_id)
    REFERENCES users(organization_id, id),
  FOREIGN KEY (organization_id, branch_id, warehouse_id)
    REFERENCES warehouses(organization_id, branch_id, id)
);

CREATE INDEX inventory_movements_product_idx
  ON inventory_movements (organization_id, branch_id, product_id, occurred_at DESC, id DESC);
CREATE INDEX inventory_movements_created_idx
  ON inventory_movements (organization_id, created_at, id);
CREATE UNIQUE INDEX inventory_movements_one_initial_idx
  ON inventory_movements (organization_id, branch_id, product_id)
  WHERE movement_type = 'INITIAL';

-- El mismo cursor local-first entrega movimientos y el stock materializado.
ALTER TABLE catalog_changes DROP CONSTRAINT IF EXISTS catalog_changes_entity_check;
ALTER TABLE catalog_changes ADD CONSTRAINT catalog_changes_entity_check
  CHECK (entity IN ('products','productAliases','branchProducts','inventoryMovements'));

-- Fastify es la única puerta de acceso; no publicar tablas internas por Supabase.
DO $$
DECLARE role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE ALL ON inventory_movements FROM %I', role_name);
    END IF;
  END LOOP;
END $$;
