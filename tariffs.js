const SOURCE='https://www.pea.co.th/en/our-services/tariff/ft?page=0';
const monthPattern=/^20\d{2}-(0[1-9]|1[0-2])$/;
export function validateFeed(data){
 if(data?.schemaVersion!==1||!Array.isArray(data.ftRecords)||data.ftRecords.length>30||!['ok','degraded'].includes(data.status))throw Error('รูปแบบข้อมูลอัตราไม่รองรับ');
 if(!Number.isFinite(Date.parse(data.lastAttemptAt))||!data.base||typeof data.base.reviewRequired!=='boolean')throw Error('ข้อมูลวันที่หรือสถานะอัตราฐานไม่ครบ');
 for(const r of data.ftRecords){if(r.provider!=='PEA'||r.sourceUrl!==SOURCE||r.unit!=='THB/kWh'||typeof r.value!=='number'||!Number.isFinite(r.value)||r.value < -10||r.value>10||!monthPattern.test(r.from)||!monthPattern.test(r.to)||r.from.slice(0,4)!==r.to.slice(0,4)||![1,5,9].includes(Number(r.from.slice(5)))||Number(r.to.slice(5))!==Number(r.from.slice(5))+3||!Number.isFinite(Date.parse(r.checkedAt)))throw Error('ข้อมูล Ft ไม่ผ่านการตรวจค่า หน่วย แหล่งอ้างอิง หรือรอบเดือน');}
 const keys=data.ftRecords.map(r=>r.from);if(new Set(keys).size!==keys.length)throw Error('ข้อมูล Ft มีรอบเดือนซ้ำ');
 return data;
}
export function selectFt(data,month,now=Date.now()){
 const matches=data.ftRecords.filter(r=>monthPattern.test(month)&&month>=r.from&&month<=r.to);
 if(matches.length!==1)return null;
 const r=matches[0],age=now-Date.parse(r.checkedAt);
 return {...r,stale:age>7*86400000||age < -86400000,feedDegraded:data.status!=='ok',baseReviewRequired:data.base.reviewRequired};
}
export async function loadTariffs({fetcher=fetch,url=new URL('./data/tariffs.json',import.meta.url),timeout=5000}={}){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);
 try{const response=await fetcher(url,{signal:controller.signal,cache:'no-store'});if(!response.ok)throw Error('โหลดข้อมูลอัตราไม่สำเร็จ');const raw=await response.text();if(raw.length>100000)throw Error('ข้อมูลอัตรามีขนาดผิดปกติ');return validateFeed(JSON.parse(raw));}finally{clearTimeout(timer);}
}
