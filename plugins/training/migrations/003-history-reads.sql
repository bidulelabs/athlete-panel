-- Transactional, plugin-owned invalidation: no historical data copies or cross-schema triggers.
CREATE TABLE training.history_version (singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), revision bigint NOT NULL DEFAULT 0);
INSERT INTO training.history_version(singleton) VALUES(true);
CREATE FUNCTION training.advance_history_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE training.history_version SET revision=revision+1 WHERE singleton=true;
  RETURN NULL;
END $$;
CREATE TRIGGER history_changed AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON training.records
FOR EACH STATEMENT EXECUTE FUNCTION training.advance_history_version();
CREATE INDEX history_independent_date ON training.records (kind, (data#>>'{schedule,date}'), id) WHERE deleted=false;
CREATE INDEX history_plan_day ON training.records ((data#>>'{schedule,planId}'), ((data#>>'{schedule,day}')::integer), id) WHERE deleted=false AND data#>>'{schedule,kind}'='plan';
CREATE INDEX history_performed_date ON training.records ((data#>>'{completion,performedDate}'), id) WHERE deleted=false AND kind='workout';
CREATE INDEX history_plan_start ON training.records ((data->>'startDate'), id) WHERE deleted=false AND kind='plan';
