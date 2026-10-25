import { readdir,readFile } from 'node:fs/promises';
async function sourceFiles(dir:string):Promise<string[]>{const files:string[]=[];for(const e of await readdir(dir,{withFileTypes:true})){const p=`${dir}/${e.name}`;if(e.isDirectory())files.push(...await sourceFiles(p));else if(/\.tsx?$/.test(p))files.push(p);}return files;}
const errors:string[]=[];
for(const file of await sourceFiles('packages/host')){const text=await readFile(file,'utf8');if(/from ['"][^'"]*plugins\//.test(text))errors.push(`${file}: host imports feature code`);}
for(const file of await sourceFiles('personal-plugins')){const text=await readFile(file,'utf8');if(/from ['"][^'"]*(packages\/host|plugins\/[^/]+\/(repository|service|engine)|instance\/services)/.test(text))errors.push(`${file}: personal plugin bypasses public contracts`);}
for(const root of ['plugins','personal-plugins'])for(const file of await sourceFiles(root)){if(!file.endsWith('/client.tsx'))continue;const text=await readFile(file,'utf8');if(/from ['"](?:node:|[^'"]*(?:host\/src|\/repository|\/service|\/transport))/.test(text))errors.push(`${file}: client imports server implementation`);}
if(errors.length)throw new Error(errors.join('\n'));console.log('Host, personal plugin and client/server import boundaries checked.');
