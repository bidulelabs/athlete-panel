import { z } from 'zod';
import { AppError } from './errors';
export async function readJson(request:Request):Promise<unknown> {
  const limit=256*1024;
  if(Number(request.headers.get('content-length'))>limit) throw new AppError('too_large','Request is too large.',413);
  const reader=request.body?.getReader(); let size=0;const chunks:Uint8Array[]=[];
  if(reader) while(true) { const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();throw new AppError('too_large','Request is too large.',413);}chunks.push(value); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new AppError('invalid_json','A valid JSON body is required.'); }
}
export function json(value:unknown,status=200) { return Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Athlete-Panel-Contract':'1'}}); }
export function failure(error:unknown) {
  if(error instanceof z.ZodError) return json({error:{code:'validation',message:'Check the submitted values.',details:error.issues.map(i=>({path:i.path,message:i.message}))}},400);
  if(error instanceof AppError||(error instanceof Error && error.name==='DomainError' && 'status' in error && 'code' in error)) {
    const known=error as AppError;return json({error:{code:known.code,message:known.message,details:known.details}},known.status);
  }
  console.error(JSON.stringify({level:'error',event:'request_failed',type:error instanceof Error?error.name:'Unknown'}));
  return json({error:{code:'internal',message:'The request could not be completed. Your draft has been retained; retry after checking server status.'}},500);
}
