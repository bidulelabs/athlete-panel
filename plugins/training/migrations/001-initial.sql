CREATE SCHEMA IF NOT EXISTS training;
CREATE TABLE training.records (kind text NOT NULL, id text NOT NULL, revision integer NOT NULL CHECK(revision>0), data jsonb NOT NULL, deleted boolean NOT NULL DEFAULT false, updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(kind,id));
CREATE INDEX records_local_date ON training.records ((data->>'localDate')) WHERE deleted=false;
CREATE UNIQUE INDEX workout_activity_link ON training.records ((data#>>'{completion,activityId}')) WHERE kind='workout' AND deleted=false AND data#>>'{completion,activityId}' IS NOT NULL;
