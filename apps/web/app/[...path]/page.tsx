import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Workspace from '../workspace';
import { requireSession,SESSION_COOKIE } from '../../../../packages/host/src/auth';
export default async function Page({params,searchParams}:{params:Promise<{path:string[]}>;searchParams:Promise<Record<string,string|string[]|undefined>>}) {
  const {path}=await params;
  const query=await searchParams;
  const next=path.join('/')==='agent'&&typeof query.connect==='string'&&/^[a-f0-9-]{36}$/i.test(query.connect)?`/agent?connect=${query.connect}`:null;
  try {await requireSession((await cookies()).get(SESSION_COOKIE)?.value);}catch {redirect(next?`/login?next=${encodeURIComponent(next)}`:'/login');}
  return <Workspace initialPath={'/'+path.join('/')} />;
}
