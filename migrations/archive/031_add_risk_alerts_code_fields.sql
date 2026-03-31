-- Migration: Add code-required fields to risk_alerts table
-- Date: 2025-12-03
-- Description: Add alert_type, resource_type, resource_id, details, acknowledged_at fields

-- SQLite version
ALTER TABLE risk_alerts ADD COLUMN alert_type TEXT;
ALTER TABLE risk_alerts ADD COLUMN resource_type TEXT;
ALTER TABLE risk_alerts ADD COLUMN resource_id INTEGER;
ALTER TABLE risk_alerts ADD COLUMN details TEXT;
ALTER TABLE risk_alerts ADD COLUMN acknowledged_at TIMESTAMP;

-- Copy data from old fields to new fields for backward compatibility
UPDATE risk_alerts SET alert_type = risk_type WHERE alert_type IS NULL;
UPDATE risk_alerts SET resource_type = related_type WHERE resource_type IS NULL;
UPDATE risk_alerts SET resource_id = related_id WHERE resource_id IS NULL;

-- Create indexes for new fields
CREATE INDEX IF NOT EXISTS idx_risk_alerts_alert_type ON risk_alerts(alert_type);
CREATE INDEX IF NOT EXISTS idx_risk_alerts_resource ON risk_alerts(resource_type, resource_id);
