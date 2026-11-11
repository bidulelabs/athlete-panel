import type { Activity } from '@athlete-panel/contracts';
import { transaction, type Transaction } from '../../packages/host/src/db';
import { enqueue, type Job } from '../../packages/host/src/jobs';
import { autoLinkImportedActivities } from '../training/public/server';
import type { SyncCoverage } from './sync';

export async function stageActivityMatches(
  tx: Transaction,
  jobId: string,
  coverage: SyncCoverage,
  activities: Activity[],
) {
  if (coverage.stream !== 'activities') return;
  if (activities.length)
    await tx`insert into garmin.activity_matches ${tx(
      activities.map((activity) => ({
        activity_id: activity.id,
        import_job_id: jobId,
        phase: coverage.phase,
        source_account_id: activity.provenance!.sourceAccountId,
        local_date: activity.localDate,
      })),
    )} on conflict(activity_id) do nothing`;
  if (
    coverage.scanState === 'unavailable' ||
    (coverage.scanState === 'scanned' && coverage.rejectedRecords > 0)
  ) {
    await tx`delete from garmin.activity_matches where import_job_id=${jobId} and phase=${coverage.phase}`;
  } else if (coverage.scanState === 'scanned') {
    await tx`update garmin.activity_matches set ready=true where import_job_id=${jobId} and phase=${coverage.phase}`;
    await scheduleActivityMatching(tx);
  }
}

export async function scheduleActivityMatching(tx: Transaction) {
  await tx`delete from garmin.activity_matches m where not exists(select 1 from host.jobs j where j.id=m.import_job_id and j.status<>'cancelled')`;
  const [pending] = await tx`select activity_id from garmin.activity_matches where ready limit 1`;
  if (pending) await enqueue(tx, 'garmin', 'garmin-match-activities', {}, 40);
}

/** One calendar date per claim keeps each locked transaction bounded to a day's candidates. */
export async function runActivityMatchingJob(job: Job) {
  await transaction(async (tx) => {
    const [lease] =
      await tx`select id from host.jobs where id=${job.id} and status='running' and lease_owner=${job.lease_owner} and lease_until>now() for update`;
    if (!lease) return;
    const [setting] = await tx`select value from host.settings where key='garmin'`;
    const config = setting?.value;
    if (!config?.encryptedKey || config.paused) {
      await tx`update host.jobs set status=${config?.encryptedKey ? 'paused' : 'cancelled'},lease_owner=null,lease_until=null where id=${job.id}`;
      if (!config?.encryptedKey) await tx`delete from garmin.activity_matches`;
      return;
    }
    if (config.verifiedGeneration !== config.generation) {
      await tx`update host.jobs set status='queued',lease_owner=null,lease_until=null,next_run_at=now()+interval '1 minute' where id=${job.id}`;
      return;
    }
    await tx`delete from garmin.activity_matches m where not exists(select 1 from host.jobs j where j.id=m.import_job_id and j.status<>'cancelled')`;
    const [day] = await tx<
      { date: string }[]
    >`select local_date::text as date from garmin.activity_matches where ready and source_account_id=${config.accountId} order by local_date limit 1`;
    let linked = 0;
    if (day) {
      const candidates = await tx<
        { id: string }[]
      >`select activity_id as id from garmin.activity_matches where ready and source_account_id=${config.accountId} and local_date=${day.date}`;
      linked = await autoLinkImportedActivities(
        tx,
        day.date,
        candidates.map((item) => item.id),
      );
      await tx`delete from garmin.activity_matches where activity_id=any(${candidates.map((item) => item.id)})`;
    }
    const [remaining] =
      await tx`select activity_id from garmin.activity_matches where ready and source_account_id=${config.accountId} limit 1`;
    await tx`update host.jobs set status=${remaining ? 'queued' : 'completed'},progress=${tx.json({ label: day ? `Checked ${day.date}: ${linked} workouts linked` : 'Activity matching complete' })},attempts=0,error=null,lease_owner=null,lease_until=null,next_run_at=now(),updated_at=now() where id=${job.id}`;
  });
}
