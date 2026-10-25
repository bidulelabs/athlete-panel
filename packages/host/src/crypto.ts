import { randomBytes, scrypt, scryptSync, timingSafeEqual, createHash, createCipheriv, createDecipheriv } from 'node:crypto';
import { AppError } from './errors';
export function digest(input: string): string { return createHash('sha256').update(input).digest('hex'); }
export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return '{' + Object.entries(value as Record<string, unknown>).filter(([,v]) => v !== undefined).sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => JSON.stringify(k)+':'+canonical(v)).join(',') + '}';
}
export function passwordHash(password: string) { const salt=randomBytes(16).toString('hex'); return `${salt}:${scryptSync(password,salt,64).toString('hex')}`; }
export function verifyPassword(password:string, encoded:string) {
  try { const [salt,hash]=encoded.split(':'); const actual=scryptSync(password,salt,64), expected=Buffer.from(hash,'hex'); return actual.length===expected.length && timingSafeEqual(actual,expected); } catch { return false; }
}
export async function verifyPasswordAsync(password: string, encoded: string): Promise<boolean> {
  const [salt, hash] = encoded.split(':');
  if (!salt || !hash) return false;
  const actual = await new Promise<Buffer>((resolve, reject) => scrypt(password, salt, 64, (error, key) => error ? reject(error) : resolve(key)));
  const expected = Buffer.from(hash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export function randomToken() { return randomBytes(32).toString('base64url'); }
function key() {
  const decoded=Buffer.from(process.env.ENCRYPTION_KEY ?? '', 'base64');
  if(decoded.length!==32) throw new AppError('encryption_unconfigured','ENCRYPTION_KEY must contain 32 random bytes encoded as base64.',503);
  return decoded;
}
export function encrypt(secret:string) {
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key(),iv);
  const ciphertext=Buffer.concat([cipher.update(secret,'utf8'),cipher.final()]);
  return [iv,cipher.getAuthTag(),ciphertext].map(x=>x.toString('base64')).join('.');
}
export function decrypt(value:string) {
  try { const [iv,tag,data]=value.split('.').map(x=>Buffer.from(x,'base64')); const cipher=createDecipheriv('aes-256-gcm',key(),iv); cipher.setAuthTag(tag); return Buffer.concat([cipher.update(data),cipher.final()]).toString('utf8'); }
  catch { throw new AppError('secret_unavailable','Secret cannot be decrypted with this instance key.',503); }
}
