-- Migration: Add Bucket D (High Purchase Intent) to Offer Keyword Pools
-- Date: 2025-12-22
-- Description: Adds bucket_d_keywords and bucket_d_intent fields to support 5 creative buckets (A/B/C/D/S)

-- Add bucket_d_keywords column
ALTER TABLE offer_keyword_pools
ADD COLUMN bucket_d_keywords TEXT DEFAULT '[]';

-- Add bucket_d_intent column
ALTER TABLE offer_keyword_pools
ADD COLUMN bucket_d_intent TEXT DEFAULT '高购买意图';

-- Update existing records to have default values
UPDATE offer_keyword_pools
SET bucket_d_keywords = '[]', bucket_d_intent = '高购买意图'
WHERE bucket_d_keywords IS NULL OR bucket_d_intent IS NULL;
