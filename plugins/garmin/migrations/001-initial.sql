CREATE SCHEMA IF NOT EXISTS garmin;
CREATE TABLE garmin.coverage (stream text NOT NULL, start_date date NOT NULL, end_date date NOT NULL, status text NOT NULL, records integer NOT NULL DEFAULT 0, error text, updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(stream,start_date,end_date));
