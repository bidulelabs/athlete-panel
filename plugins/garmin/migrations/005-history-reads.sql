-- Transactional, plugin-owned invalidation: no historical data copies or cross-schema triggers.
CREATE TABLE garmin.history_version (singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), revision bigint NOT NULL DEFAULT 0);
INSERT INTO garmin.history_version(singleton) VALUES(true);
CREATE FUNCTION garmin.advance_history_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE garmin.history_version SET revision=revision+1 WHERE singleton=true;
  RETURN NULL;
END $$;
CREATE TRIGGER history_changed AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON garmin.coverage
FOR EACH STATEMENT EXECUTE FUNCTION garmin.advance_history_version();
