-- ==========================================
-- Migration: 120_user_sessions
-- Purpose: Track user login sessions for account sharing detection
-- ==========================================

-- ==========================================
-- Table: user_sessions
-- ==========================================
CREATE TABLE IF NOT EXISTS user_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  session_token TEXT UNIQUE NOT NULL,
  ip_address TEXT NOT NULL,
  user_agent TEXT NOT NULL,
  device_fingerprint TEXT NOT NULL,
  is_current INTEGER DEFAULT 1,
  is_suspicious INTEGER DEFAULT 0,
  suspicious_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_activity_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_token ON user_sessions(session_token);
CREATE INDEX IF NOT EXISTS idx_user_sessions_device_fp ON user_sessions(device_fingerprint);
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires ON user_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_user_sessions_is_suspicious ON user_sessions(is_suspicious);
CREATE INDEX IF NOT EXISTS idx_user_sessions_created_at ON user_sessions(created_at);

-- ==========================================
-- Table: account_sharing_alerts
-- ==========================================
CREATE TABLE IF NOT EXISTS account_sharing_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  alert_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'warning',
  description TEXT NOT NULL,
  ip_addresses TEXT,
  device_fingerprints TEXT,
  metadata TEXT,
  is_resolved INTEGER DEFAULT 0,
  resolved_at TEXT,
  resolved_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (resolved_by) REFERENCES users(id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_alerts_user_id ON account_sharing_alerts(user_id);
CREATE INDEX IF NOT EXISTS idx_alerts_created_at ON account_sharing_alerts(created_at);
CREATE INDEX IF NOT EXISTS idx_alerts_is_resolved ON account_sharing_alerts(is_resolved);

-- ==========================================
-- Table: trusted_devices
-- ==========================================
CREATE TABLE IF NOT EXISTS trusted_devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  device_fingerprint TEXT NOT NULL,
  device_name TEXT,
  last_used_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  is_active INTEGER DEFAULT 1,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(user_id, device_fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_trusted_devices_user ON trusted_devices(user_id);
