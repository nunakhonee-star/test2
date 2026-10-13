import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

export const FT_URL='https://www.pea.co.th/en/our-services/tariff/ft?page=0';
export const BASE_URL='https://www.pea.co.th/news/corporate-news/2412';
const months={jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12};
export function plain(html){return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,'').replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;/gi,' ').replace(/&ndash;|&mdash;|&#8211;|&#8212;/gi,'-').replace(/&amp;/gi,'&').replace(/\s+/g,' ').trim();}
export function parseFt(html,checkedAt=new Date().toISOString()){
 const headings=[...html.matchAll(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/gi)].map(x=>plain(x[1])).filter(x=>/^Current Ft\b/i.test(x));
 if(headings.length!==1)throw Error('Expected one explicit Current Ft heading; source format changed');
 const m=headings[0].match(/^Current Ft\s*\(([A-Za-z]+)\s*[-–—]\s*([A-Za-z]+)\s+(20\d{2})\)\s*([+-]?\d+(?:\.\d+)?)\s*THB\s*\/\s*Unit$/i);
 if(!m)throw Error('Ft value, period or THB/Unit not explicit');
 const start=months[m[1].slice(0,3).toLowerCase()],end=months[m[2].slice(0,3).toLowerCase()],year=Number(m[3]),value=Number(m[4]);
 if(![1,5,9].includes(start)||end!==start+3||!Number.isFinite(value)||value < -10||value>10)throw Error('Unexpected Ft period or magnitude; manual review required');
 const ym=n=>year+'-'+String(n).padStart(2,'0');
 return {provider:'PEA',value,unit:'THB/kWh',from:ym(start),to:ym(end),checkedAt,sourceUrl:FT_URL,evidenceHash:createHash('sha256').update(headings[0]).digest('hex')};
}
export function baseFingerprint(html){
 const article=html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i);
 if(!article)throw Error('Residential announcement article not found');
 const text=plain(article[1]);
 if(!text.includes('1.1.1')||!text.includes('1.1.2')||text.length<200)throw Error('Residential announcement incomplete');
 return createHash('sha256').update(text).digest('hex');
}
export async function getHtml(url){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
 try{const response=await fetch(url,{signal:controller.signal,headers:{'User-Agent':'SolarOfficePro-TariffReference/1.0','Accept':'text/html'}});
  if(!response.ok)throw Error('Official source HTTP '+response.status);
  const final=new URL(response.url);if(final.protocol!=='https:'||final.hostname!=='www.pea.co.th')throw Error('Unexpected source redirect');
  if(!response.headers.get('content-type')?.includes('text/html'))throw Error('Official source did not return HTML');
  const reader=response.body.getReader();let length=0,chunks=[];
  while(true){const {value,done}=await reader.read();if(done)break;length+=value.length;if(length>2*1024*1024){await reader.cancel();throw Error('Official response exceeds 2 MB');}chunks.push(value);}
  return new TextDecoder().decode(Buffer.concat(chunks));
 }finally{clearTimeout(timer);}
}
export async function syncTariffs(previous,{load=getHtml,now=new Date().toISOString()}={}){
 const out=structuredClone(previous);out.lastAttemptAt=now;
 const results=await Promise.allSettled([load(FT_URL),load(BASE_URL)]);
 let success=true;out.errors=[];
 try{
  if(results[0].status==='rejected')throw results[0].reason;
  const record=parseFt(results[0].value,now);
  out.ftRecords=[...(out.ftRecords||[]).filter(x=>x.from!==record.from||x.to!==record.to),record].sort((a,b)=>a.from.localeCompare(b.from)).slice(-30);
  out.ftCheckedAt=now;
 }catch(error){success=false;out.errors.push('Ft: '+error.message);}
 try{
  if(results[1].status==='rejected')throw results[1].reason;
  const observedHash=baseFingerprint(results[1].value);
  out.base={...out.base,observedHash,lastCheckedAt:now,reviewRequired:!out.base?.acceptedHash||out.base.acceptedHash!==observedHash};
 }catch(error){success=false;out.errors.push('Base: '+error.message);}
 out.status=success?'ok':'degraded';if(success)out.lastSuccessAt=now;
 return out;
}
async function main(){
 const file=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../data/tariffs.json');
 const previous=JSON.parse(await readFile(file,'utf8'));
 const result=await syncTariffs(previous);
 await mkdir(path.dirname(file),{recursive:true});await writeFile(file+'.tmp',JSON.stringify(result,null,2)+'\n');await rename(file+'.tmp',file);
 console.log(JSON.stringify({status:result.status,ftCheckedAt:result.ftCheckedAt,baseReviewRequired:result.base.reviewRequired,errors:result.errors}));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
