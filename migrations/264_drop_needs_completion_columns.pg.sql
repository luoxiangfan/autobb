-- Drop unused offer/campaign completion tracking columns
DROP INDEX IF EXISTS idx_offers_needs_completion;
DROP INDEX IF EXISTS idx_campaigns_needs_offer_completion;
ALTER TABLE offers DROP COLUMN IF EXISTS needs_completion;
ALTER TABLE campaigns DROP COLUMN IF EXISTS needs_offer_completion;
