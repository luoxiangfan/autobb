-- Drop unused unlinked tracking columns from offers
DROP INDEX IF EXISTS idx_offers_last_unlinked_at;
DROP INDEX IF EXISTS idx_offers_unlinked_from_customer_ids;
ALTER TABLE offers DROP COLUMN IF EXISTS unlinked_from_customer_ids;
ALTER TABLE offers DROP COLUMN IF EXISTS last_unlinked_at;