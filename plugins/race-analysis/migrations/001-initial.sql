create schema if not exists race_analysis;

-- Immutable source files and their versioned, bounded display projection live together in backups.
create table race_analysis.assets (
  id uuid primary key,
  race_id uuid not null,
  filename text not null,
  format text not null check (format in ('gpx','fit')),
  source bytea not null check (octet_length(source) between 1 and 10485760),
  sha256 text not null,
  analysis jsonb not null,
  analysis_version integer not null default 1,
  imported_at timestamptz not null default now()
);
create index assets_race_idx on race_analysis.assets(race_id);

-- Race identity remains owned by Training. A logical reference survives soft deletion/undo.
create table race_analysis.courses (
  race_id uuid primary key,
  revision integer not null check (revision > 0),
  asset_id uuid references race_analysis.assets(id),
  terrain integer not null default 3 check (terrain between 1 and 5),
  section_terrain jsonb not null default '{}',
  updated_at timestamptz not null default now()
);
create table race_analysis.reference_efforts (
  id uuid primary key,
  race_id uuid not null references race_analysis.courses(race_id),
  asset_id uuid not null references race_analysis.assets(id),
  title text not null,
  duration_seconds double precision,
  duration_source text not null check (duration_source in ('file','owner','missing')),
  terrain integer not null check (terrain between 1 and 5),
  check (duration_seconds is null or duration_seconds > 0)
);
create index reference_efforts_race_idx on race_analysis.reference_efforts(race_id);
