CREATE SCHEMA IF NOT EXISTS athlete;
CREATE TABLE athlete.records (kind text NOT NULL, id text NOT NULL, revision integer NOT NULL CHECK(revision>0), data jsonb NOT NULL, deleted boolean NOT NULL DEFAULT false, updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(kind,id));
CREATE INDEX records_local_date ON athlete.records ((data->>'localDate')) WHERE deleted=false;
