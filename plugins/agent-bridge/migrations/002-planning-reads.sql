create table agent_bridge.planning_reads (
  grant_id uuid not null references host.grants(id) on delete cascade,
  digest text not null,
  snapshot jsonb not null,
  primary key (grant_id, digest)
);

-- Owner revocation, console recovery and restore all revoke grants in this table.
create function agent_bridge.forget_revoked_reads() returns trigger language plpgsql as $$
begin
  delete from agent_bridge.planning_reads where grant_id = new.id;
  return new;
end;
$$;
create trigger forget_revoked_planning_reads after update of revoked on host.grants
  for each row when (new.revoked and not old.revoked)
  execute function agent_bridge.forget_revoked_reads();
