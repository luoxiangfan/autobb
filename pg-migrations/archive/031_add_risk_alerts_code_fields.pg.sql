-- Migration: Add code-required fields to risk_alerts table (PostgreSQL)
-- Date: 2025-12-03
-- Description: Add alert_type, resource_type, resource_id, details, acknowledged_at fields

DO $$
BEGIN
    -- Add alert_type field
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'risk_alerts' AND column_name = 'alert_type') THEN
        ALTER TABLE risk_alerts ADD COLUMN alert_type TEXT;
        UPDATE risk_alerts SET alert_type = risk_type WHERE alert_type IS NULL;
    END IF;

    -- Add resource_type field
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'risk_alerts' AND column_name = 'resource_type') THEN
        ALTER TABLE risk_alerts ADD COLUMN resource_type TEXT;
        UPDATE risk_alerts SET resource_type = related_type WHERE resource_type IS NULL;
    END IF;

    -- Add resource_id field
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'risk_alerts' AND column_name = 'resource_id') THEN
        ALTER TABLE risk_alerts ADD COLUMN resource_id INTEGER;
        UPDATE risk_alerts SET resource_id = related_id WHERE resource_id IS NULL;
    END IF;

    -- Add details field
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'risk_alerts' AND column_name = 'details') THEN
        ALTER TABLE risk_alerts ADD COLUMN details TEXT;
    END IF;

    -- Add acknowledged_at field
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'risk_alerts' AND column_name = 'acknowledged_at') THEN
        ALTER TABLE risk_alerts ADD COLUMN acknowledged_at TIMESTAMP;
    END IF;
END $$;

-- Create indexes for new fields
CREATE INDEX IF NOT EXISTS idx_risk_alerts_alert_type ON risk_alerts(alert_type);
CREATE INDEX IF NOT EXISTS idx_risk_alerts_resource ON risk_alerts(resource_type, resource_id);
