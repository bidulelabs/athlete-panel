import { readFile,readdir,stat } from 'node:fs/promises';
import { resolve,dirname } from 'node:path';
const roots=['SECURITY.md','CONTRIBUTING.md','docs/release-readiness.md','README.md','AGENTS.md','PRODUCT.md','DESIGN.md','docs/architecture.md','docs/development.md','docs/features','docs/decisions','docs/plans','.agents/skills','.claude/skills'];
const files:string[]=[];
async function walk(path:string){const info=await stat(path);if(info.isDirectory())for(const child of await readdir(path))await walk(`${path}/${child}`);else if(path.endsWith('.md'))files.push(path);}
for(const root of roots)await walk(root);
const errors:string[]=[];
for(const file of files){
  const text=await readFile(file,'utf8');
  if(/\{\{[A-Z_]+\}\}/.test(text))errors.push(`${file}: unresolved template placeholder`);
  for(const match of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)){
    const [link,anchor]=match[1].split('#');if(!link||/^[a-z]+:/i.test(link))continue;
    const target=resolve(dirname(file),link);
    if(!await stat(target).catch(()=>null))errors.push(`${file}: missing link ${link}`);
    else if(anchor&&target.endsWith('.md')){
      const body=await readFile(target,'utf8');
      const headings=[...body.matchAll(/^#{1,6}\s+(.+)$/gm)].map(h=>h[1].toLowerCase().replace(/[^\p{L}\p{N}_ -]/gu,'').trim().replace(/ /g,'-'));
      if(!headings.includes(decodeURIComponent(anchor)))errors.push(`${file}: missing anchor ${link}#${anchor}`);
    }
  }
  if(file.startsWith('docs/features/')&&!['Purpose and scope','Intended behavior','Acceptance scenarios','Observed implementation'].every(h=>text.includes(h)))errors.push(`${file}: required feature sections missing`);
  if(file.startsWith('docs/decisions/')&&!/Status: (proposed|accepted|rejected|superseded|unconfirmed)\b/.test(text))errors.push(`${file}: ADR status missing`);
}
if(errors.length)throw new Error(errors.join('\n'));console.log(`Documentation content and local links checked (${files.length} files).`);
