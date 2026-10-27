ALTER TABLE host.jobs ADD COLUMN priority integer NOT NULL DEFAULT 0;
CREATE INDEX jobs_priority_ready ON host.jobs(priority DESC, created_at, id) WHERE status='queued';
