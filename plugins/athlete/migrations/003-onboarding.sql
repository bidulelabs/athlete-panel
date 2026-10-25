-- Coordinated lifecycle metadata: upgrading owners are never treated as new.
insert into host.settings(key,value)
select 'onboarding', jsonb_build_object(
  'version',1,'status','existing-owner','step',1,'revision',1,
  'updatedAt',to_char(now() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'completedAt',null
) from host.owner where id='owner'
on conflict(key) do nothing;
