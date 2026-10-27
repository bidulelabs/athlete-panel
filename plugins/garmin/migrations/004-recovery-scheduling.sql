CREATE TABLE garmin.scan_state (
  stream text PRIMARY KEY,
  reconcile_cursor jsonb,
  unavailable boolean NOT NULL DEFAULT false,
  needs_retry boolean NOT NULL DEFAULT false,
  last_scheduled_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE garmin.scheduler (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  next_reconcile_at timestamptz NOT NULL DEFAULT now(),
  blocked_until timestamptz
);
