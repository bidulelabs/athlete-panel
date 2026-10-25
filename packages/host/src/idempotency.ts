import { z } from 'zod';
import type { Transaction } from './db';
import { digest, canonical } from './crypto';
import { assert } from './errors';

export async function idempotent<T>(tx:Transaction,key:string,payload:unknown,run:()=>Promise<T>):Promise<T> {
  z.uuid().parse(key);
  const fingerprint=digest(canonical(payload));
  const [old]=await tx`select fingerprint,result from host.idempotency where key=${key}`;
  if(old) { assert(old.fingerprint===fingerprint,'idempotency_conflict','This idempotency key was used for different content.',409); return old.result as T; }
  const result=await run();
  await tx`insert into host.idempotency(key,fingerprint,result) values(${key},${fingerprint},${tx.json(result as never)})`;
  return result;
}
