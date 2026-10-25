/** Archive primitives shared by backup and restore; no executable entry points. */
import { stat, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import type { ReleasedImage } from './release-data';
export const BACKUP_MAGIC = Buffer.from('ATHLETE-PANEL-BACKUP-1\n');
export type BackupMetadata = { format: 1; createdAt: string; kind: 'manual' | 'daily'; encryptionKeyFingerprint: string; postgresVersion: string; migrations: Array<{ plugin_id: string; name: string; checksum: string }>; tables: string[]; composition: Array<{ id: string; version: string; enabled: boolean }>; publicConfiguration: { appOrigin: string | null; cookieSecure: boolean }; release?: ReleasedImage };
export type BackupOptions = { databaseUrl: string; keyFile: string; encryptionKey: string; destination: string; root?: string; kind?: 'manual' | 'daily'; now?: Date; pgBinDirectory?: string };

export function decodeKey(value: string, purpose: string): Buffer {
  const encoded = value.trim();
  if (!/^[A-Za-z0-9+/]{43}=$/.test(encoded)) throw new Error(`${purpose} must be a base64-encoded 32-byte key.`);
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== 32) throw new Error(`${purpose} must contain 32 bytes.`);
  return key;
}
export async function loadBackupKey(path: string): Promise<Buffer> {
  if (!path) throw new Error('BACKUP_KEY_FILE is required and must be kept separately from backup archives.');
  const info = await stat(path);
  if (!info.isFile() || (process.platform !== 'win32' && (info.mode & 0o077) !== 0)) throw new Error('Backup key must be a regular file readable only by its owner (mode 0600).');
  return decodeKey(await readFile(path, 'utf8'), 'Backup key');
}
export function databaseEnvironment(databaseUrl: string): NodeJS.ProcessEnv {
  const url = new URL(databaseUrl);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.pathname.slice(1)) throw new Error('Use a valid PostgreSQL DATABASE_URL.');
  return { ...process.env, PGHOST: url.hostname, PGPORT: url.port || '5432', PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password), PGDATABASE: decodeURIComponent(url.pathname.slice(1)), ...(url.searchParams.get('sslmode') ? { PGSSLMODE: url.searchParams.get('sslmode')! } : {}) };
}
export async function pgCommand(program: 'pg_dump' | 'pg_restore', args: string[], databaseUrl: string, directory = process.env.PG_BIN_DIR): Promise<void> {
  await new Promise<void>((resolveResult, reject) => {
    const child = spawn(directory ? join(directory, program) : program, args, { env: databaseEnvironment(databaseUrl), stdio: ['ignore', 'ignore', 'pipe'] });
    child.stderr.resume();
    child.on('error', () => reject(new Error(`${program} could not start. Install matching PostgreSQL client tools or set PG_BIN_DIR.`)));
    child.on('close', code => code === 0 ? resolveResult() : reject(new Error(`${program} failed with exit code ${code}; the operation did not complete.`)));
  });
}
