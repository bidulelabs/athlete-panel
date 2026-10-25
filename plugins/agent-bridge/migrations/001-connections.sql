create schema if not exists agent_bridge;
create table agent_bridge.connections (
  id uuid primary key,
  token_hash text not null unique,
  code text not null,
  label text not null,
  status text not null default 'pending' check (status in ('pending','approved','denied','cancelled')),
  grant_id uuid,
  approval jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '10 minutes',
  last_polled_at timestamptz
);
create index connections_created_at on agent_bridge.connections(created_at);
