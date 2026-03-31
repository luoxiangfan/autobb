-- Migration: 181_openclaw_user_bindings_tenant_unique_fix.pg.sql
-- Description: Replace legacy global open_id uniqueness with tenant-aware constraints
-- Date: 2026-02-15
-- Database: PostgreSQL

-- ---------------------------------------------------------------------
-- 1) Drop legacy global unique constraint
-- ---------------------------------------------------------------------
ALTER TABLE openclaw_user_bindings
  DROP CONSTRAINT IF EXISTS openclaw_user_bindings_channel_open_id_key;

-- ---------------------------------------------------------------------
-- 2) Ensure tenant-aware unique indexes exist
-- ---------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS idx_openclaw_bindings_channel_tenant_open_unique
  ON openclaw_user_bindings(channel, tenant_key, open_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_openclaw_bindings_channel_tenant_union_unique
  ON openclaw_user_bindings(channel, tenant_key, union_id)
  WHERE union_id IS NOT NULL;

-- ---------------------------------------------------------------------
-- 3) Keep null-tenant compatibility uniqueness (legacy compat / non-tenant channels)
-- ---------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS idx_openclaw_bindings_channel_open_null_tenant_unique
  ON openclaw_user_bindings(channel, open_id)
  WHERE tenant_key IS NULL;
