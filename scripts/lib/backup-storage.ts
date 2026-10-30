import { createHash } from 'node:crypto';
import { readFile, lstat } from 'node:fs/promises';
import { resolve, join, sep } from 'node:path';

export type StoragePolicy = {
  version: 1;
  id: string;
  mountFingerprint: string;
  testOnly?: boolean;
};
const remoteFilesystems = new Set(['nfs', 'nfs4', 'cifs', 'smb3', 'fuse.sshfs']);
const unescapeMount = (value: string) =>
  value.replace(/\\([0-7]{3})/g, (_, octal) => String.fromCharCode(parseInt(octal, 8)));

export function storageMount(destination: string, mountInfo: string) {
  const path = resolve(destination);
  const mounts = mountInfo
    .trim()
    .split('\n')
    .flatMap((line) => {
      const [left, right] = line.split(' - ');
      if (!right) return [];
      const fields = left.split(' '),
        [filesystem, source] = right.split(' ');
      const mount = unescapeMount(fields[4] ?? '');
      if (path !== mount && !path.startsWith(mount === '/' ? '/' : mount + sep)) return [];
      return [{ mount, filesystem, source: unescapeMount(source) }];
    })
    .sort((a, b) => b.mount.length - a.mount.length);
  if (!mounts.length) throw new Error('Backup storage mount could not be identified.');
  const found = mounts[0];
  return {
    ...found,
    remote: remoteFilesystems.has(found.filesystem),
    fingerprint: createHash('sha256').update(`${found.filesystem}\0${found.source}`).digest('hex'),
  };
}

/** A marker alone does not prove remote storage: require the same network filesystem too. */
export async function verifyStorage(
  destination: string,
  policyFile = process.env.BACKUP_STORAGE_POLICY,
  mode = process.env.BACKUP_STORAGE_MODE,
): Promise<'local' | 'remote-mount' | 'unverified' | 'isolated-test'> {
  if (mode && mode !== 'local' && mode !== 'remote')
    throw new Error('Invalid backup storage mode. Choose local or remote.');
  if (mode === 'local') {
    if (policyFile)
      throw new Error(
        'Local mode conflicts with a registered remote policy; fallback is forbidden.',
      );
    const directory = await lstat(destination);
    if (
      !directory.isDirectory() ||
      directory.isSymbolicLink() ||
      directory.mode & 0o077 ||
      (process.getuid && directory.uid !== process.getuid())
    )
      throw new Error('Local backup storage must be an existing owner-only directory (0700).');
    return 'local';
  }
  if (mode === 'remote' && !policyFile)
    throw new Error('Remote backup storage requires its registered policy; fallback is forbidden.');
  if (!policyFile) return 'unverified'; // Advanced/local backups remain possible, explicitly unverified.
  const policy = JSON.parse(await readFile(policyFile, 'utf8')) as StoragePolicy;
  if (
    policy.version !== 1 ||
    !/^[a-f0-9-]{36}$/.test(policy.id) ||
    !/^[a-f0-9]{64}$/.test(policy.mountFingerprint)
  )
    throw new Error('Invalid backup storage policy.');
  const directory = await lstat(destination);
  if (!directory.isDirectory() || directory.isSymbolicLink())
    throw new Error('Backup destination must be the registered directory.');
  const marker = join(destination, '.athlete-panel-storage-id');
  const info = await lstat(marker);
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    (await readFile(marker, 'utf8')).trim() !== policy.id
  )
    throw new Error('Backup storage identity changed or is unavailable.');
  if (policy.testOnly) {
    const database = new URL(process.env.DATABASE_URL ?? ''),
      origin = new URL(process.env.APP_ORIGIN ?? '');
    if (
      !database.pathname.endsWith('_test') ||
      !['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)
    )
      throw new Error('Synthetic backup storage is forbidden for a hosted owner instance.');
    return 'isolated-test';
  }
  const mount = storageMount(destination, await readFile('/proc/self/mountinfo', 'utf8'));
  if (!mount.remote || mount.fingerprint !== policy.mountFingerprint)
    throw new Error('The registered remote backup mount is unavailable or changed.');
  return 'remote-mount';
}
