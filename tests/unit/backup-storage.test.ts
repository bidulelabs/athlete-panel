import { afterEach, expect, it } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { storageMount, verifyStorage } from '../../scripts/lib/backup-storage';
const original = { database:process.env.DATABASE_URL, origin:process.env.APP_ORIGIN };
afterEach(()=>{if(original.database===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=original.database;if(original.origin===undefined)delete process.env.APP_ORIGIN;else process.env.APP_ORIGIN=original.origin;});
it('identifies the enclosing network mount, escaped paths and a missing-mount local fallback',()=>{
 const mounts='1 0 8:1 / / rw - ext4 /dev/root rw\n2 1 0:40 / /mnt/off\\040host rw - nfs4 storage.example:/backups rw';
 expect(storageMount('/mnt/off host/athlete-panel',mounts)).toMatchObject({filesystem:'nfs4',remote:true,source:'storage.example:/backups'});
 expect(storageMount('/mnt/off host/athlete-panel',mounts.split('\n')[0])).toMatchObject({remote:false});
});
it('fails closed for a missing/changed marker and forbids synthetic storage on real instances',async()=>{
 const root=await mkdtemp(join(tmpdir(),'athlete-panel-storage-test-')),id=randomUUID(),policy=join(root,'policy.json');
 try{
  await writeFile(policy,JSON.stringify({version:1,id,mountFingerprint:'0'.repeat(64),testOnly:true}));
  process.env.DATABASE_URL='postgres://synthetic:synthetic@db/athlete_panel_test';process.env.APP_ORIGIN='https://localhost:4443';
  await expect(verifyStorage(root,policy)).rejects.toThrow();
  await writeFile(join(root,'.athlete-panel-storage-id'),id);await expect(verifyStorage(root,policy)).resolves.toBe('isolated-test');
  process.env.APP_ORIGIN='https://training.example.com';await expect(verifyStorage(root,policy)).rejects.toThrow('forbidden');
  await writeFile(join(root,'.athlete-panel-storage-id'),randomUUID());await expect(verifyStorage(root,policy)).rejects.toThrow('identity');
 }finally{await rm(root,{recursive:true,force:true});}
});
