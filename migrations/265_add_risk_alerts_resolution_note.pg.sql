-- 265: Add resolution_note to risk_alerts (acknowledge/resolve notes from UI and url-swap auto-resolve)

ALTER TABLE risk_alerts ADD COLUMN IF NOT EXISTS resolution_note TEXT;
