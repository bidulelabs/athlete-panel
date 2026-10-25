import { cookies } from 'next/headers';
import { logout,requireOrigin,SESSION_COOKIE } from '../../../../../../packages/host/src/auth';
import { failure,json } from '../../../../../../packages/host/src/http';
export async function POST(request:Request){try{requireOrigin(request);const jar=await cookies();await logout(jar.get(SESSION_COOKIE)?.value);jar.delete(SESSION_COOKIE);return json({ok:true});}catch(e){return failure(e);}}
