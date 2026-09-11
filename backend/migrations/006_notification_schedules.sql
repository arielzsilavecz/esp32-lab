ALTER TABLE push_subscriptions
  ADD COLUMN IF NOT EXISTS schedule_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS schedule_days SMALLINT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS schedule_start TIME,
  ADD COLUMN IF NOT EXISTS schedule_end TIME,
  ADD COLUMN IF NOT EXISTS schedule_timezone TEXT NOT NULL
    DEFAULT 'America/Argentina/Buenos_Aires';

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_notification_modes
  ON push_subscriptions (enabled, schedule_enabled)
  WHERE enabled = true OR schedule_enabled = true;
