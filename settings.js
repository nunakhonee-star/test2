const {normalizeLocations}=await import(new URL('./catalog.js'+new URL(import.meta.url).search,import.meta.url));
const $=id=>document.getElementById(id);
const COMPANY_FIELDS=[['company_name','ชื่อบริษัท','text'],['phone','เบอร์โทร','tel'],['email','อีเมล','email'],['tax_id','เลขประจำตัวผู้เสียภาษี','text'],['address','ที่อยู่บริษัท','textarea'],['quote_valid_days','อายุใบเสนอราคา (วัน)','number'],['payment_terms','เงื่อนไขการชำระเงิน','textarea'],['warranty_terms','เงื่อนไขการรับประกัน','textarea'],['document_footer','ข้อความท้ายเอกสาร','textarea']];
export const SETTING_FIELDS=[
 ['yieldPerKwpMonth','ผลผลิตไฟฟ้า (kWh/kWp/เดือน)',1,400,125],
 ['batteryDod','สัดส่วนความจุแบตที่ใช้ได้ (%)',10,100,90,100],
 ['batteryEff','ประสิทธิภาพจ่ายไฟแบตถึงโหลด AC (%)',10,100,95,100],
 ['batteryRoundTripEff','ประสิทธิภาพรอบชาร์จ–จ่ายไฟ (%)',10,100,90,100],
 ['batteryReserve','ตัวคูณเผื่อแบตเตอรี่',1,3,1.1],
 ['tariffGrowth','สมมติฐานค่าไฟส่วนแปรผันเพิ่มต่อปี (%) — ไม่ใช่ Ft ทางการ',-20,50,2.5,100],
 ['degradation','แผงเสื่อมต่อปี (%)',0,10,.5,100],
 ['discount','อัตราคิดลด (%)',0,50,8,100],
 ['co2KgPerKwh','การลด CO₂ (kg/kWh)',0,5,.5664],
 ['residentialRate','พลังงานรวม Ft ก่อน VAT: บ้าน (บาท/kWh ประมาณ)',.01,100,4.2],
 ['businessRate','พลังงานรวม Ft ก่อน VAT: ธุรกิจ (บาท/kWh ประมาณ)',.01,100,4.8],
 ['industrialRate','พลังงานรวม Ft ก่อน VAT: โรงงาน (บาท/kWh ประมาณ)',.01,100,4.5],
 ['dayPercent','% กลางวัน สำหรับโหมดกลางวัน',0,100,90],
 ['nightPercent','% กลางวัน สำหรับโหมดกลางคืน',0,100,10],
 ['bothPercent','% กลางวัน สำหรับโหมดทั้งคู่',0,100,50],
 ['minimumBill','ยอดคงเหลือขั้นต่ำเพื่อประเมินแบบเผื่อ (บาท/เดือน ไม่ใช่อัตราทางการ)',150,300,200],
 ['onGridSavingsCap','เพดานลดบิล On-Grid (%)',50,60,60,100],
 ['hybridSavingsCap','เพดานประเมินลดบิล Hybrid (%)',0,60,60,100],
 ['onGridBalanceCost','งานประกอบเฉพาะ On-Grid เพิ่มจาก BOQ (บาท ก่อน Margin/VAT)',0,10000000,0],
 ['hybridBalanceCost','งานประกอบ/ป้องกันเฉพาะ Hybrid เพิ่มจาก BOQ (บาท ก่อน Margin/VAT)',0,10000000,5000],
 ['batteryPricePerKwh','ราคาแบตประเมินเมื่อไม่มีราคาขาย (บาท/kWh)',1,1000000,9000],
 ['roofAreaPerPanel','พื้นที่แผงอ้างอิง 550 W (ตร.ม./แผง)',1,10,2.6],
 ['roofLayoutFactor','ตัวคูณเผื่อทางเดิน/จัดวางหลังคา',1,3,1.2],
];
export function normalizeCalculation(values={}) {
 const out={modelVersion:15,financialScope:'before_future_costs'};
 out.locationTypes=values.locationTypes?normalizeLocations(values.locationTypes):null;
 values={...values};
 if(!(Number(values.modelVersion)>=13)){
  if(Number(values.tariffGrowth)===0)values.tariffGrowth=2.5;

 }
 values.hybridSavingsCap=Math.min(60,Number(values.hybridSavingsCap??60));
 for(const [key,label,min,max,initial] of SETTING_FIELDS){
  const value=values[key]??initial;
  if(value===''||typeof value==='boolean'||!Number.isFinite(Number(value))||Number(value)<min||Number(value)>max)throw Error(label+' ต้องอยู่ระหว่าง '+min+'–'+max);
  if((/Year2?$/.test(key)||['exportApproved','exportYears'].includes(key))&&!Number.isInteger(Number(value)))throw Error(label+' ต้องเป็นจำนวนเต็ม');
  out[key]=Number(value);
 }
 if(!(out.dayPercent>=out.bothPercent&&out.bothPercent>=out.nightPercent))throw Error('สัดส่วนกลางวันต้องเรียง: โหมดกลางวัน ≥ ทั้งคู่ ≥ กลางคืน');
 if(values.tariffConfig!=null){
  const c=values.tariffConfig;if(typeof c!=='object'||Array.isArray(c))throw Error('รูปแบบการตั้งค่าอัตราไม่ถูกต้อง');
  const billingMode=['auto','estimate','pea111','pea112'].includes(c.billingMode)?c.billingMode:'estimate';
  const serviceCharge=c.serviceCharge??'';if(serviceCharge!==''&&(!Number.isFinite(Number(serviceCharge))||Number(serviceCharge)<0))throw Error('ค่าบริการต้องไม่ติดลบ');
  out.tariffConfig={billingMode,serviceCharge};
 }

 return out;
}
export function applyCalculation(values,modules){
 const normalized=normalizeCalculation(values);
 for(const [key,,,,,divisor] of SETTING_FIELDS)if(key in modules.DEFAULTS)modules.DEFAULTS[key]=normalized[key]/(divisor||1);
 modules.DEFAULTS.locationTypes=normalized.locationTypes;
 Object.assign(modules.BILL_RATES,{residential:normalized.residentialRate,business:normalized.businessRate,industrial:normalized.industrialRate});
 Object.assign(modules.PERIOD_DEFAULTS,{day:normalized.dayPercent,night:normalized.nightPercent,both:normalized.bothPercent});
 return normalized;
}
export async function validatePng(file){
 if(!file||!file.size||file.size>2*1024*1024)throw Error('เลือกไฟล์ PNG ขนาดไม่เกิน 2 MB');
 const bytes=new Uint8Array(await file.slice(0,8).arrayBuffer());
 if(![137,80,78,71,13,10,26,10].every((b,i)=>bytes[i]===b))throw Error('ไฟล์นี้ไม่ใช่ PNG ที่ถูกต้อง');
 const bitmap=await createImageBitmap(file).catch(()=>{throw Error('ไม่สามารถอ่านรูป PNG นี้ได้');});
 const valid=bitmap.width<=4096&&bitmap.height<=4096;bitmap.close();
 if(!valid)throw Error('โลโก้ต้องมีความกว้างและสูงไม่เกิน 4096 พิกเซล');
 return file;
}
const PRICE_KEYS=['onGridBalanceCost','hybridBalanceCost','batteryPricePerKwh'];
function settingInput([key,label,min,max,initial]){return `<label>${label}<input id="cs_${key}" form="calculationForm" type="number" min="${min}" max="${max}" step="${/Year2?$/.test(key)||['exportApproved','exportYears'].includes(key)?'1':'any'}" value="${initial}" required></label>`;}
export function settingsMarkup(equipment,appliances,pricing){
 const company=COMPANY_FIELDS.map(([key,label,type])=>`<label>${label}${type==='textarea'?`<textarea id="co_${key}" maxlength="3000"></textarea>`:`<input id="co_${key}" type="${type}" ${key==='company_name'?'required maxlength="160"':key==='quote_valid_days'?'min="1" max="365" step="1" value="30"':'maxlength="250"'}>`}</label>`).join('');
 return `<section id="settings" class="page"><div class="head"><h1>ตั้งค่าระบบ</h1></div><p id="settingsStatus" role="status" class="settings-notice">กำลังรอเชื่อมต่อฐานข้อมูล</p>
 <nav class="settings-tabs" aria-label="หมวดการตั้งค่า">${[['company','บริษัทและเอกสาร'],['equipment','อุปกรณ์และโหลดสำรอง'],['pricing','ราคา'],['calculation','การคำนวณและคืนทุน']].map(([id,label])=>`<button type="button" class="btn ${id==='company'?'active':''}" data-settings-tab="${id}" aria-pressed="${id==='company'}">${label}</button>`).join('')}</nav>
 <div data-settings-panel="company"><form id="companyForm" class="panel form"><h3>บริษัทและเอกสาร</h3><div class="company-preview"><img id="companyLogoPreview" alt="ตัวอย่างโลโก้บริษัท" hidden><div><b id="companyNamePreview">Solar Office Pro</b><small>โลโก้และชื่อบริษัทที่แสดงบนหน้าเว็บ</small></div></div><div class="grid2">${company}</div><label>โลโก้บริษัท PNG<input type="file" id="companyLogoFile" accept="image/png,.png"><small>สูงสุด 2 MB • ไม่เกิน 4096 × 4096 พิกเซล • รองรับพื้นหลังโปร่งใส</small></label><label class="check"><input type="checkbox" id="removeCompanyLogo"><span>นำโลโก้ปัจจุบันออกเมื่อบันทึก</span></label><div class="actions"><button class="btn primary" type="submit">บันทึกบริษัทและเอกสาร</button></div><p id="companyMessage" role="status"></p></form></div>
 <div data-settings-panel="equipment" hidden>${equipment}${appliances}</div>
 <div data-settings-panel="pricing" hidden>${pricing}<section class="panel form"><h3>แยกฐานราคา On-Grid / Hybrid</h3><p class="hint">BOQ คิดแผงและอินเวอร์เตอร์ตามรุ่นจริง Hybrid เพิ่มแบตตามความจุติดตั้งจริง ราคาด้านล่างเป็นส่วนงานเพิ่มเติม ไม่คิดแบตซ้ำกับ BOQ ค่าเริ่มต้นเป็นวงเงินประเมิน ต้องปรับตามใบเสนอราคาจริง</p><div class="grid2">${SETTING_FIELDS.filter(([key])=>PRICE_KEYS.includes(key)).map(settingInput).join('')}</div><button type="submit" form="calculationForm" class="btn primary">บันทึกฐานราคาแยกระบบ</button></section></div>
 <div data-settings-panel="calculation" hidden><form id="calculationForm" class="panel form"><h3>การคำนวณและคืนทุน</h3><p class="hint">วิเคราะห์ผลตอบแทนก่อนค่าใช้จ่ายในอนาคต 25 ปี • ค่าที่บันทึกมีผลต่อการประเมินใหม่ทันที ไม่เปลี่ยน snapshot ของงานที่บันทึกไว้แล้ว</p><div class="grid2">${SETTING_FIELDS.filter(([key])=>!PRICE_KEYS.includes(key)).map(settingInput).join('')}</div><p class="hint">ค่าตั้งต้นเป็นสมมติฐานเพื่อประเมิน ไม่ใช่ค่ามาตรฐานบังคับ ใช้สเปกแบต/อินเวอร์เตอร์จริง และผลจำลอง PVWatts เฉพาะสถานที่ อัตราเฉลี่ยไม่ทดแทนบิลขั้นบันไดหรือ TOU</p><button class="btn primary" type="submit">บันทึกค่าคำนวณและคืนทุน</button><p id="calculationMessage" role="status"></p></form></div></section>`;
}
export function mountSettings({getClient,modules,recalculate,report}){
 let company={},values=normalizeCalculation(),previewUrl=null;
 const initialDefaults={...modules.DEFAULTS},initialRates={...modules.BILL_RATES},initialPeriods={...modules.PERIOD_DEFAULTS};
 function tab(name){document.querySelectorAll('[data-settings-panel]').forEach(el=>el.hidden=el.dataset.settingsPanel!==name);document.querySelectorAll('[data-settings-tab]').forEach(el=>{const active=el.dataset.settingsTab===name;el.classList.toggle('active',active);el.setAttribute('aria-pressed',String(active));});}
 document.querySelectorAll('[data-settings-tab]').forEach(el=>el.onclick=()=>tab(el.dataset.settingsTab));
 function rights(){
  const editable=!!getClient();
  for(const id of ['companyForm','calculationForm','equipmentForm','applianceForm','pricingForm'])$(id)?.querySelectorAll('input,select,textarea,button:not([type="button"])').forEach(el=>el.disabled=!editable);
  document.querySelectorAll('[form="calculationForm"]').forEach(el=>el.disabled=!editable);
  document.querySelectorAll('[data-eq-toggle],[data-eq-edit],[data-eq-del],[data-ap-toggle],[data-ap-edit],[data-ap-del],[data-del]').forEach(el=>el.disabled=!editable);
  $('settingsStatus').textContent=editable?'เชื่อมต่อแล้ว • สามารถบันทึกการตั้งค่าได้โดยตรง':'โหมดจำกัด • ยังไม่เชื่อมต่อฐานข้อมูล จึงบันทึกการตั้งค่าไม่ได้';
 }
 async function requireConnection(){rights();return !!getClient();}
 function logoUrl(path){return path?getClient()?.storage?.from('company-assets').getPublicUrl(path).data.publicUrl:'';}
 function setImage(id,url){const image=$(id);image.hidden=!url;if(url)image.src=url;else image.removeAttribute('src');}
 function renderBrand(){
  const name=company.company_name||'Solar Office Pro',url=logoUrl(company.logo_path);
  $('companyBrandName').textContent=name;$('companyNamePreview').textContent=name;document.title=name==='Solar Office Pro'?name:name+' | Solar Office Pro';
  for(const id of ['companyBrandLogo','companyLogoPreview','printCompanyLogo'])setImage(id,url);
  $('brandFallback').hidden=!!url;$('printCompanyName').textContent=name;
  $('printCompanyDetails').textContent=[company.address,company.phone&&'โทร '+company.phone,company.email,company.tax_id&&'เลขประจำตัวผู้เสียภาษี '+company.tax_id].filter(Boolean).join('\n');
  $('printCompanyTerms').textContent=[company.quote_valid_days&&'ใบเสนอราคามีอายุ '+company.quote_valid_days+' วัน',company.payment_terms&&'การชำระเงิน: '+company.payment_terms,company.warranty_terms&&'การรับประกัน: '+company.warranty_terms,company.document_footer].filter(Boolean).join('\n');
 }
 $('companyLogoFile').onchange=async()=>{try{if(previewUrl){URL.revokeObjectURL(previewUrl);previewUrl=null;}const file=$('companyLogoFile').files[0];if(!file){renderBrand();return;}await validatePng(file);previewUrl=URL.createObjectURL(file);setImage('companyLogoPreview',previewUrl);$('removeCompanyLogo').checked=false;$('companyMessage').textContent='ตัวอย่างโลโก้ • กดบันทึกเพื่อแสดงบนเว็บ';}catch(error){$('companyLogoFile').value='';$('companyMessage').textContent=error.message;renderBrand();}};
 $('co_company_name').oninput=()=>{$('companyNamePreview').textContent=$('co_company_name').value||'Solar Office Pro';};
 $('companyForm').onsubmit=async event=>{
  event.preventDefault();if(!await requireConnection())return;const button=event.submitter||$('companyForm').querySelector('[type="submit"]');button.disabled=true;
  let uploaded=null;const client=getClient();
  try{
   const row={id:1,logo_path:$('removeCompanyLogo').checked?null:company.logo_path||null};
   for(const [key] of COMPANY_FIELDS)row[key]=key==='quote_valid_days'?Number($('co_'+key).value):$('co_'+key).value.trim();
   if(!row.company_name)throw Error('กรุณาระบุชื่อบริษัท');
   if(!Number.isInteger(row.quote_valid_days)||row.quote_valid_days<1||row.quote_valid_days>365)throw Error('อายุใบเสนอราคาต้องอยู่ระหว่าง 1–365 วัน');
   const file=$('companyLogoFile').files[0];
   if(file){await validatePng(file);uploaded='logos/'+crypto.randomUUID()+'.png';const {error}=await client.storage.from('company-assets').upload(uploaded,file,{contentType:'image/png',upsert:false,cacheControl:'3600'});if(error)throw error;row.logo_path=uploaded;}
   const {error}=await client.from('company_settings').upsert(row);if(error)throw error;
   company=row;renderBrand();$('companyLogoFile').value='';$('removeCompanyLogo').checked=false;if(previewUrl){URL.revokeObjectURL(previewUrl);previewUrl=null;}$('companyMessage').textContent='บันทึกแล้ว • ชื่อบริษัทและโลโก้แสดงบนหน้าเว็บและเอกสารพิมพ์แล้ว';
  }catch(error){if(uploaded)await client.storage.from('company-assets').remove([uploaded]);$('companyMessage').textContent='บันทึกไม่สำเร็จ: '+error.message;}finally{rights();}
 };
 $('calculationForm').onsubmit=async event=>{event.preventDefault();if(!await requireConnection())return;try{const next=normalizeCalculation({...values,...Object.fromEntries(SETTING_FIELDS.map(([key])=>[key,$('cs_'+key).value]))});const {error}=await getClient().from('calculation_settings').upsert({id:1,values:next});if(error)throw error;values=applyCalculation(next,modules);recalculate();$('calculationMessage').textContent='บันทึกแล้ว • ผลประเมิน กราฟ และตารางอัปเดตตามค่าใหม่';}catch(error){$('calculationMessage').textContent='บันทึกไม่สำเร็จ: '+error.message;}};
 async function load(){
  const client=getClient();if(!client)return;
  const results=await Promise.allSettled([client.from('company_settings').select('*').eq('id',1).maybeSingle(),client.from('calculation_settings').select('*').eq('id',1).maybeSingle()]);
  const companyResult=results[0].status==='fulfilled'?results[0].value:{error:results[0].reason};
  if(companyResult.error)$('companyMessage').textContent='โหลดค่าบริษัทไม่ได้ กรุณาติดตั้ง schema.sql: '+companyResult.error.message;
  else {company=companyResult.data||{};for(const [key]of COMPANY_FIELDS)$('co_'+key).value=company[key]??(key==='quote_valid_days'?30:'');renderBrand();}
  const calcResult=results[1].status==='fulfilled'?results[1].value:{error:results[1].reason};
  try{if(calcResult.error)throw calcResult.error;values=applyCalculation(calcResult.data?.values||{},modules);for(const [key]of SETTING_FIELDS)$('cs_'+key).value=values[key];recalculate();}catch(error){Object.assign(modules.DEFAULTS,initialDefaults);Object.assign(modules.BILL_RATES,initialRates);Object.assign(modules.PERIOD_DEFAULTS,initialPeriods);$('calculationMessage').textContent='ใช้ค่าคำนวณเริ่มต้น: '+error.message;recalculate();}
  rights();
 }
 rights();renderBrand();
 async function saveTariffConfig(config){if(!await requireConnection())throw Error('ต้องเชื่อมฐานข้อมูลก่อนบันทึก');const next=normalizeCalculation({...values,tariffConfig:config});const {error}=await getClient().from('calculation_settings').upsert({id:1,values:next});if(error)throw error;values=applyCalculation(next,modules);}
 async function saveLocations(locationTypes){if(!await requireConnection())throw Error("ต้องเชื่อมฐานข้อมูลก่อนบันทึก");const next=normalizeCalculation({...values,locationTypes});const {error}=await getClient().from("calculation_settings").upsert({id:1,values:next});if(error)throw error;values=applyCalculation(next,modules);recalculate();}
 return {load,tab,rights,requireConnection,saveLocations,saveTariffConfig,snapshot:()=>({company:{...company},calculation:{...values}})};
}
