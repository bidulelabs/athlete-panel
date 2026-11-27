import { timingSafeEqual } from 'node:crypto';
import type { AppleHealthConnection, AppleHealthStatus } from '@athlete-panel/contracts';
import { digest, randomToken } from '../../packages/host/src/crypto';
import {
  connection,
  readTransaction,
  transaction,
  type Transaction,
} from '../../packages/host/src/db';
import { assert } from '../../packages/host/src/errors';

export const uploadPath = '/api/apple-health/workouts';
export type BatchResult = NonNullable<AppleHealthStatus['lastBatch']>;
type PairingRow = {
  connected: boolean;
  tested_at: Date | null;
  last_upload_at: Date | null;
};
type ConnectionRow = PairingRow & {
  imported_from: string | null;
  imported_to: string | null;
  last_batch: BatchResult | null;
  last_error: string | null;
};

function uploadUrl() {
  const origin = process.env.APP_ORIGIN;
  if (!origin || !URL.canParse(origin)) return null;
  const url = new URL(uploadPath, origin);
  if (
    url.protocol === 'https:' ||
    (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
  )
    return url.href;
  return null;
}

function pairingStatus(row?: PairingRow): AppleHealthConnection {
  return {
    uploadUrl: uploadUrl(),
    connected: row?.connected ?? false,
    testedAt: row?.tested_at?.toISOString() ?? null,
    lastUploadAt: row?.last_upload_at?.toISOString() ?? null,
  };
}

export async function readAppleHealthConnection() {
  const [row] = await connection()<PairingRow[]>`
    select token_hash is not null as connected,tested_at,last_upload_at
    from apple_health.connection where singleton`;
  return pairingStatus(row);
}

export async function connectionStatus(tx: Transaction): Promise<AppleHealthStatus> {
  const [row] = await tx<ConnectionRow[]>`
    select token_hash is not null as connected,tested_at,last_upload_at,
      imported_from::text,imported_to::text,last_batch,last_error
    from apple_health.connection where singleton`;
  const sources = await tx<{ name: string; excluded: boolean }[]>`
    select name,excluded from apple_health.sources order by name`;
  return {
    ...pairingStatus(row),
    importedFrom: row?.imported_from ?? null,
    importedTo: row?.imported_to ?? null,
    lastBatch: row?.last_batch ?? null,
    error: row?.last_error ?? null,
    sources: [...sources],
  };
}

export const status = () => readTransaction(connectionStatus);

export async function issueToken() {
  assert(
    uploadUrl(),
    'upload_url_unavailable',
    'Set the instance HTTPS origin before connecting Apple Health.',
    409,
  );
  const token = randomToken();
  return transaction(async (tx) => {
    await tx`update apple_health.connection
      set token_hash=${digest(token)},tested_at=null,last_error=null where singleton`;
    return { token, status: await connectionStatus(tx) };
  });
}

export async function disconnect() {
  return transaction(async (tx) => {
    await tx`update apple_health.connection set token_hash=null,tested_at=null,last_error=null where singleton`;
    return connectionStatus(tx);
  });
}

export async function requireUploadToken(hash: string, tx?: Transaction) {
  const sql = tx ?? connection();
  const [row] = await sql<{ token_hash: string | null }[]>`
    select token_hash from apple_health.connection where singleton`;
  assert(
    row?.token_hash &&
      timingSafeEqual(Buffer.from(row.token_hash, 'hex'), Buffer.from(hash, 'hex')),
    'unauthorized',
    'Check the Apple Health upload token on the iPhone.',
    401,
  );
}

export async function updateImportStatus(
  tx: Transaction,
  batch: BatchResult,
  from: string | null,
  to: string | null,
) {
  await tx`update apple_health.connection set last_upload_at=now(),
    imported_from=least(imported_from,${from}::date), imported_to=greatest(imported_to,${to}::date),
    last_batch=${tx.json(batch)},last_error=null where singleton`;
}

export async function recordUploadError(hash: string, message: string) {
  await transaction(async (tx) => {
    // A request that failed after the owner rotated the token belongs to the old connection.
    await tx`update apple_health.connection set last_error=${message} where singleton and token_hash=${hash}`;
  });
}

export type WorkoutIdentity = {
  uuid: string;
  activity_id: string;
  sent_at: Date;
  deleted: boolean;
};

export async function identities(tx: Transaction, uuids: string[]) {
  if (!uuids.length) return new Map<string, WorkoutIdentity>();
  const rows = await tx<WorkoutIdentity[]>`
    select uuid,activity_id,sent_at,deleted from apple_health.workouts where uuid=any(${uuids}::uuid[])`;
  return new Map(rows.map((row) => [row.uuid, row]));
}

export async function saveIdentities(tx: Transaction, records: WorkoutIdentity[]) {
  for (let start = 0; start < records.length; start += 200) {
    const rows = records.slice(start, start + 200);
    await tx`insert into apple_health.workouts ${tx(rows, 'uuid', 'activity_id', 'sent_at', 'deleted')}
      on conflict(uuid) do update set sent_at=excluded.sent_at,deleted=excluded.deleted`;
  }
}
