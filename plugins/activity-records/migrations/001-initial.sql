CREATE SCHEMA IF NOT EXISTS activity_records;
CREATE TABLE activity_records.records (kind text NOT NULL, id text NOT NULL, revision integer NOT NULL CHECK(revision>0), data jsonb NOT NULL, deleted boolean NOT NULL DEFAULT false, updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(kind,id));
CREATE INDEX records_local_date ON activity_records.records ((data->>'localDate')) WHERE deleted=false;
CREATE UNIQUE INDEX records_external ON activity_records.records (kind,(data->>'externalId')) WHERE deleted=false;
