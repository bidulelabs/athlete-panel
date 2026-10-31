-- Transactional, plugin-owned invalidation: no historical data copies or cross-schema triggers.
CREATE TABLE athlete.history_version (singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), revision bigint NOT NULL DEFAULT 0);
INSERT INTO athlete.history_version(singleton) VALUES(true);
CREATE FUNCTION athlete.advance_history_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE athlete.history_version SET revision=revision+1 WHERE singleton=true;
  RETURN NULL;
END $$;
CREATE TRIGGER history_changed AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON athlete.records
FOR EACH STATEMENT EXECUTE FUNCTION athlete.advance_history_version();
CREATE INDEX history_injury_dates ON athlete.records ((data->>'startDate'), (data->>'endDate'), id) WHERE deleted=false AND kind='injury';
