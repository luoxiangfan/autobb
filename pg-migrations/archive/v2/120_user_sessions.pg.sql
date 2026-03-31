-- ==========================================
-- Migration: 120_user_sessions (PostgreSQL)
-- Purpose: Track user login sessions for account sharing detection
-- ==========================================

-- Drop tables if exist (for clean re-creation)
DROP TABLE IF EXISTS account_sharing_alerts CASCADE;
DROP TABLE IF EXISTS trusted_devices CASCADE;
DROP TABLE IF EXISTS user_sessions CASCADE;

-- ==========================================
-- Table: user_sessions
-- ==========================================
CREATE TABLE user_sessions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  session_token TEXT UNIQUE NOT NULL,
  ip_address TEXT NOT NULL,
  user_agent TEXT NOT NULL,
  device_fingerprint TEXT NOT NULL,
  is_current INTEGER DEFAULT 1,
  is_suspicious INTEGER DEFAULT 0,
  suspicious_reason TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  last_activity_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  revoked_at TIMESTAMP WITH TIME ZONE
);

-- Indexes for performance (use CREATE INDEX IF NOT EXISTS for idempotency)
DO $$ BEGIN
  CREATE INDEX idx_user_sessions_user_id ON user_sessions(user_id);
EXCEPTION
  WHEN duplicate_table THEN null;
END $$;

DO $$ BEGIN
  CREATE INDEX idx_user_sessions_token ON user_sessions(session_token);
EXCEPTION
  WHEN duplicate_table THEN null;
END $$;

DO $$ BEGIN
  CREATE INDEX idx_user_sessions_device_fp ON user_sessions(device_fingerprint);
EXCEPTION
  WHEN duplicate_table THEN null;
END $$;

DO $$ BEGIN
  CREATE INDEX idx_user_sessions_expires ON user_sessions(expires_at);
EXCEPTION
  WHEN duplicate_table THEN null;
END $$;

DO $$ BEGIN
  CREATE INDEX idx_user_sessions_is_suspicious ON user_sessions(is_suspicious);
EXCEPTION
  WHEN duplicate_table THEN null;
END $$;

DO $$ BEGIN
  CREATE INDEX idx_user_sessions_created_at ON user_sessions(created_at);
EXCEPTION
  WHEN duplicate_table THEN null;
END $$;

-- Foreign key
ALTER TABLE user_sessions ADD CONSTRAINT fk_user_sessions_user
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

-- ==========================================
-- Table: account_sharing_alerts
-- ==========================================
CREATE TABLE account_sharing_alerts (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  alert_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'warning',
  description TEXT NOT NULL,
  ip_addresses TEXT,
  device_fingerprints TEXT,
  metadata JSONB,
  is_resolved INTEGER DEFAULT 0,
  resolved_at TIMESTAMP WITH TIME ZONE,
  resolved_by INTEGER,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Indexes
DO $$ BEGIN
  CREATE INDEX idx_alerts_user_id ON account_sharing_alerts(user_id);
EXCEPTION
  WHEN duplicate_table THEN null;
END $$;

DO $$ BEGIN
  CREATE INDEX idx_alerts_created_at ON account_sharing_alerts(created_at);
EXCEPTION
  WHEN duplicate_table THEN null;
END $$;

DO $$ BEGIN
  CREATE INDEX idx_alerts_is_resolved ON account_sharing_alerts(is_resolved);
EXCEPTION
  WHEN duplicate_table THEN null;
END $$;

-- Foreign keys
ALTER TABLE account_sharing_alerts ADD CONSTRAINT fk_alerts_user
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE account_sharing_alerts ADD CONSTRAINT fk_alerts_resolved_by
  FOREIGN KEY (resolved_by) REFERENCES users(id);

-- ==========================================
-- Table: trusted_devices
-- ==========================================
CREATE TABLE trusted_devices (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  device_fingerprint TEXT NOT NULL,
  device_name TEXT,
  last_used_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  is_active INTEGER DEFAULT 1
);

DO $$ BEGIN
  CREATE INDEX idx_trusted_devices_user ON trusted_devices(user_id);
EXCEPTION
  WHEN duplicate_table THEN null;
END $$;

-- Unique constraint
ALTER TABLE trusted_devices ADD CONSTRAINT uk_trusted_device
  UNIQUE (user_id, device_fingerprint);

-- Foreign key
ALTER TABLE trusted_devices ADD CONSTRAINT fk_trusted_devices_user
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
