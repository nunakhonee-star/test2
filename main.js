// ============================================================
// SolarCalculation — calc.js
// ============================================================
const SolarCalculation = (()=>{

const DEFAULT_PRICING = { labor_per_kwp:6000, structure_per_kwp:3500, wiring_per_kwp:1800, transport_flat:5000, admin_flat:3000, margin_percent:8, vat_percent:7 };
const PERIOD_DEFAULTS = {day:90,night:10,both:50};
const DEFAULTS = { yieldPerKwpMonth:125, batteryDod:0.90, batteryEff:0.95, batteryRoundTripEff:0.90, batteryReserve:1.10, tariffGrowth:0.025, minimumBill:200,onGridSavingsCap:0.60,hybridSavingsCap:0.60,onGridBalanceCost:0,hybridBalanceCost:5000,batteryPricePerKwh:9000,roofAreaPerPanel:2.6,roofLayoutFactor:1.2,degradation:0.005, discount:0.08, co2KgPerKwh:0.5664, analysisYears:25 };
const BILL_RATES = { residential:4.2, business:4.8, industrial:4.5 };

function moneyN(v){ return Number(v||0); }
function normalizePricing(p={}){ return { ...DEFAULT_PRICING, ...p }; }
function estimateMonthlyKwh(monthlyKwh, monthlyBill, tariffType){ const k = moneyN(monthlyKwh); if(k>0) return { monthlyKwh:k, source:'actual' }; const b = moneyN(monthlyBill); const rate = BILL_RATES[tariffType] || BILL_RATES.residential; return { monthlyKwh: b>0? b/rate : 0, source: b>0?'estimated':'none' }; }
function defaultPanel(items){ const valid=items.filter(x=>x.category==='panel' && x.active!==false && Number(x.panel_wp)>0); return valid.find(x=>x.is_default) || valid[0]; }
function chooseClosest(items, field, target, category, systemType=''){ const list = items.filter(x=>x.category===category && x.active!==false && Number(x[field]||0)>0 && (!systemType || !x.system_type || x.system_type===systemType)); if(!list.length || !target) return null; if(category==='inverter')return [...list].filter(x=>Number(x[field])>=target).sort((a,b)=>Number(a[field])-Number(b[field]))[0] || [...list].sort((a,b)=>Number(b[field])-Number(a[field]))[0]; return [...list].sort((a,b)=>Math.abs(Number(a[field])-target)-Math.abs(Number(b[field])-target))[0]; }
function toCalcAppliance(r){ const has=!!r.has_surge; return { id:r.id, name:r.name, powerW:Number(r.power_w||0), hasSurge:has, surge:has?Number(r.surge_factor||1):1 }; }
function backupFromAppliances(qtys, hours, library=[]){ let contW=0, extraSurge=0, items=[]; for(const a of library){ const qty = Math.max(0, Math.floor(Number(qtys[a.id]||0))); if(!Number.isFinite(qty)||!qty||!Number.isFinite(a.powerW)||a.powerW<=0) continue; const runW = a.powerW*qty; const startW = a.hasSurge ? a.powerW*Math.max(1,Number(a.surge)||1)*qty : runW; contW += runW; if(a.hasSurge) extraSurge += Math.max(0, startW-runW); items.push({ ...a, qty, runW, startW }); } const continuousKw = contW/1000; const surgeKw = (contW+extraSurge)/1000; const usableKwh = continuousKw*Math.max(0,moneyN(hours)); const batteryKwh = usableKwh>0 ? usableKwh/(DEFAULTS.batteryDod*DEFAULTS.batteryEff)*DEFAULTS.batteryReserve : 0; return { items, continuousKw, surgeKw, usableKwh, batteryKwh }; }

function siteCost(pricing,key,standard,kwp){
 const item=pricing.siteCosts?.[key];if(!item||item.mode==='standard')return standard;
 if(!['fixed','per_kwp','quantity'].includes(item.mode))throw Error('วิธีคิดราคาหน้างานไม่ถูกต้อง');
 const rate=Number(item.rate),qty=Number(item.quantity??1);
 if(!Number.isFinite(rate)||rate<0||!Number.isFinite(qty)||qty<0)throw Error('ราคาหน้างานและจำนวนต้องไม่ติดลบ');
 return rate*(item.mode==='per_kwp'?kwp:item.mode==='quantity'?qty:1);
}

function priceEstimate({panel,panelCount,inverter,battery,batteryCount,inverterCount=1,pricing,systemType='On-Grid'}){ pricing = normalizePricing(pricing); const kwp = panel ? (Number(panel.panel_wp||0) * Number(panelCount||0) / 1000) : 0; const panelTotal = panel ? Number(panel.sell_price||0) * panelCount : 0; const inverterTotal = inverter ? Number(inverter.sell_price||0) * Math.max(1,inverterCount||1) : 0; const batteryTotal = battery ? (Number(battery.sell_price)>0?Number(battery.sell_price):Number(battery.capacity_kwh||0)*DEFAULTS.batteryPricePerKwh) * Math.max(0,batteryCount||0) : 0; const equipment = panelTotal + inverterTotal + batteryTotal; const labor = siteCost(pricing,'labor',kwp*pricing.labor_per_kwp,kwp); const structure = siteCost(pricing,'structure',kwp*pricing.structure_per_kwp,kwp); const wiring = siteCost(pricing,'wiring',kwp*pricing.wiring_per_kwp,kwp); const transport = siteCost(pricing,'transport',pricing.transport_flat,kwp); const admin = siteCost(pricing,'admin',pricing.admin_flat,kwp); const extra = siteCost(pricing,'extra',0,kwp); const systemBalance = systemType==='Hybrid'?DEFAULTS.hybridBalanceCost:DEFAULTS.onGridBalanceCost; const base = equipment+labor+structure+wiring+transport+admin+extra+systemBalance; const margin = base*(pricing.margin_percent/100); const vatBase = base+margin; const vat = vatBase*(pricing.vat_percent/100); const total = vatBase + vat; return { kwp,systemType,systemBalance,batteryInstalledKwh:battery?Number(battery.capacity_kwh||0)*Math.max(0,batteryCount||0):0,batteryPriceSource:battery&&Number(battery.sell_price)>0?'equipment':'allowance',panelTotal,inverterTotal,batteryTotal,equipment,labor,structure,wiring,transport,admin,extra,margin,vat,total }; }
function usageCalculation({monthlyKwh, monthlyBill, tariffType, daytimePercent, panelWp, yieldPerKwpMonth=DEFAULTS.yieldPerKwpMonth}){ const usage = estimateMonthlyKwh(monthlyKwh, monthlyBill, tariffType); const kwh = usage.monthlyKwh; const dayPct = Math.max(0, Math.min(100, Number(daytimePercent||0))); const dayUse = kwh*(dayPct/100); const panelCount = kwh>0 ? Math.max(1, Math.ceil((dayUse/yieldPerKwpMonth*1000)/Number(panelWp||580))) : 0; const kwp = panelCount*Number(panelWp||580)/1000; const invTarget = kwp>0 ? kwp/1.15 : 0; const genMonth = kwp*yieldPerKwpMonth; const selfUse = Math.min(dayUse, genMonth); const excess = Math.max(0, genMonth-selfUse); const effRate = kwh>0 && moneyN(monthlyBill)>0 ? moneyN(monthlyBill)/kwh : 0; const saveMonth = selfUse*effRate; return { source:usage.source, monthlyKwh:kwh, dayUse, panelCount, kwp, invTarget, genMonth, genYear:genMonth*12, genDay:genMonth*12/365, selfUse, excess, selfUseRatio:genMonth>0?selfUse/genMonth:0, saveMonth, saveYear:saveMonth*12 }; }
function budgetCalculation({budget, systemType, panel, items, pricing, backup,phase}){ const b = moneyN(budget); if(!b || !panel) return null; let best = null; for(let count=1; count<=500; count++){ const kwp = count*Number(panel.panel_wp||0)/1000; if(phase==='1PH'&&kwp>5+1e-9)break; const invTarget = Math.max(kwp/1.15, systemType==='Hybrid' ? backup.continuousKw*1.25 : 0, systemType==='Hybrid' ? backup.surgeKw : 0); const inverter = chooseClosest(items,'power_kw',invTarget,'inverter',systemType); if(!inverter) continue; let battery = null, batteryCount = 0; if(systemType==='Hybrid' && backup.batteryKwh>0){ battery = chooseClosest(items,'capacity_kwh',backup.batteryKwh,'battery','Hybrid'); if(battery) batteryCount = Math.max(1, Math.ceil(backup.batteryKwh/Number(battery.capacity_kwh||1))); } const price = priceEstimate({panel,panelCount:count,inverter,battery,batteryCount,inverterCount:Math.max(1,Math.ceil(invTarget/Number(inverter.power_kw||invTarget||1))),pricing,systemType}); if(price.total<=b) best = { panelCount:count, kwp, inverter, battery, batteryCount, price };  } if(!best) return null; const genMonth = best.kwp*DEFAULTS.yieldPerKwpMonth; return { ...best, genMonth, genYear:genMonth*12, genDay:genMonth*12/365 }; }
function npv(rate, cashflows){ return cashflows.reduce((s,c,i)=> s + c / Math.pow(1+rate,i), 0); }
function irr(cashflows){ const signs=cashflows.filter(x=>x!==0).map(Math.sign); if(signs.slice(1).filter((s,i)=>s!==signs[i]).length!==1)return null; let low=-0.99, high=1.5; let lv=npv(low,cashflows), hv=npv(high,cashflows); if(lv*hv>0) return null; for(let i=0;i<120;i++){ const mid=(low+high)/2; const mv=npv(mid,cashflows); if(Math.abs(mv)<1e-7) return mid; if(lv*mv<0){ high=mid; hv=mv; } else { low=mid; lv=mv; } } return (low+high)/2; }
function economics(projectPrice, annualSaving, unused={},annualModel=null){
 const invest=moneyN(projectPrice);let cum=-invest,payback=null;const flows=[-invest],points=[{year:0,cumulative:cum}],rows=[{year:0,saving:0,net:-invest,accumulated:0,cumulative:cum}];
 for(let year=1;year<=DEFAULTS.analysisYears;year++){
  const model=annualModel?annualModel(year):{saving:annualSaving*Math.pow(1+DEFAULTS.tariffGrowth,year-1)*Math.pow(1-DEFAULTS.degradation,year-1)};
  const net=model.saving,prev=cum;cum+=net;
  if(payback===null&&cum>=0&&net>0)payback=Number((year-1-prev/net).toFixed(1));
  flows.push(net);points.push({year,cumulative:cum});rows.push({year,saving:model.saving,net,accumulated:cum+invest,cumulative:cum});
 }
 const i=irr(flows),at=year=>points.find(p=>p.year===year)?.cumulative??null;
 return {points,rows,flows,payback,irr:i===null?null:i*100,npv:npv(DEFAULTS.discount,flows),roi:invest>0?cum/invest*100:null,profit1:at(1),profit20:at(20),profit25:at(25)};
}
function equipmentIssue(x){
 if(x.active===false)return null;
 if(x.specs?.verification==='pending')return 'รายการนี้รอตรวจสอบ กรุณาแก้สเปกและเปลี่ยนสถานะตรวจสอบเป็น verified ก่อนเปิดใช้';
 if(x.category==='panel'&&x.panel_wp!=null&&!(Number(x.panel_wp)>0))return 'กำลังแผงยังไม่ถูกต้อง';
 const model=String(x.model||'');
 if(x.category==='inverter'&&(/optimizer|MERC-\d+W-P/i.test(model)))return 'Optimizer ไม่ใช่อินเวอร์เตอร์ กรุณาเปลี่ยนประเภทอุปกรณ์';
 if(x.category==='inverter'&&/SUN2000-\s*(12|15|17|20|25)K-MB0/i.test(model)&&x.phase!=='3PH')return 'SUN2000 รุ่น MB0 นี้เป็น 3 เฟส กรุณาแก้สเปกในฐานอุปกรณ์';
 if(x.category==='battery'&&/SUN\s*2000/i.test(model))return 'SUN2000 ไม่ใช่แบตเตอรี่';
 return null;
}
function conservativeSavings(before,rawSaving,systemType){
 const cap=systemType==='Hybrid'?DEFAULTS.hybridSavingsCap:DEFAULTS.onGridSavingsCap;
 return Math.max(0,Math.min(rawSaving,before*cap,before-Math.min(before,DEFAULTS.minimumBill)));
}
function roofEstimate(kwp,panelWp=550,areaPerPanel=DEFAULTS.roofAreaPerPanel){
 const panelCount=Math.ceil(kwp*1000/panelWp);return {panelCount,panelWp,installedKwp:panelCount*panelWp/1000,moduleArea:panelCount*areaPerPanel,roofArea:panelCount*areaPerPanel*DEFAULTS.roofLayoutFactor};
}
function co2(yearKwh){ return moneyN(yearKwh)*DEFAULTS.co2KgPerKwh/1000; }

/* ออกแบบระบบ: ใช้รุ่น/จำนวนที่เลือกเอง ถ้าไม่เลือกให้คำนวณอัตโนมัติ */
function baseDesignSystem({ mode, systemType, items, pricing, backup, sel, budget, usage }){
  const hybrid = systemType==='Hybrid', warnings=[];
  const panel = items.find(x=>x.id===sel.panelId && x.category==='panel' && x.active!==false && Number(x.panel_wp)>0) || defaultPanel(items);
  if(!panel) return { error:'ยังไม่มีแผง Solar ในฐานข้อมูลอุปกรณ์' };
  const wp = Number(panel.panel_wp||0);
  const u = estimateMonthlyKwh(usage.monthlyKwh, usage.monthlyBill, usage.tariffType);
  let autoPanel = 0;
  if(mode==='budget'){ const b = budgetCalculation({budget,systemType,panel,items,pricing,backup,phase:usage.phase}); autoPanel = b ? b.panelCount : 0; }
  else autoPanel = usageCalculation({...usage, panelWp:wp}).panelCount;
  const unconstrainedPanel=autoPanel;
  if(usage.phase==='1PH')autoPanel=Math.min(autoPanel,Math.floor(5000/wp));
  if(usage.phase==='1PH'&&sel.panelQty>0&&Math.floor(sel.panelQty)*wp>5000+1e-6)return {error:'ขนาดแผงเกิน 5 kWp ตามเกณฑ์ประเมิน 1 เฟสของระบบ ต้องเปลี่ยนเป็นมิเตอร์ 3 เฟสและยืนยันกับการไฟฟ้าก่อนออกแบบขนาดนี้'};
  if(usage.phase==='1PH'&&unconstrainedPanel>autoPanel)warnings.push('จำกัดขนาดแผง 1 เฟสไม่เกิน 5 kWp ตามเกณฑ์ประเมินของระบบ หากต้องการตามเป้าพลังงานเดิม ต้องเปลี่ยนเป็นมิเตอร์ 3 เฟสและให้การไฟฟ้าตรวจพิกัดมิเตอร์/อินเวอร์เตอร์');
  const panelQty = sel.panelQty>0 ? Math.floor(sel.panelQty) : autoPanel;
  if(panelQty<=0) return { error: mode==='budget' ? 'งบประมาณยังไม่พอสำหรับจัดชุดอุปกรณ์' : 'กรอกหน่วยไฟหรือค่าไฟต่อเดือนเพื่อเริ่มคำนวณ' };
  const kwp = panelQty*wp/1000;
  const invTarget = Math.max(kwp/1.15, hybrid?backup.continuousKw*1.25:0, hybrid?backup.surgeKw:0);
  const autoInv = chooseClosest(items,'power_kw',invTarget,'inverter',systemType);
  const inverter = items.find(x=>x.id===sel.invId) || autoInv;
  const autoInvQty = autoInv ? Math.max(1, Math.ceil(invTarget / Number(autoInv.power_kw || invTarget || 1))) : 1;
  const chosenInvQty = inverter ? Math.max(1, Math.ceil(invTarget / Number(inverter.power_kw || invTarget || 1))) : 1;
  const invQty = sel.invQty>0 ? Math.floor(sel.invQty) : chosenInvQty;
  const need = hybrid ? backup.batteryKwh : 0;
  const autoBat = need>0 ? chooseClosest(items,'capacity_kwh',need,'battery','Hybrid') : null;
  const battery = hybrid ? (items.find(x=>x.id===sel.batId && x.category==='battery' && x.active!==false && Number(x.capacity_kwh)>0) || autoBat) : null;
  const autoBatQty = battery && need>0 ? Math.max(1,Math.ceil(need/Number(battery.capacity_kwh||1))) : (battery?1:0);
  const batQty = battery ? (sel.batQty>0 ? Math.floor(sel.batQty) : autoBatQty) : 0;
  const price = priceEstimate({panel,panelCount:panelQty,inverter,battery,batteryCount:batQty,inverterCount:invQty,pricing,systemType});
  const genMonth = kwp*DEFAULTS.yieldPerKwpMonth;
  const dayPct = Math.max(0,Math.min(100,Number(usage.daytimePercent||0)))/100;
  const kwh = u.monthlyKwh, bill = moneyN(usage.monthlyBill);
  const effRate = kwh>0 && bill>0 ? bill/kwh : (BILL_RATES[usage.tariffType]||BILL_RATES.residential);
  const selfUse = kwh>0 ? Math.min(kwh*dayPct, genMonth) : genMonth*0.8;
  const saveMonth = selfUse*effRate, saveYear = saveMonth*12;
  const eco = economics(price.total, saveYear);
  if(!inverter) warnings.push('ไม่พบ Inverter ที่เหมาะสมในฐานข้อมูล');
  else {
    const acKw = Number(inverter.power_kw||0)*invQty;
    if(inverter.system_type && inverter.system_type!==systemType) warnings.push(`Inverter รุ่นที่เลือกกำหนดไว้สำหรับ ${inverter.system_type} แต่โครงการนี้เป็น ${systemType}`);
    if(acKw>0 && kwp/acKw>1.5) warnings.push(`Inverter เล็กเกินไป (DC/AC ${(kwp/acKw).toFixed(2)}) ควรเพิ่มขนาดหรือจำนวน`);
    if(hybrid && acKw<backup.surgeKw) warnings.push(`Inverter รวม ${acKw.toFixed(1)} kW ต่ำกว่าโหลด Surge ${backup.surgeKw.toFixed(1)} kW`);
  }
  if(hybrid && need>0){ if(!battery) warnings.push('ไม่พบแบตเตอรี่ในฐานข้อมูล'); else { const have=Number(battery.capacity_kwh||0)*batQty; if(have<need*0.98) warnings.push(`แบตเตอรี่รวม ${have.toFixed(1)} kWh ต่ำกว่าที่ต้องใช้ ${need.toFixed(1)} kWh`); } }
  if(mode==='budget' && moneyN(budget)>0 && price.total>moneyN(budget)) warnings.push(`ราคาเกินงบ ${Math.round(price.total-moneyN(budget)).toLocaleString('th-TH')} บาท`);
  const manual = { panel:!!(sel.panelId||sel.panelQty), inverter:!!(sel.invId||sel.invQty), battery:!!(sel.batId||sel.batQty) };
  return { panel,panelQty,inverter,invQty,battery,batQty,kwp,price,eco,genMonth,genYear:genMonth*12,genDay:genMonth*12/365,saveMonth,saveYear,ratio:genMonth>0?selfUse/genMonth:0,co2:co2(genMonth*12),warnings,manual,usageSource:u.source,monthlyKwh:kwh,auto:{panel,panelQty:autoPanel,inverter:autoInv,invQty:autoInvQty,battery:autoBat,batQty:autoBatQty} };
}

// Period defaults are explicit estimation assumptions, editable in the UI.
function usagePlan(usage, systemType, backup) {
  const defaultDayPercent = PERIOD_DEFAULTS[usage.period] ?? 90;
  let dayPercent = Math.max(0, Math.min(100, usage.daytimePercent === '' || usage.daytimePercent == null ? defaultDayPercent : Number(usage.daytimePercent)));
  const estimated = estimateUsage(usage);
  const dayMonthly = estimated.monthlyKwh * dayPercent / 100;
  const nightDaily = (estimated.monthlyKwh - dayMonthly) / 30;
  const hybrid = systemType === 'Hybrid';
  const nightBattery = hybrid ? nightDaily / (DEFAULTS.batteryDod * DEFAULTS.batteryEff) * DEFAULTS.batteryReserve : 0;
  const useBackup = hybrid && backup.items?.length > 0 && backup.usableKwh > 0 && backup.batteryKwh > 0;
  return { defaultDayPercent, dayPercent, dayMonthly, nightDaily, estimated,
    solarMonthlyTarget: dayMonthly + (hybrid ? nightDaily * 30 / DEFAULTS.batteryRoundTripEff : 0),
    backup: {...backup, source: hybrid ? (useBackup ? 'backup-loads' : 'night-auto') : 'none', batteryKwh: hybrid ? (useBackup ? backup.batteryKwh : nightBattery) : 0} };
}


// Local standard time: Jan 1 00:00 through Dec 31 23:00, non-leap year.
function hourlyBalance(usage,kwp,batteryCapacity=0,hybrid=false){
 const load=usage.hourlyLoad?.hourlyKwh,pv=usage.production?.hourlyYield;
 if(!load||!pv)return null;
 if(load.length!==8760||pv.length!==8760||usage.production.station?.tz!==7)throw Error('ข้อมูลรายชั่วโมงต้องครบปีและใช้เวลาท้องถิ่นประเทศไทยตรงกัน');
 const days=[31,28,31,30,31,30,31,31,30,31,30,31],months=[];let t=0;
 // Capacity is deliverable AC kWh; round-trip losses charged on PV input.
 let soc=0;const cap=hybrid?batteryCapacity:0;
 for(const n of days){let direct=0,shifted=0,exported=0,imported=0,generated=0,consumed=0,loss=0,charge=0;
  const openingSoc=soc;
  for(let h=0;h<n*24;h++,t++){
   const g=Math.min(pv[t]*kwp,usage.acLimitKw??Infinity),l=load[t];generated+=g;consumed+=l;
   const used=Math.min(l,g);direct+=used;let surplus=g-used,deficit=l-used;
   const stored=Math.min(surplus*DEFAULTS.batteryRoundTripEff,Math.max(0,cap-soc));
   const input=stored/DEFAULTS.batteryRoundTripEff;soc+=stored;surplus-=input;charge+=input;loss+=input-stored;
   const discharged=Math.min(deficit,soc);soc-=discharged;shifted+=discharged;deficit-=discharged;
   exported+=Math.max(0,surplus);imported+=Math.max(0,deficit);
  }
  months.push({direct,shifted,exported,imported,generated,consumed,loss,charge,openingSoc,closingSoc:soc});
 }
 return {months,source:'hourly-load-and-pvwatts',limitations:'โหลดที่นำเข้า + ผลผลิต PVWatts จำลองรายชั่วโมง ไม่ใช่การรับรองผลจริง; แบตใช้แบบจำลองพลังงาน ยังไม่จำลองกระแส กำลังจ่าย และระบบควบคุม'};
}


function estimatedEnergyBalance(plan,kwp,batteryCapacity=0,hybrid=false,acLimitKw=Infinity){
 const days=[31,28,31,30,31,30,31,31,30,31,30,31];
 // Explicit screening assumptions, not measured loads or an official solar-yield model:
 // day = 06:00-18:00 uniform load, night = other 12 h; smooth noon-peaking PV shape.
 const shape=Array.from({length:24},(_,h)=>h>=6&&h<18?Math.sin(Math.PI*(h-6+.5)/12):0),norm=shape.reduce((s,v)=>s+v,0);
 const load=[],pv=[];
 for(const n of days)for(let d=0;d<n;d++)for(let h=0;h<24;h++){
  load.push(plan.estimated.monthlyKwh/n/12*((h>=6&&h<18)?plan.dayPercent/100:1-plan.dayPercent/100));
  pv.push(DEFAULTS.yieldPerKwpMonth/n*shape[h]/norm);
 }
 const result=hourlyBalance({acLimitKw,hourlyLoad:{hourlyKwh:load},production:{hourlyYield:pv,station:{tz:7}}},kwp,batteryCapacity,hybrid);
 return {...result,source:'representative-day-assumption',limitations:'โหลดกระจายสม่ำเสมอในช่วงกลางวัน/กลางคืน แดดเป็นโค้งวันตัวอย่าง ใช้ผลผลิตหลังบ้าน ไม่ใช่ข้อมูลวัดจริงและไม่จำลองเมฆหรือวันหยุด'};
}

function designSystem({mode, systemType, items, pricing, backup, sel, budget, usage}) {
  const badBattery=items.find(x=>x.category==='battery'&&x.active!==false&&/SUN\s*2000/i.test(x.model||''));if(systemType==='Hybrid'&&badBattery)return {error:'ข้อมูลอุปกรณ์ผิดประเภท: '+badBattery.model+' เป็นอินเวอร์เตอร์ Huawei ไม่ใช่แบตเตอรี่ กรุณาแก้ประเภทและสเปกจากเอกสารผู้ผลิตในหลังบ้าน'};
  const billingError=validateBilling(usage); if(billingError)return {error:billingError};
  if(sel.panelId&&!items.some(x=>x.id===sel.panelId&&x.category==='panel'&&x.active!==false&&Number(x.panel_wp)>0))return {error:'แผงที่เลือกไม่มีสเปกกำลังที่ใช้งานได้'};
  if(sel.batId&&systemType==='Hybrid'&&!items.some(x=>x.id===sel.batId&&x.category==='battery'&&x.active!==false&&Number(x.capacity_kwh)>0))return {error:'แบตเตอรี่ที่เลือกไม่มีสเปกความจุที่ใช้งานได้'};
  const plan = usagePlan(usage, systemType, backup);
  const phase = usage.phase || '1PH';
  // Unknown phases cannot be silently treated as compatible with the installation.
  const compatible = items.filter(x=>!equipmentIssue(x)).filter(x => x.category !== 'inverter' || (x.phase === phase && (systemType!=='Hybrid'||x.system_type==='Hybrid')));
  const inverterChoices = compatible.filter(x => x.category === 'inverter' && x.active !== false && Number(x.power_kw)>0 && (systemType==='Hybrid'?x.system_type==='Hybrid':(!x.system_type || x.system_type===systemType)));
  if (!inverterChoices.length) return {error: 'ไม่พบ Inverter ' + (phase === '1PH' ? '1 เฟส' : '3 เฟส') + ' สำหรับ ' + systemType + ' กรุณาเพิ่มอุปกรณ์หรือระบุเฟสในฐานข้อมูลให้ตรงกับมิเตอร์จริง'};
  if (sel.invId && !inverterChoices.some(x => x.id === sel.invId)) return {error:'Inverter ที่เลือกไม่ตรงกับเฟสหรือประเภทระบบ กรุณาเลือกใหม่'};
  const r = baseDesignSystem({mode, systemType, items:compatible, pricing, backup:plan.backup, sel, budget,
    usage:{...usage, yieldPerKwpMonth:DEFAULTS.yieldPerKwpMonth, monthlyKwh:plan.solarMonthlyTarget, monthlyBill:0, daytimePercent:100,phase}});
  if (r.error) return r;
  if(systemType==='Hybrid'&&/SUN2000-\s*(12|15|17|20|25)K-MB0/i.test(r.inverter?.model||'')&&r.battery&&!/^LUNA2000/i.test(r.battery.model||''))return {error:'อินเวอร์เตอร์ Huawei MB0 ต้องตรวจแบตที่รองรับตามคู่มือ ไม่สามารถจับคู่กับแบตที่เลือกโดยอัตโนมัติ'};
  if(![r.panel,r.inverter].every(x=>Number.isFinite(Number(x?.sell_price))&&Number(x.sell_price)>0))return {error:'ระบุราคาขายแผงและอินเวอร์เตอร์มากกว่าศูนย์ก่อนคำนวณการเงิน'};
  if(!Number.isFinite(r.price.total)||r.price.total<=0)return {error:'ราคาโครงการไม่ถูกต้อง ตรวจราคามาตรฐานและค่าใช้จ่ายหน้างาน'};
  const yields=Array(12).fill(DEFAULTS.yieldPerKwpMonth);
  const generations=yields.map(y=>r.kwp*y);
  r.genYear=generations.reduce((s,v)=>s+v,0);r.genMonth=r.genYear/12;r.genDay=r.genYear/365;
  const availableCapacity=r.battery?r.batQty*Number(r.battery.capacity_kwh||0)*DEFAULTS.batteryDod*DEFAULTS.batteryEff/DEFAULTS.batteryReserve:0;
  const hourly=estimatedEnergyBalance(plan,r.kwp,availableCapacity,systemType==='Hybrid',Number(r.inverter.power_kw)*r.invQty);
  r.genYear=hourly.months.reduce((sum,m)=>sum+m.generated,0);r.genMonth=r.genYear/12;r.genDay=r.genYear/365;
  const directByMonth=hourly?hourly.months.map(m=>m.direct):generations.map(g=>Math.min(plan.dayMonthly,g));
  const direct=directByMonth.reduce((s,v)=>s+v,0)/12;
  const availableBattery = r.battery ? r.batQty * Number(r.battery.capacity_kwh || 0) * DEFAULTS.batteryDod * DEFAULTS.batteryEff / DEFAULTS.batteryReserve : 0;
  const shiftedByMonth=hourly?hourly.months.map(m=>m.shifted):generations.map((g,i)=>systemType==='Hybrid'?Math.min(plan.nightDaily*30,availableBattery*30,Math.max(0,g-directByMonth[i])*DEFAULTS.batteryRoundTripEff):0);
  const shifted=shiftedByMonth.reduce((s,v)=>s+v,0)/12;
  const bill = moneyN(usage.monthlyBill), kwh = hourly?hourly.months.reduce((s,m)=>s+m.consumed,0)/12:plan.estimated.monthlyKwh;
  const monthlyLoads=hourly?hourly.months.map(m=>m.consumed):Array(12).fill(kwh);
  const billBefore=usage.billingMode?.startsWith('pea')?averageBills(monthlyLoads.map(k=>calculateBill(usage,k))):null;
  const baseline=billBefore?.total??bill;
  const rawSaving=generations.reduce((sum,g,i)=>sum+billSaving(usage,monthlyLoads[i],directByMonth[i]+shiftedByMonth[i]),0)/12;
  const saveMonth=conservativeSavings(baseline,rawSaving,systemType);
  const rawAfter=billBefore?averageBills(generations.map((g,i)=>calculateBill(usage,Math.max(0,monthlyLoads[i]-directByMonth[i]-shiftedByMonth[i])))):null;
  const reserve=Math.max(0,rawSaving-saveMonth);
  const billAfter=rawAfter?{...rawAfter,rawTotal:rawAfter.total,modelReserve:reserve,total:baseline-saveMonth}:null;
  const annualModel=year=>{
   const growth=Math.pow(1+DEFAULTS.tariffGrowth,year-1),degradedKwp=r.kwp*Math.pow(1-DEFAULTS.degradation,year-1);
   const energy=year===1?hourly:estimatedEnergyBalance(plan,degradedKwp,availableCapacity,systemType==='Hybrid',Number(r.inverter.power_kw)*r.invQty);
   const raw=energy.months.reduce((sum,m)=>sum+billSaving(usage,m.consumed,m.direct+m.shifted),0)/12;
   const service=(billBefore?.service??moneyN(usage.serviceCharge))*(1+moneyN(usage.billVat??7)/100);
   const futureBaseline=Math.max(0,baseline-service)*growth+service;
   const saving=12*conservativeSavings(futureBaseline,raw*growth,systemType);
   return {saving};
  };
  const eco=economics(r.price.total,saveMonth*12,{},annualModel);
  const cashflowRows=eco.rows;
  r.warnings.push('เกณฑ์ประเมินแบบเผื่อ: ประหยัดไม่เกิน '+((systemType==='Hybrid'?DEFAULTS.hybridSavingsCap:DEFAULTS.onGridSavingsCap)*100).toFixed(0)+'% และยอดคงเหลือไม่น้อยกว่า '+DEFAULTS.minimumBill+' บาท/เดือน (ไม่เกินบิลเดิม) ส่วนเผื่อนี้ไม่ใช่ค่าสแตนด์บายหรืออัตราบังคับการไฟฟ้า');
  if(r.price.batteryPriceSource==='allowance'&&r.battery)r.warnings.push('แบตไม่มีราคาขาย ใช้ราคาประเมิน '+DEFAULTS.batteryPricePerKwh+' บาท/kWh ของความจุติดตั้งจริง ต้องยืนยันราคาก่อนเสนอราคา');
  if(systemType==='Hybrid'&&plan.backup.batteryKwh>0&&!r.battery)return {error:'ไม่พบแบตเตอรี่ที่มีความจุสำหรับ Hybrid ไม่สามารถประเมินราคาโดยละต้นทุนแบตได้'};
  r.warnings.push('ค่าไฟเพิ่ม '+(DEFAULTS.tariffGrowth*100).toFixed(1)+'%/ปี เป็นสมมติฐานของค่าไฟส่วนแปรผัน ไม่ใช่การพยากรณ์ Ft');
  r.warnings.push('ประมาณการจากแบบจำลองวันตัวอย่าง: โหลดกระจายสม่ำเสมอช่วง 06:00–18:00 และช่วงกลางคืน แดดเป็นโค้งสูงช่วงเที่ยง ไม่ใช่ข้อมูลวัดจริง; ผลผลิต '+DEFAULTS.yieldPerKwpMonth+' kWh/kWp/เดือน เป็นสมมติฐาน ไม่ใช่มาตรฐานทุกพื้นที่');
  if(billBefore&&bill>0&&Math.abs(billBefore.total-bill)>Math.max(10,bill*.02))r.warnings.push('บิลจำลองก่อนติดตั้งต่างจากบิลที่กรอก '+Math.abs(billBefore.total-bill).toFixed(2)+' บาท ตรวจรอบบิล ประเภทอัตรา Ft ค่าบริการ และรายการพิเศษก่อนใช้เสนอราคา');
  r.warnings.push('เงินประหยัดและคืนทุนเป็นประมาณการ ค่าบริการคงเดิม • บิล TOU/demand/ส่วนลดพิเศษไม่รองรับ');
  if(!usage.billingMode || usage.billingMode==='estimate')r.warnings.push('ใช้อัตราเฉลี่ยประมาณการ ไม่ใช่การจำลองบิลขั้นบันได/TOU กรุณาระบุวิธีค่าไฟตามบิลก่อนเสนอราคาจริง');
  if(plan.estimated.source.startsWith('estimated'))r.warnings.push('หน่วยไฟประมาณย้อนกลับจากยอดบิลและอัตราที่ตั้งไว้ ควรใช้หน่วยไฟจริงเพื่อเพิ่มความแม่นยำ');
  if(r.invQty>1)r.warnings.push('จำนวนอินเวอร์เตอร์เป็นการประเมินกำลังรวม ต้องยืนยันรุ่นที่ต่อขนานได้และข้อจำกัดของผู้ผลิตก่อนติดตั้ง');
  if(r.battery)r.warnings.push('แบตเตอรี่เป็นคำแนะนำด้านความจุ ต้องตรวจแรงดัน BMS กระแสจ่าย จำนวนที่ต่อได้ และความเข้ากันได้กับอินเวอร์เตอร์ตามคู่มือรุ่นจริง');
  if(r.eco.irr==null)r.warnings.push('IRR ไม่แสดงเมื่อกระแสเงินสดไม่มีรากที่ยืนยันได้ในช่วงที่ค้นหา หรือมีการเปลี่ยนเครื่องหมายหลายครั้ง');
  if(backup.usableKwh>0&&(!backup.items?.length))r.warnings.push('ข้อมูลโหลดสำรองไม่ครบ');
  if (systemType === 'On-Grid' && usage.period !== 'day') r.warnings.push('เลือก On-Grid เอง: ระบบไม่เก็บไฟไว้ใช้กลางคืน คิดเงินประหยัดเฉพาะการใช้ไฟกลางวัน');
  if (systemType === 'Hybrid' && plan.nightDaily > 0) r.warnings.push('การใช้ไฟกลางคืนเป็นค่าเฉลี่ยรายวัน ระยะเวลาจ่ายไฟจริงขึ้นกับโหลดและข้อจำกัดของแบตเตอรี่/อินเวอร์เตอร์');
  if (systemType === 'Hybrid' && shifted + 0.01 < plan.nightDaily*30) r.warnings.push('พลังงานจากแผงหรือแบตเตอรี่ยังไม่ครอบคลุมไฟกลางคืนทั้งหมด ส่วนที่ขาดใช้ไฟจากการไฟฟ้า');

  return {...r,financialReady:kwh>0,energyBalance:hourly,energyBasis:'representative-day-assumption',billBefore,billAfter,eco,saveMonth,saveYear:saveMonth*12,ratio:r.genMonth>0?(direct + shifted / DEFAULTS.batteryRoundTripEff)/r.genMonth:0,
    co2:co2((direct+shifted)*12),monthlyKwh:kwh,usageSource:plan.estimated.source,backup:plan.backup,
    rawSaving,modelReserve:reserve,remainingBill:baseline-saveMonth,roof:roofEstimate(r.kwp,Number(r.panel.panel_wp),DEFAULTS.roofAreaPerPanel*Number(r.panel.panel_wp)/550),installedBatteryKwh:r.price.batteryInstalledKwh,backupRequiredKwh:backup.batteryKwh||0, nightRequiredKwh:plan.nightDaily/(DEFAULTS.batteryDod*DEFAULTS.batteryEff)*DEFAULTS.batteryReserve, productionSource:'default-assumption', billingMode:usage.billingMode||'estimate', phase,dayPercent:plan.dayPercent,nightDaily:plan.nightDaily,directMonthly:direct,shiftedMonthly:shifted,cashflowRows};
}

// PEA residential base energy rates effective September 2026. Ft, VAT and
// fixed charges are separate inputs; billing category never changes with solar.
function residentialEnergy(kwh, mode='pea112') {
  const tiers=mode==='pea111'?[[15,2.3488],[10,2.9882],[175,3],[200,4.1584],[Infinity,4.3583]]:[[200,3],[200,4.1584],[Infinity,4.3583]];
  let remaining=Math.max(0,Number(kwh)||0),total=0;
  for(const [width,rate]of tiers){const used=Math.min(remaining,width);total+=used*rate;remaining-=used;if(remaining<=0)break;}
  return total;
}
function validateBilling(u){
  if(Number(u.monthlyKwh)<0||Number(u.monthlyBill)<0)return 'หน่วยไฟและค่าไฟต้องไม่ติดลบ';
  if(u.billVat!=null&&(!Number.isFinite(Number(u.billVat))||Number(u.billVat)<0||Number(u.billVat)>100))return 'VAT ต้องอยู่ระหว่าง 0–100%';
  if(!u.billingMode||u.billingMode==='estimate')return null;
  if(!(Number(u.monthlyKwh)>0)&&!(Number(u.monthlyBill)>0))return null;
  if(u.billingMode.startsWith('pea')&&u.tariffReviewRequired)return 'พบประกาศอัตราฐานเปลี่ยน ต้องตรวจสูตรใหม่ก่อนใช้ PEA อัตโนมัติ กรุณาใช้อัตราจากบิลระหว่างรอตรวจ';
  if(u.billingMode.startsWith('pea')&&(!/^\d{4}-(0[1-9]|1[0-2])$/.test(u.billingMonth||'')||u.billingMonth<'2026-09'))return 'ตาราง PEA บ้านชุดนี้เริ่มกันยายน 2569 กรอกรอบบิลตั้งแต่เดือนดังกล่าว หรือใช้อัตราจากบิล';
  if(u.billingMode.startsWith('pea')&&(u.serviceCharge===''||u.serviceCharge==null))return 'กรอกค่าบริการก่อน VAT ตามบิล (รวม 0 หากไม่มี)';
  for(const key of ['serviceCharge'])if(u[key]!=null&&(!Number.isFinite(Number(u[key]))||Number(u[key])<0))return 'ค่าบริการ ค่า demand และรายการอื่นต้องไม่ติดลบ';
  if(u.billingMode.startsWith('pea')&&(u.ft===''||u.ft==null||!Number.isFinite(Number(u.ft))))return 'ยังไม่มีค่า Ft อ้างอิงสำหรับรอบบิลนี้';
  return null;
}
function estimateUsage(u){
 if(Number(u.monthlyKwh)>0)return {monthlyKwh:Number(u.monthlyKwh),source:'actual'};
 if(u.billingMode?.startsWith('pea')&&Number(u.monthlyBill)>0&&u.ft!==''&&u.ft!=null&&Number.isFinite(Number(u.ft))){
  const target=Number(u.monthlyBill);let low=0,high=1000;if(target<=calculateBill(u,0).total)return {monthlyKwh:0,source:'estimated-from-tariff'};
  while(calculateBill(u,high).total<target&&high<1e8)high*=2;
  for(let i=0;i<80;i++){const mid=(low+high)/2;if(calculateBill(u,mid).total>target)high=mid;else low=mid;}
  return {monthlyKwh:(low+high)/2,source:'estimated-from-tariff'};
 }
 const rate=BILL_RATES[u.tariffType]||BILL_RATES.residential;
 const vat=Number(u.billVat??7),service=Number(u.serviceCharge??24.62),bill=Number(u.monthlyBill||0);
 const net=Math.max(0,bill/(1+vat/100)-service);
 return {monthlyKwh:bill>0?net/rate:0,source:bill>0?'estimated-average-net':'none'};
}
function billSaving(u,kwh,offset){
  const avoided=Math.min(Math.max(0,offset),Math.max(0,kwh));
  let result;
  if(u.billingMode?.startsWith('pea'))return Math.max(0,calculateBill(u,kwh).total-calculateBill(u,kwh-avoided).total);
  else {const variable=Math.max(0,Number(u.monthlyBill||0)-Number(u.serviceCharge||0)*(1+Number(u.billVat??7)/100));const rate=kwh>0&&Number(u.monthlyBill)>0?variable/kwh:(BILL_RATES[u.tariffType]||BILL_RATES.residential);result=avoided*rate;}
  const cap=Number(u.monthlyBill)>0?Math.max(0,Number(u.monthlyBill)-Number(u.serviceCharge||0)*(1+Number(u.billVat??7)/100)):Infinity;
  return Math.max(0,Math.min(cap,result));
}

const OFFICIAL_FT={provider:'PEA',value:.1623,unit:'THB/kWh',from:'2026-09',to:'2026-12',checked:'2026-10-11',url:'https://www.pea.co.th/en/our-services/tariff/ft?page=0'};
const OFFICIAL_RESIDENTIAL={provider:'PEA',from:'2026-09',checked:'2026-10-11',url:'https://www.pea.co.th/news/corporate-news/2412'};
function officialFtForMonth(month){return /^\d{4}-(0[1-9]|1[0-2])$/.test(month)&&month>=OFFICIAL_FT.from&&month<=OFFICIAL_FT.to?{...OFFICIAL_FT}:null;}
function calculateBill(u,kwh){
 const energy=residentialEnergy(kwh,u.billingMode),ft=Math.max(0,kwh)*Number(u.ft),service=Number(u.serviceCharge||0);
 const subtotal=energy+ft+service,vat=subtotal*Number(u.billVat??7)/100;
 return {kwh:Math.max(0,kwh),energy,ft,service,subtotal,vat,total:subtotal+vat};
}
function averageBills(bills){return Object.fromEntries(Object.keys(bills[0]).map(key=>[key,bills.reduce((s,b)=>s+b[key],0)/bills.length]));}
// These are explicitly sampled alternatives, not a global engineering optimum.
function compareDesigns(input,current){
 const count=current.panelQty,counts=[Math.max(1,Math.floor(count*.8)),count,Math.ceil(count*1.2)];
 const rows=[...new Set(counts)].map(panelQty=>{const r=designSystem({...input,mode:'usage',sel:{...input.sel,panelQty}});return r.error?{panelQty,error:r.error}:{panelQty,kwp:r.kwp,investment:r.price.total,saving:r.saveYear,payback:r.eco.payback,npv:r.eco.npv,excess:Math.max(0,r.genMonth-r.directMonthly-r.shiftedMonthly/DEFAULTS.batteryRoundTripEff),current:panelQty===count};});
 let battery=null;
 if(input.systemType==='Hybrid'){
  const ongrid=designSystem({...input,mode:'usage',systemType:'On-Grid',sel:{panelId:current.panel.id,panelQty:count},backup:{continuousKw:0,surgeKw:0,batteryKwh:0,usableKwh:0,items:[]}});
  if(ongrid.error)battery={error:'ไม่มีอินเวอร์เตอร์ On-Grid เฟสเดียวกันให้เปรียบเทียบ จึงยังประเมินส่วนเพิ่ม Hybrid ไม่ได้'};
  else{const extraInvestment=current.price.total-ongrid.price.total,extraSaving=current.saveYear-ongrid.saveYear;
   battery={ongridInvestment:ongrid.price.total,ongridSaving:ongrid.saveYear,extraInvestment,extraSaving,simplePayback:extraInvestment>0&&extraSaving>0?extraInvestment/extraSaving:null,incrementalNpv:current.eco.npv-ongrid.eco.npv};}
 }
 return {rows,battery};
}

return {DEFAULT_PRICING,PERIOD_DEFAULTS,DEFAULTS,BILL_RATES,moneyN,normalizePricing,estimateMonthlyKwh,defaultPanel,chooseClosest,toCalcAppliance,backupFromAppliances,siteCost,priceEstimate,usageCalculation,budgetCalculation,npv,irr,economics,equipmentIssue,conservativeSavings,roofEstimate,co2,usagePlan,hourlyBalance,estimatedEnergyBalance,designSystem,residentialEnergy,validateBilling,estimateUsage,billSaving,OFFICIAL_FT,OFFICIAL_RESIDENTIAL,officialFtForMonth,calculateBill,averageBills,compareDesigns};
})();

// ============================================================
// SolarSettings — settings.js
// ============================================================
const SolarSettings = (()=>{
function normalizeLocations(rows){if(!Array.isArray(rows)||!rows.length||rows.length>50)throw Error('ประเภทสถานที่ต้องมี 1–50 รายการ');const ids=new Set();const result=rows.map(x=>{const id=String(x.id||''),name=String(x.name||'').trim();if(!/^[a-zA-Z0-9_-]{1,80}$/.test(id)||ids.has(id)||!name||name.length>100||!['1PH','3PH'].includes(x.phase)||!['residential','business','industrial'].includes(x.tariff))throw Error('ข้อมูลประเภทสถานที่ไม่ถูกต้องหรือรหัสซ้ำ');ids.add(id);return {id,name,phase:x.phase,tariff:x.tariff,active:x.active!==false};});if(!result.some(x=>x.active))throw Error('ต้องมีประเภทสถานที่เปิดใช้งานอย่างน้อยหนึ่งรายการ');return result;}

const $=id=>document.getElementById(id);
const COMPANY_FIELDS=[['company_name','ชื่อบริษัท','text'],['phone','เบอร์โทร','tel'],['email','อีเมล','email'],['tax_id','เลขประจำตัวผู้เสียภาษี','text'],['address','ที่อยู่บริษัท','textarea'],['quote_valid_days','อายุใบเสนอราคา (วัน)','number'],['payment_terms','เงื่อนไขการชำระเงิน','textarea'],['warranty_terms','เงื่อนไขการรับประกัน','textarea'],['document_footer','ข้อความท้ายเอกสาร','textarea']];
const SETTING_FIELDS=[
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
function normalizeCalculation(values={}) {
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
function applyCalculation(values,modules){
 const normalized=normalizeCalculation(values);
 for(const [key,,,,,divisor] of SETTING_FIELDS)if(key in modules.DEFAULTS)modules.DEFAULTS[key]=normalized[key]/(divisor||1);
 modules.DEFAULTS.locationTypes=normalized.locationTypes;
 Object.assign(modules.BILL_RATES,{residential:normalized.residentialRate,business:normalized.businessRate,industrial:normalized.industrialRate});
 Object.assign(modules.PERIOD_DEFAULTS,{day:normalized.dayPercent,night:normalized.nightPercent,both:normalized.bothPercent});
 return normalized;
}
async function validatePng(file){
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
function settingsMarkup(equipment,appliances,pricing){
 const company=COMPANY_FIELDS.map(([key,label,type])=>`<label>${label}${type==='textarea'?`<textarea id="co_${key}" maxlength="3000"></textarea>`:`<input id="co_${key}" type="${type}" ${key==='company_name'?'required maxlength="160"':key==='quote_valid_days'?'min="1" max="365" step="1" value="30"':'maxlength="250"'}>`}</label>`).join('');
 return `<section id="settings" class="page"><div class="head settings-heading"><div><h1>ตั้งค่าระบบ</h1><p>จัดการข้อมูลบริษัท อุปกรณ์ และค่าประเมินในที่เดียว</p></div><span class="settings-version">V15.4</span></div><p id="settingsStatus" role="status" class="settings-notice">กำลังรอเชื่อมต่อฐานข้อมูล</p>
 <div class="settings-layout"><nav class="settings-tabs" aria-label="หมวดการตั้งค่า">${[['company','บริษัทและเอกสาร'],['equipment','อุปกรณ์และโหลดสำรอง'],['pricing','ราคา'],['calculation','การคำนวณและคืนทุน']].map(([id,label])=>`<button type="button" class="btn ${id==='company'?'active':''}" data-settings-tab="${id}" aria-pressed="${id==='company'}">${label}</button>`).join('')}</nav><div class="settings-content">
 <div data-settings-panel="company"><form id="companyForm" class="panel form"><h3>บริษัทและเอกสาร</h3><div class="company-preview"><img id="companyLogoPreview" alt="ตัวอย่างโลโก้บริษัท" hidden><div><b id="companyNamePreview">Solar Office Pro</b><small>โลโก้และชื่อบริษัทที่แสดงบนหน้าเว็บ</small></div></div><div class="grid2">${company}</div><label>โลโก้บริษัท PNG<input type="file" id="companyLogoFile" accept="image/png,.png"><small>สูงสุด 2 MB • ไม่เกิน 4096 × 4096 พิกเซล • รองรับพื้นหลังโปร่งใส</small></label><label class="check"><input type="checkbox" id="removeCompanyLogo"><span>นำโลโก้ปัจจุบันออกเมื่อบันทึก</span></label><div class="actions"><button class="btn primary" type="submit">บันทึกบริษัทและเอกสาร</button></div><p id="companyMessage" role="status"></p></form></div>
 <div data-settings-panel="equipment" hidden><div class="settings-section-heading"><div><h2>อุปกรณ์และโหลดสำรอง</h2><p>เลือกส่วนที่ต้องการจัดการ แล้วเพิ่มหรือแก้ไขข้อมูลได้ด้านล่าง</p></div></div><nav class="equipment-section-tabs" aria-label="ส่วนจัดการอุปกรณ์"><button class="btn active" type="button" data-equipment-section="catalog" aria-pressed="true">อุปกรณ์โซลาร์</button><button class="btn" type="button" data-equipment-section="backup" aria-pressed="false">เครื่องใช้ไฟฟ้าสำรอง</button></nav><div data-equipment-view="catalog">${equipment}</div><div data-equipment-view="backup" hidden>${appliances}</div></div>
 <div data-settings-panel="pricing" hidden>${pricing}<section class="panel form"><h3>แยกฐานราคา On-Grid / Hybrid</h3><p class="hint">BOQ คิดแผงและอินเวอร์เตอร์ตามรุ่นจริง Hybrid เพิ่มแบตตามความจุติดตั้งจริง ราคาด้านล่างเป็นส่วนงานเพิ่มเติม ไม่คิดแบตซ้ำกับ BOQ ค่าเริ่มต้นเป็นวงเงินประเมิน ต้องปรับตามใบเสนอราคาจริง</p><div class="grid2">${SETTING_FIELDS.filter(([key])=>PRICE_KEYS.includes(key)).map(settingInput).join('')}</div><button type="submit" form="calculationForm" class="btn primary">บันทึกฐานราคาแยกระบบ</button></section></div>
 <div data-settings-panel="calculation" hidden><form id="calculationForm" class="panel form"><h3>การคำนวณและคืนทุน</h3><p class="hint">วิเคราะห์ผลตอบแทนก่อนค่าใช้จ่ายในอนาคต 25 ปี • ค่าที่บันทึกมีผลต่อการประเมินใหม่ทันที ไม่เปลี่ยน snapshot ของงานที่บันทึกไว้แล้ว</p><div class="grid2">${SETTING_FIELDS.filter(([key])=>!PRICE_KEYS.includes(key)).map(settingInput).join('')}</div><p class="hint">ค่าตั้งต้นเป็นสมมติฐานเพื่อประเมิน ไม่ใช่ค่ามาตรฐานบังคับ ใช้สเปกแบต/อินเวอร์เตอร์จริง และผลจำลอง PVWatts เฉพาะสถานที่ อัตราเฉลี่ยไม่ทดแทนบิลขั้นบันไดหรือ TOU</p><button class="btn primary" type="submit">บันทึกค่าคำนวณและคืนทุน</button><p id="calculationMessage" role="status"></p></form></div></div></div></section>`;
}
function mountSettings({getClient,modules,recalculate,report}){
 let company={},values=normalizeCalculation(),previewUrl=null;
 const initialDefaults={...modules.DEFAULTS},initialRates={...modules.BILL_RATES},initialPeriods={...modules.PERIOD_DEFAULTS};
 function tab(name){document.querySelectorAll('[data-settings-panel]').forEach(el=>el.hidden=el.dataset.settingsPanel!==name);document.querySelectorAll('[data-settings-tab]').forEach(el=>{const active=el.dataset.settingsTab===name;el.classList.toggle('active',active);el.setAttribute('aria-pressed',String(active));});}
 document.querySelectorAll('[data-settings-tab]').forEach(el=>el.onclick=()=>tab(el.dataset.settingsTab));
 document.querySelectorAll('[data-equipment-section]').forEach(button=>button.onclick=()=>{const name=button.dataset.equipmentSection;document.querySelectorAll('[data-equipment-view]').forEach(view=>view.hidden=view.dataset.equipmentView!==name);document.querySelectorAll('[data-equipment-section]').forEach(x=>{const active=x===button;x.classList.toggle('active',active);x.setAttribute('aria-pressed',String(active));});});
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

return {SETTING_FIELDS,normalizeCalculation,applyCalculation,validatePng,settingsMarkup,mountSettings};
})();

// ============================================================
// SolarTariffs — tariffs.js
// ============================================================
const SolarTariffs = (()=>{
const SOURCE='https://www.pea.co.th/en/our-services/tariff/ft?page=0';
const monthPattern=/^20\d{2}-(0[1-9]|1[0-2])$/;
function validateFeed(data){
 if(data?.schemaVersion!==1||!Array.isArray(data.ftRecords)||data.ftRecords.length>30||!['ok','degraded'].includes(data.status))throw Error('รูปแบบข้อมูลอัตราไม่รองรับ');
 if(!Number.isFinite(Date.parse(data.lastAttemptAt))||!data.base||typeof data.base.reviewRequired!=='boolean')throw Error('ข้อมูลวันที่หรือสถานะอัตราฐานไม่ครบ');
 for(const r of data.ftRecords){if(r.provider!=='PEA'||r.sourceUrl!==SOURCE||r.unit!=='THB/kWh'||typeof r.value!=='number'||!Number.isFinite(r.value)||r.value < -10||r.value>10||!monthPattern.test(r.from)||!monthPattern.test(r.to)||r.from.slice(0,4)!==r.to.slice(0,4)||![1,5,9].includes(Number(r.from.slice(5)))||Number(r.to.slice(5))!==Number(r.from.slice(5))+3||!Number.isFinite(Date.parse(r.checkedAt)))throw Error('ข้อมูล Ft ไม่ผ่านการตรวจค่า หน่วย แหล่งอ้างอิง หรือรอบเดือน');}
 const keys=data.ftRecords.map(r=>r.from);if(new Set(keys).size!==keys.length)throw Error('ข้อมูล Ft มีรอบเดือนซ้ำ');
 return data;
}
function selectFt(data,month,now=Date.now()){
 const matches=data.ftRecords.filter(r=>monthPattern.test(month)&&month>=r.from&&month<=r.to);
 if(matches.length!==1)return null;
 const r=matches[0],age=now-Date.parse(r.checkedAt);
 return {...r,stale:age>7*86400000||age < -86400000,feedDegraded:data.status!=='ok',baseReviewRequired:data.base.reviewRequired};
}
async function loadTariffs({fetcher=fetch,url=new URL('./data/tariffs.json',import.meta.url),timeout=5000}={}){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);
 try{const response=await fetcher(url,{signal:controller.signal,cache:'no-store'});if(!response.ok)throw Error('โหลดข้อมูลอัตราไม่สำเร็จ');const raw=await response.text();if(raw.length>100000)throw Error('ข้อมูลอัตรามีขนาดผิดปกติ');return validateFeed(JSON.parse(raw));}finally{clearTimeout(timer);}
}

return {validateFeed,selectFt,loadTariffs};
})();

// ============================================================
// หน้าจอ อุปกรณ์ CSV รูปภาพ และการเชื่อมต่อ
// ============================================================
// All local modules share the release token from index.html.
const release = new URL(import.meta.url).searchParams.get('v') || '20261013-5';
const localModule = name => new URL(name + '?v=' + encodeURIComponent(release), import.meta.url).href;
const { DEFAULT_PRICING, normalizePricing, backupFromAppliances, toCalcAppliance, designSystem, usagePlan, OFFICIAL_FT, OFFICIAL_RESIDENTIAL, officialFtForMonth, compareDesigns, DEFAULTS, BILL_RATES, PERIOD_DEFAULTS, equipmentIssue } = SolarCalculation;
const {settingsMarkup,mountSettings} = SolarSettings;
// หมวดอุปกรณ์และฟอร์มข้อมูล
const CATEGORIES={panel:['แผงโซลาร์','แผง',[['length_mm','ความยาว (มม.)'],['width_mm','ความกว้าง (มม.)']]],inverter:['อินเวอร์เตอร์','เครื่อง',[['mppt','จำนวน MPPT'],['max_dc_v','แรงดัน DC สูงสุด (V)']]],battery:['แบตเตอรี่','ชุด',[['voltage','แรงดันแบต (V)'],['bms','ระบบ BMS']]],cabinet:['ตู้ไฟ / Combiner','ตู้',[['voltage','แรงดันพิกัด (V)'],['ip','ระดับ IP'],['circuits','จำนวนวงจร']]],protection:['เบรกเกอร์ / ฟิวส์ / SPD','ชิ้น',[['acdc','AC / DC'],['voltage','แรงดันพิกัด (V)'],['current','กระแสพิกัด (A)'],['breaking','พิกัดตัดกระแส / SPD']]],cable:['สายไฟ','เมตร',[['area','พื้นที่หน้าตัด (ตร.มม.)'],['cores','จำนวนแกน'],['voltage','แรงดันพิกัด'],['material','วัสดุตัวนำ / ฉนวน']]],connector:['หัวต่อ / ขั้วต่อ','คู่',[['current','กระแสพิกัด (A)'],['voltage','แรงดันพิกัด (V)'],['compatible','รุ่นที่เข้ากันได้']]],conduit:['ท่อ / รางสายไฟ','เมตร',[['size','ขนาด'],['material','วัสดุ']]],mounting:['โครงสร้าง / รางยึดแผง','ชุด',[['roof','ประเภทหลังคา'],['material','วัสดุ'],['dimensions','ขนาด']]],grounding:['กราวด์ / ป้องกันฟ้าผ่า','ชุด',[['size','ขนาด / ความยาว'],['material','วัสดุ'],['rating','พิกัด']]],monitoring:['มิเตอร์ / ระบบติดตาม','เครื่อง',[['interface','การสื่อสาร'],['compatible','รุ่นที่รองรับ']]],backup:['ATS / อุปกรณ์สลับไฟ','ชุด',[['phase','จำนวนเฟส'],['current','กระแสพิกัด (A)'],['compatible','รุ่นที่รองรับ']]]};
for(const definition of Object.values(CATEGORIES))definition[2].push(['verification','สถานะตรวจสอบ (pending / verified)'],['notes','หมายเหตุข้อมูล']);
const DEFAULT_LOCATIONS=[{id:'home',name:'บ้านอยู่อาศัย',phase:'1PH',tariff:'residential',active:true},{id:'factory',name:'โรงงาน / อุตสาหกรรม',phase:'3PH',tariff:'industrial',active:true},{id:'business',name:'สำนักงาน / ธุรกิจ',phase:'3PH',tariff:'business',active:true}];
function normalizeLocations(rows){if(!Array.isArray(rows)||!rows.length||rows.length>50)throw Error('ประเภทสถานที่ต้องมี 1–50 รายการ');const ids=new Set();const result=rows.map(x=>{const id=String(x.id||''),name=String(x.name||'').trim();if(!/^[a-zA-Z0-9_-]{1,80}$/.test(id)||ids.has(id)||!name||name.length>100||!['1PH','3PH'].includes(x.phase)||!['residential','business','industrial'].includes(x.tariff))throw Error('ข้อมูลประเภทสถานที่ไม่ถูกต้องหรือรหัสซ้ำ');ids.add(id);return {id,name,phase:x.phase,tariff:x.tariff,active:x.active!==false};});if(!result.some(x=>x.active))throw Error('ต้องมีประเภทสถานที่เปิดใช้งานอย่างน้อยหนึ่งรายการ');return result;}
async function validateEquipmentImage(file){if(!file||!file.size||file.size>2097152)throw Error('รูปต้องมีขนาดไม่เกิน 2 MB');const b=new Uint8Array(await file.slice(0,12).arrayBuffer());const png=[137,80,78,71,13,10,26,10].every((v,i)=>b[i]===v),jpg=b[0]===255&&b[1]===216&&b[2]===255,webp=String.fromCharCode(...b.slice(0,4))==='RIFF'&&String.fromCharCode(...b.slice(8,12))==='WEBP';if(!png&&!jpg&&!webp)throw Error('รองรับเฉพาะภาพ PNG, JPEG และ WebP');const bitmap=await createImageBitmap(file);const valid=bitmap.width<=4096&&bitmap.height<=4096;bitmap.close();if(!valid)throw Error('รูปต้องไม่เกิน 4096 × 4096 พิกเซล');return png?'png':jpg?'jpg':'webp';}
function mountCatalog({getClient,getSettings,state,DEFAULTS,CAT,UNIT,esc,notify,calc,renderEquipment}){
 const $=id=>document.getElementById(id);let blob=null,photoPath=null,lastLocations='';
 Object.entries(CATEGORIES).forEach(([key,[label,unit]])=>{CAT[key]=label;UNIT[key]=unit;});
 $('eqCategory').innerHTML=Object.entries(CATEGORIES).map(([key,[name]])=>`<option value="${key}">${name}</option>`).join('');
 $('eqIsDefault').closest('label').insertAdjacentHTML('afterend',`<label>หน่วยนับ<input id="eqUnit" maxlength="30" required></label><fieldset id="eqSpecs"></fieldset><label>รูปอุปกรณ์ (PNG / JPEG / WebP ไม่เกิน 2 MB)<input id="eqImage" type="file" accept="image/png,image/jpeg,image/webp"></label><img id="eqImagePreview" class="equipment-photo" alt="ภาพตัวอย่างอุปกรณ์" hidden><label class="check"><input id="eqRemoveImage" type="checkbox">เอารูปออกจากรายการนี้</label><p class="hint">ราคาเป็นราคาต่อหน่วย รายการสายไฟ/ตู้และอุปกรณ์ประกอบเก็บไว้ในแค็ตตาล็อก การเลือกพิกัดต้องตรวจหน้างานก่อนใช้งาน</p>`);
 function imageUrl(path){if(!/^images\/[a-zA-Z0-9-]+\.(png|jpg|webp)$/.test(path||''))return '';return getClient()?.storage.from('equipment-assets').getPublicUrl(path)?.data?.publicUrl||'';}
 function photo(x){const url=imageUrl(x?.image_path);return url?`<img class="equipment-photo" src="${esc(url)}" alt="${esc((x.brand||'')+' '+(x.model||''))}" loading="eager">`:'';}
 document.addEventListener('error',e=>{if(e.target instanceof HTMLImageElement&&e.target.classList.contains('equipment-photo'))e.target.hidden=true;},true);
 function fields(x){const category=$('eqCategory').value,definition=CATEGORIES[category];$('eqUnit').value=x?.unit||definition[1];$('eqSpecs').innerHTML='<legend>รายละเอียดตามประเภทอุปกรณ์</legend>'+definition[2].map(([key,label])=>`<label>${label}<input data-equipment-spec="${key}" maxlength="200" value="${esc(x?.specs?.[key]||'')}"></label>`).join('');}
 function resetPhoto(x){if(blob)URL.revokeObjectURL(blob);blob=null;photoPath=x?.image_path||null;$('eqImage').value='';$('eqRemoveImage').checked=false;const url=imageUrl(photoPath);if(url)$('eqImagePreview').src=url;else $('eqImagePreview').removeAttribute('src');$('eqImagePreview').hidden=!url;}
 $('eqImage').onchange=async()=>{try{const file=$('eqImage').files[0];if(!file)return;await validateEquipmentImage(file);if(blob)URL.revokeObjectURL(blob);blob=URL.createObjectURL(file);$('eqImagePreview').src=blob;$('eqImagePreview').hidden=false;$('eqRemoveImage').checked=false;}catch(e){$('eqImage').value='';notify(e.message,'error');}};
 async function prepare(){const unit=$('eqUnit').value.trim();if(!unit)throw Error('ระบุหน่วยนับ');const specs=Object.fromEntries([...document.querySelectorAll('[data-equipment-spec]')].map(x=>[x.dataset.equipmentSpec,x.value.trim()]));let image_path=$('eqRemoveImage').checked?null:photoPath;const file=$('eqImage').files[0];if(file){const extension=await validateEquipmentImage(file);image_path='images/'+crypto.randomUUID()+'.'+extension;const {error}=await getClient().storage.from('equipment-assets').upload(image_path,file,{upsert:false,contentType:extension==='jpg'?'image/jpeg':'image/'+extension});if(error)throw error;}return {unit,specs,image_path};}
 const panel=document.querySelector('[data-settings-panel="calculation"]');panel.insertAdjacentHTML('beforeend',`<section class="panel form"><h3>ประเภทสถานที่และเฟสแนะนำ</h3><p class="hint">เฟสเป็นคำแนะนำ ปรับตามมิเตอร์จริงได้ กลุ่มอัตราประเมินต้องเลือกเอง ไม่ได้ตัดสินประเภทบิลจากชื่ออาคาร</p><div id="locationList"></div><form id="locationForm"><input id="locationId" type="hidden"><label>ชื่อประเภท<input id="locationName" required maxlength="100"></label><div class="grid2"><label>เฟสแนะนำ<select id="locationPhase"><option value="1PH">1 เฟส</option><option value="3PH">3 เฟส</option></select></label><label>กลุ่มอัตราประเมิน<select id="locationTariff"><option value="residential">บ้านอยู่อาศัย</option><option value="business">ธุรกิจ</option><option value="industrial">อุตสาหกรรม</option></select></label></div><div class="actions"><button class="btn primary">บันทึกประเภท</button><button class="btn" type="button" id="locationCancel">เพิ่มใหม่</button></div></form></section>`);
 const rows=()=>normalizeLocations(DEFAULTS.locationTypes||DEFAULT_LOCATIONS);
 const location=()=>rows().find(x=>x.id===$('buildingType').value)||rows().find(x=>x.active);
 function refreshLocations(){const list=rows(),key=JSON.stringify(list);if(lastLocations===key)return;lastLocations=key;const old=$('buildingType').value;$('buildingType').innerHTML=list.filter(x=>x.active).map(x=>`<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('');if(list.some(x=>x.active&&x.id===old))$('buildingType').value=old;else $('supplyPhase').value=location().phase;$('locationList').innerHTML=list.map(x=>`<div class="item"><span>${esc(x.name)} · ${x.phase==='1PH'?'1':'3'} เฟส · ${esc(x.tariff)} · ${x.active?'เปิด':'ปิด'}</span><div class="actions"><button class="btn small" type="button" data-location-edit="${esc(x.id)}">แก้ไข</button><button class="btn small" type="button" data-location-toggle="${esc(x.id)}">${x.active?'ไม่แสดง':'แสดง'}</button></div></div>`).join('');}
 $('locationCancel').onclick=()=>{$('locationForm').reset();$('locationId').value='';};
 $('locationList').onclick=async e=>{const edit=e.target.dataset.locationEdit,toggle=e.target.dataset.locationToggle;if(edit){const x=rows().find(x=>x.id===edit);$('locationId').value=x.id;$('locationName').value=x.name;$('locationPhase').value=x.phase;$('locationTariff').value=x.tariff;}if(toggle)try{await getSettings().saveLocations(normalizeLocations(rows().map(x=>x.id===toggle?{...x,active:!x.active}:x)));notify('บันทึกสถานะประเภทสถานที่แล้ว','success');}catch(error){notify(error.message,'error');}};
 $('locationForm').onsubmit=async e=>{e.preventDefault();const button=e.submitter||e.target.querySelector("button[type=submit],button:not([type])");button.disabled=true;try{const old=rows(),id=$('locationId').value||'location-'+crypto.randomUUID();const item={id,name:$('locationName').value,phase:$('locationPhase').value,tariff:$('locationTariff').value,active:old.find(x=>x.id===id)?.active??true};if(old.some(x=>x.id===id))old.splice(old.findIndex(x=>x.id===id),1,item);else old.push(item);await getSettings().saveLocations(normalizeLocations(old));$('locationForm').reset();notify('บันทึกประเภทสถานที่แล้ว','success');}catch(error){notify(error.message,'error');}finally{button.disabled=false;}};
 fields();refreshLocations();
 return {fields,resetPhoto,prepare,photo,location,refreshLocations,summary:x=>Object.values(x.specs||{}).filter(Boolean).map(x=>' · '+esc(x)).join('')};
}

// เทมเพลต ส่งออก และนำเข้า CSV
function csvHeaders(category){const extra={panel:['panel_wp','is_default'],inverter:['power_kw','system_type','phase'],battery:['capacity_kwh','system_type']}[category]||[];if(!CATEGORIES[category])throw Error('ไม่พบประเภทอุปกรณ์');return ['id','category','brand','model','cost','sell_price','active','unit','image_path','image_url',...extra,...CATEGORIES[category][2].map(([key])=>'spec_'+key)];}
function encodeCsv(rows){return '\uFEFF'+rows.map(row=>row.map(value=>{let text=String(value??'');if(typeof value==='string'&&/^[=+@-]/.test(text))text="'"+text;return /[",\r\n]/.test(text)?'"'+text.replaceAll('"','""')+'"':text;}).join(',')).join('\r\n')+'\r\n';}
function parseCsv(text){
 text=String(text).replace(/^\uFEFF/,'');let rows=[],row=[],field='',quoted=false,closed=false;
 const add=()=>{row.push(field);field='';closed=false;};const end=()=>{add();if(row.some(x=>x!==''))rows.push(row);row=[];if(rows.length>501)throw Error('นำเข้าได้ไม่เกิน 500 รายการต่อครั้ง');};
 for(let i=0;i<text.length;i++){const ch=text[i];if(quoted){if(ch==='"'){if(text[i+1]==='"'){field+='"';i++;}else{quoted=false;closed=true;}}else field+=ch;continue;}
 if(ch===','){add();continue;}if(ch==='\n'||ch==='\r'){if(ch==='\r'&&text[i+1]==='\n')i++;end();continue;}if(closed)throw Error('พบอักขระหลังเครื่องหมายปิดข้อความใน CSV');if(ch==='"'){if(field)throw Error('เครื่องหมายคำพูดใน CSV ไม่ถูกต้อง');quoted=true;}else field+=ch;
 }if(quoted)throw Error('เครื่องหมายคำพูดใน CSV ปิดไม่ครบ');if(field||closed||row.length)end();return rows;
}
function equipmentCsv(category,items=[],template=false){const headers=csvHeaders(category);return encodeCsv([headers,...(template?[]:items.filter(x=>x.category===category).map(x=>headers.map(key=>key.startsWith('spec_')?x.specs?.[key.slice(5)]||'':key==='category'?category:x[key]??'')))]);}
function validateEquipmentCsv(text,category,existing=[]){
 const rows=parseCsv(text),headers=rows.shift();if(!headers||!rows.length)throw Error('ไฟล์มีเฉพาะหัวตารางหรือไม่มีข้อมูล');const allowed=csvHeaders(category);if(new Set(headers).size!==headers.length||headers.some(x=>!allowed.includes(x)))throw Error('หัวคอลัมน์ไม่ถูกต้อง โปรดใช้เทมเพลตประเภทที่เลือก');for(const key of ['category','brand','model'])if(!headers.includes(key))throw Error('ขาดคอลัมน์ '+key);
 const ids=new Set(),names=new Set();let defaults=0;
 const str=v=>String(v??'').replace(/^'(?=[=+@-])/,'').trim();
 return rows.map((row,index)=>{try{
 if(row.length!==headers.length)throw Error('จำนวนคอลัมน์ไม่ตรงหัวตาราง');const data=Object.fromEntries(headers.map((h,i)=>[h,str(row[i])]));
 if(data.category!==category)throw Error('ประเภทไม่ตรงกับที่เลือก');if(!data.brand||!data.model||data.brand.length>200||data.model.length>200)throw Error('ต้องระบุยี่ห้อและรุ่นไม่เกิน 200 ตัวอักษร');
 const number=(key,required=false)=>{const value=data[key];if(value==null||value===''){if(required)throw Error('ต้องระบุ '+key);return null;}const n=Number(value);if(!Number.isFinite(n)||n<0||(required&&n<=0))throw Error(key+' ต้องเป็นตัวเลข'+(required?'มากกว่า 0':'ไม่ติดลบ'));return n;};
 const flag=(key,initial)=>{const v=(data[key]||'').toLowerCase();if(!v)return initial;if(['true','1'].includes(v))return true;if(['false','0'].includes(v))return false;throw Error(key+' ใช้ true/false หรือ 1/0');};
 let id=data.id||null;if(id){if(!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)||ids.has(id))throw Error('id ไม่ถูกต้องหรือซ้ำในไฟล์');if(!existing.some(x=>x.id===id&&x.category===category))throw Error('id ไม่พบในประเภทนี้ กรุณาส่งออกข้อมูลใหม่');ids.add(id);}
 const key=[category,data.brand.toLowerCase(),data.model.toLowerCase()].join('|');if(names.has(key))throw Error('ยี่ห้อและรุ่นซ้ำในไฟล์');names.add(key);if(!id&&existing.some(x=>x.category===category&&x.brand.trim().toLowerCase()===data.brand.toLowerCase()&&x.model.trim().toLowerCase()===data.model.toLowerCase()))throw Error('รุ่นนี้มีอยู่แล้ว ให้ส่งออกพร้อม id เพื่ออัปเดต');
 const image_url=data.image_url||'';if(image_url&&!validImageSource(image_url))throw Error('image_url ต้องเป็น HTTPS จากแหล่งรูปที่รองรับ');const unit=data.unit||CATEGORIES[category][1];if(unit.length>30)throw Error('หน่วยนับยาวเกิน 30 ตัวอักษร');const image_path=data.image_path||null;if(image_path&&!/^images\/[a-zA-Z0-9-]+\.(png|jpg|webp)$/.test(image_path))throw Error('image_path ต้องเป็นรูปที่อัปโหลดในระบบ');
 const payload={id,category,brand:data.brand,model:data.model,cost:number('cost')??0,sell_price:number('sell_price')??0,active:flag('active',true),unit,image_path,panel_wp:category==='panel'?number('panel_wp',flag('active',true)):null,power_kw:category==='inverter'?number('power_kw',flag('active',true)):null,capacity_kwh:category==='battery'?number('capacity_kwh',flag('active',true)):null,system_type:['inverter','battery'].includes(category)?data.system_type||null:null,phase:category==='inverter'?data.phase||null:null,is_default:category==='panel'&&flag('is_default',false),specs:{}};
 if(payload.panel_wp&&!Number.isInteger(payload.panel_wp))throw Error('panel_wp ต้องเป็นจำนวนเต็ม');if(payload.system_type&&!['On-Grid','Hybrid'].includes(payload.system_type))throw Error('system_type ใช้ On-Grid หรือ Hybrid');if(category==='inverter'&&(payload.active||payload.phase)&&!['1PH','3PH'].includes(payload.phase))throw Error('phase ต้องเป็น 1PH หรือ 3PH');
 if(payload.is_default&&++defaults>1)throw Error('กำหนดแผงเริ่มต้นได้หนึ่งรายการต่อไฟล์');for(const [key] of CATEGORIES[category][2]){const value=data['spec_'+key]||'';if(value.length>200)throw Error('รายละเอียด '+key+' ยาวเกิน 200 ตัวอักษร');payload.specs[key]=value;}
 if(image_url)payload.image_url=image_url;return payload;
 }catch(error){throw Error('แถว '+(index+2)+': '+error.message);}});
}

function validImageSource(value){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&(!u.port||u.port==='443')&&['r3solarcell.co.th','www.r3solarcell.co.th','sunnergytech.co.th','www.sunnergytech.co.th','static.wixstatic.com'].includes(u.hostname);}catch{return false;}}
// ดาวน์โหลดรูปและบันทึกใน Supabase Storage
async function importCsvImages(rows,client,onProgress=()=>{}){
 const payload=rows.map(x=>({...x})),failures=[],uploaded=[];let completed=0;
 const jobs=new Map();for(const row of payload){const url=row.image_url;delete row.image_url;if(!url)continue;if(!jobs.has(url))jobs.set(url,[]);jobs.get(url).push(row);}
 const queue=[...jobs];let cursor=0;
 await Promise.all(Array.from({length:Math.min(3,queue.length)},async()=>{while(cursor<queue.length){const [url,targets]=queue[cursor++];try{
 if(!validImageSource(url))throw Error('แหล่งรูปไม่รองรับ');
 const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),20000);let result;try{result=await client.functions.invoke('equipment-image-fetch',{body:{url},signal:controller.signal});}finally{clearTimeout(timer);}
 if(result.error)throw Error('ดึงรูปไม่สำเร็จ โปรดตรวจการติดตั้งฟังก์ชันและแหล่งรูป');const blob=result.data;if(!(blob instanceof Blob))throw Error('ข้อมูลรูปไม่ถูกต้อง');
 const ext=await validateEquipmentImage(blob),path='images/'+crypto.randomUUID()+'.'+ext;
 const {error}=await client.storage.from('equipment-assets').upload(path,blob,{upsert:false,contentType:ext==='jpg'?'image/jpeg':'image/'+ext});if(error)throw Error('บันทึกรูปไม่สำเร็จ: '+error.message);
 uploaded.push(path);for(const row of targets)row.image_path=path;
 }catch(e){for(const row of targets)failures.push({brand:row.brand,model:row.model,url,message:e.message});}finally{completed++;onProgress(completed,queue.length);}}}));
 return {rows:payload,failures,uploaded};
}

function mountEquipmentCsv({getClient,state,requireConnection,reload,notify,esc,equipmentIssue}){
 const $=id=>document.getElementById(id);let pending=null,committing=false;
 $('equipmentList').insertAdjacentHTML('beforebegin',`<section class="panel form csv-tools"><h3>นำเข้า / ส่งออก CSV</h3><p class="hint">image_url รับลิงก์ HTTPS ของ R3 Solarcell, Sunnergy และ Wix ดึงรูปเมื่อยืนยันนำเข้า หากดึงไม่ได้ยังบันทึกอุปกรณ์ได้ รูปเดิมใน image_path จะคงอยู่</p><label>ประเภทอุปกรณ์<select id="csvCategory">${Object.entries(CATEGORIES).map(([key,[label]])=>`<option value="${key}">${label}</option>`).join('')}</select></label><div class="actions"><button id="csvTemplate" type="button" class="btn">ดาวน์โหลดเทมเพลต</button><button id="csvExport" type="button" class="btn">ส่งออกข้อมูลประเภทนี้</button></div><label>ไฟล์ CSV (UTF-8 ไม่เกิน 2 MB / 500 รายการ)<input id="csvFile" type="file" accept=".csv,text/csv"></label><button id="csvCheck" type="button" class="btn">ตรวจข้อมูลก่อนนำเข้า</button><div id="csvPreview" role="status"></div><button id="csvCommit" type="button" class="btn primary" hidden>ยืนยันนำเข้าและบันทึกฐานข้อมูล</button></section>`);
 function download(text,name){const url=URL.createObjectURL(new Blob([text],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);notify('สร้างไฟล์ CSV แล้ว','success');}
 $('csvTemplate').onclick=()=>download(equipmentCsv($('csvCategory').value,[],true),'equipment-'+$('csvCategory').value+'-template.csv');
 $('csvExport').onclick=()=>download(equipmentCsv($('csvCategory').value,state.equipment),'equipment-'+$('csvCategory').value+'.csv');
 const reset=()=>{if(committing)return;pending=null;$('csvCommit').hidden=true;$('csvPreview').replaceChildren();};$('csvCategory').onchange=()=>{reset();$('csvFile').value='';};$('csvFile').onchange=reset;
 $('csvCheck').onclick=async()=>{reset();if(committing)return;const button=$('csvCheck');button.disabled=true;try{const file=$('csvFile').files[0];if(!file||file.size>2097152||!file.name.toLowerCase().endsWith('.csv'))throw Error('เลือกไฟล์ CSV ไม่เกิน 2 MB');const text=new TextDecoder('utf-8',{fatal:true}).decode(await file.arrayBuffer());pending=validateEquipmentCsv(text,$('csvCategory').value,state.equipment);for(const row of pending){const issue=equipmentIssue(row);if(issue)throw Error(row.model+': '+issue);}const add=pending.filter(x=>!x.id).length,update=pending.length-add;
 $('csvPreview').innerHTML=`<p>ผ่าน ${pending.length} รายการ: เพิ่ม ${add} / อัปเดต ${update}</p><div class="table-wrap"><table class="cost"><thead><tr><th>ยี่ห้อ</th><th>รุ่น</th><th>ราคาขาย</th><th>หน่วย</th></tr></thead><tbody>${pending.slice(0,10).map(x=>`<tr><td>${esc(x.brand)}</td><td>${esc(x.model)}</td><td>${x.sell_price}</td><td>${esc(x.unit)}</td></tr>`).join('')}</tbody></table></div>`;$('csvCommit').hidden=false;notify('ตรวจข้อมูล CSV ผ่านแล้ว ยังไม่ได้บันทึก','info');
 }catch(error){pending=null;notify('ตรวจ CSV ไม่ผ่าน: '+error.message,'error');$('csvPreview').textContent=error.message;}finally{button.disabled=false;}};
 $('csvCommit').onclick=async()=>{
 if(committing||!pending||!await requireConnection())return;committing=true;const button=$('csvCommit');const controls=['csvCommit','csvCheck','csvCategory','csvFile','csvExport','csvTemplate'].map($);controls.forEach(x=>x.disabled=true);const status=$('csvPreview');let imported=null;
 try{
 imported=await importCsvImages(pending,getClient(),(done,total)=>{button.textContent='กำลังนำเข้ารูป '+done+' / '+total;});
 const {data,error}=await getClient().rpc('solar_import_equipment',{rows:imported.rows});if(error)throw error;
 pending=null;committing=false;reset();$('csvFile').value='';
 if(imported.failures.length){const message=document.createElement('p');message.textContent='บันทึกข้อมูลแล้ว แต่ดึงรูปไม่ได้ '+imported.failures.length+' รายการ';const download=document.createElement('button');download.className='btn';download.textContent='ดาวน์โหลดรายการรูปที่ไม่สำเร็จ';download.onclick=()=>downloadReport(imported.failures);status.append(message,download);notify(message.textContent,'info');}
 notify('นำเข้า CSV สำเร็จ '+(data?.inserted??0)+' รายการใหม่ / '+(data?.updated??0)+' รายการอัปเดต','success');try{await reload();}catch(e){notify('บันทึกแล้ว แต่โหลดรายการใหม่ไม่สำเร็จ กรุณาโหลดหน้าใหม่','error');}
 }catch(error){
 // Keep successfully uploaded paths for retry; do not delete assets when an RPC response is ambiguous.
 if(imported)pending=imported.rows;
 notify('ยังยืนยันการบันทึกไม่ได้: '+error.message+' โปรดโหลดรายการเพื่อตรวจสอบก่อนนำเข้าซ้ำ','error');
 }finally{committing=false;controls.forEach(x=>x.disabled=false);button.textContent='ยืนยันนำเข้าและบันทึกฐานข้อมูล';}
 };
 function downloadReport(rows){download(encodeCsv([['brand','model','image_url','error'],...rows.map(x=>[x.brand,x.model,x.url,x.message])]),'รูปที่นำเข้าไม่สำเร็จ.csv');}
}

function notify(message,type){
 type=type||(/ไม่สำเร็จ|ผิดพลาด|ต้อง|ไม่สามารถ|ยังไม่มี|ตรวจชื่อ|มากกว่า 0/.test(message)?'error':/บันทึก|ลบแล้ว|อัปเดตแล้ว|เปลี่ยนสถานะแล้ว/.test(message)?'success':'info');
 let host=document.getElementById('notificationHost');if(!host){host=document.createElement('div');host.id='notificationHost';host.className='notification-host';document.body.append(host);}
 const card=document.createElement('div');card.className='notification '+type;card.setAttribute('role',type==='error'?'alert':'status');
 const icon=document.createElement('span');icon.className='notification-icon';icon.textContent=type==='success'?'✓':type==='error'?'!':'i';
 const body=document.createElement('div');const title=document.createElement('strong');title.textContent=type==='success'?'ดำเนินการสำเร็จ':type==='error'?'โปรดตรวจสอบ':'แจ้งให้ทราบ';const text=document.createElement('p');text.textContent=message;body.append(title,text);
 const close=document.createElement('button');close.type='button';close.setAttribute('aria-label','ปิดการแจ้งเตือน');close.textContent='×';close.onclick=()=>card.remove();card.append(icon,body,close);host.append(card);while(host.children.length>4)host.firstElementChild.remove();if(type!=='error')setTimeout(()=>card.remove(),6500);
}
async function askConfirm(message){
 return new Promise(resolve=>{const d=document.createElement('dialog');d.className='action-confirm';const h=document.createElement('h3');h.textContent='ยืนยันการดำเนินการ';const p=document.createElement('p');p.textContent=message;const actions=document.createElement('div');actions.className='actions';const cancel=document.createElement('button');cancel.className='btn';cancel.textContent='ยกเลิก';const ok=document.createElement('button');ok.className='btn danger';ok.textContent='ยืนยัน';const finish=value=>{d.close();d.remove();resolve(value);};cancel.onclick=()=>finish(false);ok.onclick=()=>finish(true);d.addEventListener('cancel',e=>{e.preventDefault();finish(false);});actions.append(cancel,ok);d.append(h,p,actions);document.body.append(d);d.showModal();cancel.focus();});
}

let supabase = null;
let settings = null;
let demoMode = true;
const dataErrors = new Map();
function dataStatus(table, error) {
  if (error) dataErrors.set(table, error.message || String(error));
  else dataErrors.delete(table);
  if (supabase) setConnection(dataErrors.size
    ? 'เชื่อมต่อได้บางส่วน: ' + [...dataErrors.keys()].join(', ') + (demoMode ? ' • ใช้อุปกรณ์ตัวอย่าง ห้ามใช้เสนอราคาจริง' : '')
    : 'เชื่อมต่อ Supabase • โหลดข้อมูลแล้ว');
}
function setConnection(message) {
  const el = document.querySelector('.mode');
  if (el) { el.textContent = message; el.setAttribute('role', 'status'); }
}
function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(label + ' หมดเวลารอ')), ms);
  })]).finally(() => clearTimeout(timer));
}
async function boundedFetch(input, init = {}) {
  const controller = new AbortController();
  const abort = () => controller.abort(init.signal?.reason);
  if (init.signal?.aborted) abort();
  else init.signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(input, { ...init, signal: controller.signal });
    // Include response-body download in the timeout, not only headers.
    const body = await response.arrayBuffer();
    return new Response([204, 205, 304].includes(response.status) ? null : body, { status: response.status, statusText: response.statusText, headers: response.headers });
  } finally {
    clearTimeout(timer);
    init.signal?.removeEventListener('abort', abort);
  }
}

const state = { equipment: [], assessments: [], appliances: [], apQty: {}, apNote: '', pricing: { ...DEFAULT_PRICING }, editEq: null, editAp: null, last: null };
const $ = id => document.getElementById(id);
const num = id => Number($(id).value || 0);
let catalog;
const buildingTariff = () => catalog?.location()?.tariff || 'residential';
const radio = n => document.querySelector(`input[name="${n}"]:checked`)?.value;
const money = v => new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB', maximumFractionDigits: 0 }).format(Number(v || 0));
const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const uuidOrNull = v => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(v || '')) ? v : null;
const seg = (name, opts) => `<div class="seg">${opts.map(([v, l], i) => `<label><input type="radio" name="${name}" value="${v}" ${i ? '' : 'checked'}><span>${l}</span></label>`).join('')}</div>`;
const CAT = { panel: 'แผงโซลาร์', inverter: 'Inverter', battery: 'แบตเตอรี่' }, UNIT = { panel: 'แผง', inverter: 'ตัว', battery: 'ลูก' };
const coreSpec = x => x.panel_wp ? `${x.panel_wp} Wp` : x.power_kw ? `${x.power_kw} kW` : x.capacity_kwh ? `${x.capacity_kwh} kWh` : '';

/* ---------- โครงหน้า ---------- */
$('app').innerHTML = `
<header class="top">
  <div class="brand"><img id="companyBrandLogo" class="brand-logo" alt="โลโก้บริษัท" hidden><span class="mark" id="brandFallback">☀</span><div><b id="companyBrandName">Solar Office Pro</b><small>Solar Sales & Sizing Suite</small></div></div>
  <nav class="nav">${[
    ['calculator','⌁','ประเมินระบบ'],
    ['history','◷','ประวัติลูกค้า'],
    ['settings','⚙','ตั้งค่าระบบ']
  ].map(([id,icon,l],i)=>`<button data-page="${id}" class="${i?'':'active'}"><span class="nav-icon">${icon}</span><span>${l}</span></button>`).join('')}</nav>
  <span class="mode">กำลังเชื่อมต่อ • ข้อมูลตัวอย่าง ไม่ใช้เสนอราคาจริง</span>
</header>
<main>
<section id="calculator" class="page active"><div class="calc">

<div class="inputs" id="inputs">
  <section class="step"><h2>ข้อมูลลูกค้าและโครงการ</h2>
    <div class="grid3"><label>ชื่อลูกค้า<input id="customerName" placeholder="คุณสมชาย / บริษัท ABC"></label><label>เบอร์โทร<input id="phone" inputmode="tel"></label><label>สถานที่ / โครงการ<input id="siteName"></label></div>
  </section>
  <section class="step"><h2>สถานที่ใช้งานและระบบไฟ</h2><p class="hint">เลือกสถานที่และเฟสให้ตรงกับมิเตอร์จริง ประเภทบิลต้องตรวจจากใบแจ้งค่าไฟ</p>
    <div class="grid2">
      <label>ประเภทสถานที่ใช้งาน<select id="buildingType"><option value="home">บ้านอยู่อาศัย</option><option value="factory">โรงงาน / อุตสาหกรรม</option><option value="business">สำนักงาน / ธุรกิจ</option></select></label>
      <label>โครงสร้างระบบไฟ<select id="supplyPhase"><option value="1PH">1 เฟส</option><option value="3PH">3 เฟส</option></select><small>บ้านตั้งต้น 1 เฟส โรงงาน/ธุรกิจ 3 เฟส ปรับให้ตรงกับมิเตอร์จริงได้</small></label>
    </div>
  </section>
  <section class="step"><h2>ช่วงเวลาใช้งานและประเภทระบบ</h2>
    <div class="field"><span>ช่วงเวลาใช้ไฟหลัก</span>${seg('usagePeriod', [['day', '☀ กลางวัน'], ['night', '☾ กลางคืน'], ['both', '◐ ทั้งกลางวัน–กลางคืน']])}</div>
    <div class="daytime-control" id="daytimeControl"><div><label>สัดส่วนใช้ไฟช่วงกลางวัน<select id="daytimeMode"><option value="auto">อัตโนมัติตามช่วงเวลาที่เลือก</option><option value="manual">ปรับเอง</option></select></label><p><output id="daytimeReadout" for="daytimeSlider">—</output><span id="daytimeNightReadout"></span></p><small id="periodAssumption"></small><p class="hint" id="daytimeModeNote">สัดส่วนอัตโนมัติเป็นค่าตั้งต้นสำหรับประเมิน ไม่ใช่ข้อมูลจากมิเตอร์</p></div><div class="daytime-tube"><span>100%</span><input id="daytimeSlider" type="range" min="0" max="100" step="1" value="90" aria-label="สัดส่วนใช้ไฟกลางวัน" aria-orientation="vertical" disabled><span>0%</span></div><input id="daytimePercent" type="hidden" value=""></div>
    <div class="period-guide">
      <p><b>☀ กลางวัน</b> = On-Grid (ไม่ต้องมีแบต) โดยทั่วไปคืนทุนเร็วสุด</p>
      <p><b>☾ กลางคืน</b> = Hybrid (แบตใหญ่) เก็บไฟไว้ใช้ตอนกลางคืน</p>
      <p><b>◐ ทั้งคู่</b> = Hybrid (แบตกลาง) ใช้ตลอดวัน + กันไฟดับตามโหลดที่เลือก</p>
      <small>ขนาดแบตจริงคำนวณจากการใช้ไฟและโหลดสำรอง ไม่ใช่ขนาดตายตัว</small>
    </div>
    <div class="field system-choice"><span>ประเภทระบบ (ปรับเองได้)</span>${seg('systemType', [['On-Grid', 'On-Grid'], ['Hybrid', 'Hybrid (มีแบตเตอรี่)']])}</div>
  </section>

  <section class="step"><h2>ข้อมูลการใช้ไฟและงบประมาณ</h2><div class="field method-choice"><span>วิธีประเมิน</span>${seg('calcMode', [['usage', 'จากการใช้ไฟ'], ['budget', 'จากงบประมาณ']])}</div>
    <div id="budgetRow" class="grid2" hidden><label>งบประมาณลูกค้า (บาท)<input id="budgetAmount" type="number" placeholder="เช่น 100000"></label></div>
    <div class="grid2">
      <label>หน่วยไฟต่อเดือน (kWh)<input id="monthlyKwh" type="number" placeholder="เช่น 1200"><small>เว้นว่างได้ ระบบจะประมาณจากค่าไฟ</small></label>
      <label>ค่าไฟต่อเดือน (บาท)<input id="monthlyBill" type="number" placeholder="เช่น 5000"></label>
      
    </div>
    <details class="calculation-basis"><summary>ข้อมูลอ้างอิงผลผลิตและวิธีคิดค่าไฟ</summary>
      <p class="hint">ระบุข้อมูลจากบิลและผลจำลองเพื่อให้ประมาณการใกล้เคียงโครงการจริง</p>
      <div class="grid2">
        <label>วิธีคิดค่าไฟ<select id="billingMode"><option value="auto">อัตโนมัติ: บ้านใช้อัตรา PEA 1.1.2 ตั้งต้น / อื่น ๆ ประมาณการ</option><option value="estimate">ประมาณการจากค่าเฉลี่ย (ยังไม่ยืนยัน)</option><option value="pea111">PEA บ้าน 1.1.1 ตามประเภทที่ระบุในบิล</option><option value="pea112">PEA บ้าน 1.1.2 ตามประเภทที่ระบุในบิล</option></select></label>
        <label>รอบบิล<input id="billingMonth" type="month"><small>ใช้ประเภทอัตราตามบิล ไม่เลือกจากประเภทอาคาร</small></label>
        <label>ค่าบริการก่อน VAT (บาท/เดือน)<input id="serviceCharge" type="number" min="0" step="any"><small>กรอกตามบิล ต้องจ่ายต่อหลังติดตั้งโซลาร์</small></label>
        
        
        
        
        
        
        
      </div>
      <div class="tariff-reference"><b>ข้อมูลอ้างอิงที่ตรวจแล้ว</b><p id="tariffReferenceNote">PEA: Ft 0.1623 บาท/หน่วย สำหรับ ก.ย.–ธ.ค. 2569 • ตรวจ 11 ต.ค. 2569 • กำลังตรวจข้อมูลจากไฟล์อัปเดตอัตโนมัติ</p><button type="button" class="btn" id="refreshTariffFeed">ตรวจข้อมูลที่เผยแพร่ล่าสุด</button><button type="button" class="btn" id="applyOfficialFt">ใช้ Ft อ้างอิงให้ตรงรอบบิล</button><p id="ftSourceNote" role="status">ค่า Ft ใช้จากอัตราอ้างอิงของระบบตามรอบบิล</p><a href="https://www.pea.co.th/en/our-services/tariff/ft?page=0" target="_blank" rel="noopener">ตรวจประกาศ Ft ทางการ</a></div>
      <p class="hint">ไฟส่วนเกินไม่มีรายได้ ใช้ผลผลิตหลังบ้านและสัดส่วนกลางวัน–กลางคืนในแบบจำลองวันตัวอย่าง ต้องตรวจแดด เงาบัง และพฤติกรรมจริงก่อนเสนอราคา</p>
      <p class="hint"><a href="https://www.pea.co.th/news/corporate-news/2412" target="_blank" rel="noopener">อัตรา PEA บ้าน เริ่มกันยายน 2569</a></p>
    </details><p class="hint" id="usageNote"></p><p class="hint" id="planNote"></p>
  </section>

  <section class="step" id="backupStep" hidden><h2>อุปกรณ์ที่ต้องการสำรองไฟ</h2><p class="hint">สำหรับ Hybrid: เลือกเฉพาะโหลดที่ต้องใช้งานเมื่อไฟดับ</p>
    <div class="row-between"><label class="inline">สำรองไฟนาน (ชั่วโมง)<input id="backupHours" type="number" step="0.5" min="0" placeholder="เช่น 5"></label><button type="button" class="link" data-go="appliances">จัดการรายการโหลด</button></div>
    <div id="applianceList" class="ap-list"></div>
    <div class="figures"><div><span>โหลดต่อเนื่อง</span><b id="bkCont">—</b></div><div><span>โหลดสูงสุด (Surge)</span><b id="bkSurge">—</b></div><div><span>แบตเตอรี่ที่ต้องใช้</span><b id="bkBat">—</b></div></div>
  </section>

  <section class="step equipment-step"><div class="step-head"><div><h2>ชุดอุปกรณ์โซลาร์ที่ติดตั้ง</h2><p class="hint">ค่าเริ่มต้นเป็น “อัตโนมัติ” ระบบจะเลือกรุ่นและจำนวนที่เหมาะสมให้ตามข้อมูลที่กรอก</p></div><div class="equipment-actions"><button type="button" class="btn btn-auto" id="autoEquipmentBtn"><span class="btn-icon">✦</span> เลือกอัตโนมัติ</button></div></div>
    ${Object.keys(CAT).map(c => `<div class="eq-row" id="row_${c}"><span class="eq-name">${CAT[c]}</span><select id="sel_${c}" aria-label="${CAT[c]}"></select><label class="qty"><input id="qty_${c}" type="number" min="0" step="1" placeholder="อัตโนมัติ" aria-label="จำนวน${CAT[c]}"><span>${UNIT[c]}</span></label></div>`).join('')}
  </section>

  <section class="step"><h2>หมายเหตุและเอกสารเสนอราคา</h2><textarea id="notes" placeholder="รายละเอียดเพิ่มเติม (ไม่บังคับ)"></textarea>
    <div class="actions"><button class="btn primary" id="saveBtn"><span class="btn-icon">✓</span> บันทึกการประเมิน</button><button class="btn btn-soft" id="printBtn"><span class="btn-icon">▣</span> พิมพ์ / PDF</button></div></section>
</div>

<aside class="result" id="result"><div class="print-company"><img id="printCompanyLogo" alt="โลโก้บริษัท" hidden><h2 id="printCompanyName">Solar Office Pro</h2><p id="printCompanyDetails"></p></div>
  <div id="resultEmpty" class="empty" hidden></div>
  <div id="resultBody">
    <div class="headline"><button type="button" disabled data-detail="finInvestment" class="headline-invest dashboard-detail"><span>เงินลงทุนเริ่มต้น (รวม VAT)</span><b id="rTotal">—</b><span class="detail-link">ดูรายละเอียดต้นทุน ↗</span></button><button type="button" disabled data-detail="ovSystem" class="headline-system dashboard-detail"><span>ระบบที่เสนอและความจุแบตติดตั้ง</span><strong id="rSystem">—</strong><span class="detail-link">ดูรายละเอียดชุดอุปกรณ์ ↗</span></button></div>
    <section class="overview-panel">
      <div class="overview-title">สรุปภาพรวมระบบ <span id="overviewCustomer">—</span></div>
      <div class="overview-grid">
        <button type="button" disabled data-detail="ovSystem" class="overview-card dashboard-detail"><b id="ovSystem">—</b><span>ขนาดระบบโซลาร์เซลล์</span><span class="detail-link">ดูรายละเอียด ↗</span></button>
        <button type="button" disabled data-detail="ovBattery" class="overview-card dashboard-detail"><b id="ovBattery">—</b><span id="ovBatteryLabel">แบตที่ต้องใช้จากโหลดสำรอง</span><span class="detail-link">ดูรายละเอียด ↗</span></button>
        <button type="button" disabled data-detail="ovGeneration" class="overview-card dashboard-detail"><b id="ovGeneration">—</b><span>พลังงานผลิตได้ต่อปี</span><span class="detail-link">ดูรายละเอียด ↗</span></button>
        <button type="button" disabled data-detail="ovSavingPct" class="overview-card dashboard-detail"><b id="ovSavingPct">—</b><span>ลดค่าไฟโดยประมาณ</span><span class="detail-link">ดูรายละเอียด ↗</span></button>
      </div>
    </section>
    <section class="panel finance-summary" aria-labelledby="financeHeading">
      <h3 id="financeHeading">ภาพรวมการลงทุนและจุดคุ้มทุน</h3>
      <div class="finance-grid">
        <button type="button" disabled class="finance-card investment dashboard-detail" data-detail="finInvestment"><span>เงินลงทุนเริ่มต้น</span><b id="finInvestment">—</b><small>จ่ายครั้งแรก รวม VAT</small><span class="detail-link">ดูรายละเอียด ↗</span></button>
        <button type="button" disabled class="finance-card payback dashboard-detail" data-detail="rPay"><span>จุดคุ้มทุนโดยประมาณ</span><b id="rPay">—</b><small>ประหยัดสะสมเท่ากับเงินลงทุน</small><span class="detail-link">ดูรายละเอียด ↗</span></button>
        <button type="button" disabled class="finance-card accumulated dashboard-detail" data-detail="finAccumulated"><span>ประหยัดสะสม 25 ปี</span><b id="finAccumulated">—</b><small>ก่อนหักเงินลงทุน</small><span class="detail-link">ดูรายละเอียด ↗</span></button>
        <button type="button" disabled class="finance-card profit dashboard-detail" data-detail="rProfit"><span>ผลตอบแทนหลังหักเงินลงทุน 25 ปี</span><b id="rProfit">—</b><small>ประหยัดสะสม − เงินลงทุนเริ่มต้น</small><span class="detail-link">ดูรายละเอียด ↗</span></button>
      </div>
      <p class="finance-story" id="finNarrative"></p>
    </section>
    <section class="panel savings-panel"><h3>ค่าไฟฟ้าที่ประหยัดได้</h3><div class="savings-grid"><div><span id="svBillLabel">ค่าไฟปัจจุบัน/เดือน</span><b id="svBill">—</b></div><div><span>ประหยัด/เดือน</span><b id="svMonth">—</b></div><div><span>ประหยัด/ปี</span><b id="svYear">—</b></div><div><span>ค่าไฟคงเหลือโดยประมาณ</span><b id="svRemain">—</b></div></div></section>
    <section class="panel"><h3>เปรียบเทียบขนาดแผงและส่วนเพิ่ม Hybrid</h3><p class="hint">เทียบประมาณ 80%, 100%, 120% ของจำนวนแผงปัจจุบันภายใต้สมมติฐานเดียวกัน ไม่ใช่ผลออกแบบที่ยืนยันว่าเหมาะที่สุด ขนาดและจำนวนเครื่องเปลี่ยนตามอุปกรณ์ที่มี</p><div class="table-wrap"><table class="cost"><thead><tr><th>แผง / kWp</th><th class="r">เงินลงทุน</th><th class="r">ประหยัด/ปี</th><th class="r">คืนทุน</th><th class="r">NPV 25 ปี</th></tr></thead><tbody id="systemComparison"></tbody></table></div><p id="batteryComparison" class="hint"></p></section>
    <section class="panel"><h3>เส้นทางคืนทุนและเงินประหยัดสะสม</h3><div class="chart-wrap" id="chart"></div><div id="chartTooltip" class="chart-tooltip" role="tooltip" hidden></div><div class="table-wrap annual-wrap"><table class="cost annual-table"><caption>รายละเอียดเงินลงทุนและเงินประหยัดรายปี (บาท)</caption><thead><tr><th>ปี</th><th class="r">ประหยัดค่าไฟ</th><th class="r">ประหยัดสะสม</th><th class="r">สุทธิหลังหักลงทุน</th></tr></thead><tbody id="annualBody"></tbody></table></div><details class="financial-details"><summary>ดูตัวชี้วัดเพิ่มเติม: ROI / IRR / NPV / CO₂</summary><dl class="specs" id="rEco"></dl></details><p class="hint">ผลตอบแทนก่อนค่าใช้จ่ายในอนาคต</p></section>
    <section class="panel"><h3>รายละเอียดชุดอุปกรณ์และเงินลงทุน</h3><div class="table-wrap"><table class="cost"><thead><tr><th>รายการ</th><th class="r">จำนวน</th><th class="r">จำนวนเงิน</th></tr></thead><tbody id="rCost" class="screen-costs"></tbody><tbody id="quoteCost" class="print-costs"></tbody></table></div></section>
    <section class="panel"><h3>การผลิตไฟฟ้า</h3><dl class="specs" id="rGen"></dl></section><section class="print-terms" id="printCompanyTerms"></section>

  </div>
</aside><dialog id="dashboardDialog" aria-labelledby="dashboardDetailTitle"><div class="dialog-heading"><h2 id="dashboardDetailTitle"></h2><button type="button" id="closeDashboardDetail" aria-label="ปิดรายละเอียด">✕</button></div><div id="dashboardDetailBody"></div><button type="button" class="btn" id="detailGo">เปิดหมวดที่เกี่ยวข้อง ↓</button></dialog>
</div></section>

<section id="history" class="page"><div class="head"><h1>ประวัติการประเมิน</h1><button class="btn" id="refreshHistoryBtn">รีเฟรช</button></div>
  <div class="figures big" id="histStats"></div>
  <div class="panel"><div class="table-wrap"><table class="cost"><thead><tr><th>วันที่</th><th>ลูกค้า</th><th>ระบบ</th><th class="r">kWp</th><th class="r">ราคาโครงการ</th><th class="r">คืนทุน</th><th></th></tr></thead><tbody id="historyBody"></tbody></table></div></div></section>

${settingsMarkup("<section id=\"equipment\" class=\"settings-subsection\"><div class=\"head\"><h1>ฐานข้อมูลอุปกรณ์</h1><button class=\"btn\" id=\"refreshEquipmentBtn\">รีเฟรช</button></div>\n  <div class=\"admin\"><form class=\"panel form\" id=\"equipmentForm\"><h3 id=\"equipmentFormTitle\">เพิ่มอุปกรณ์</h3>\n    <label>ประเภท<select id=\"eqCategory\"><option value=\"panel\">แผงโซลาร์</option><option value=\"inverter\">Inverter</option><option value=\"battery\">แบตเตอรี่</option></select></label>\n    <div class=\"grid2\"><label>ยี่ห้อ<input id=\"eqBrand\" required></label><label>รุ่น<input id=\"eqModel\" required></label></div>\n    <label class=\"f-panel\">กำลังแผง (Wp)<input id=\"eqPanelWp\" type=\"number\"></label>\n    <label class=\"f-inverter\">กำลัง Inverter (kW)<input id=\"eqPowerKw\" type=\"number\" step=\"0.1\"></label>\n    <label class=\"f-battery\">ความจุ (kWh)<input id=\"eqCapacityKwh\" type=\"number\" step=\"0.1\"></label>\n    <label class=\"f-inverter f-battery\">ใช้ได้กับระบบ<select id=\"eqSystemType\"><option value=\"\">ทุกระบบ</option><option>On-Grid</option><option>Hybrid</option></select></label>\n    <label class=\"f-inverter\">เฟส<select id=\"eqPhase\"><option value=\"\">ไม่ระบุ</option><option value=\"1PH\">1 Phase</option><option value=\"3PH\">3 Phase</option></select></label>\n    <div class=\"grid2\"><label>ต้นทุน<input id=\"eqCost\" type=\"number\"></label><label>ราคาขาย<input id=\"eqSellPrice\" type=\"number\"></label></div>\n    <label class=\"f-panel\">ใช้เป็นแผงเริ่มต้น<select id=\"eqIsDefault\"><option value=\"false\">ไม่ใช่</option><option value=\"true\">ใช่</option></select></label>\n    <div class=\"actions\"><button class=\"btn primary\" type=\"submit\">บันทึก</button><button class=\"btn\" type=\"button\" id=\"eqCancelBtn\">ล้างฟอร์ม</button></div></form>\n    <div class=\"panel\" id=\"equipmentList\"></div></div></section>","<section id=\"appliances\" class=\"settings-subsection\"><div class=\"head\"><h1>โหลดสำรองสำหรับระบบ Hybrid</h1></div>\n  <p class=\"hint wide\" id=\"apNote\"></p>\n  <div class=\"admin\"><form class=\"panel form\" id=\"applianceForm\"><h3 id=\"applianceFormTitle\">เพิ่มเครื่องใช้ไฟฟ้า</h3>\n    <label>ชื่อเครื่องใช้ไฟฟ้า<input id=\"apName\" required placeholder=\"เช่น แอร์ 9,000 BTU\"></label>\n    <label>กำลังไฟขณะทำงาน (W)<input id=\"apPower\" type=\"number\" min=\"1\" required></label>\n    <label class=\"check\"><input id=\"apSurge\" type=\"checkbox\"><span>มีไฟกระชากตอนสตาร์ท (Surge)</span></label>\n    <label id=\"apFactorRow\" hidden>ตัวคูณ Surge (เท่า)<input id=\"apFactor\" type=\"number\" min=\"1\" step=\"0.1\" value=\"3\"></label>\n    <div class=\"grid2\"><label>ลำดับแสดงผล<input id=\"apSort\" type=\"number\" min=\"0\" value=\"0\"></label><label class=\"check align-end\"><input id=\"apActive\" type=\"checkbox\" checked><span>เปิดแสดงในหน้าประเมิน</span></label></div>\n    <div class=\"actions\"><button class=\"btn primary\" type=\"submit\">บันทึก</button><button class=\"btn\" type=\"button\" id=\"apCancelBtn\">ล้างฟอร์ม</button></div></form>\n    <div class=\"panel\" id=\"applianceAdmin\"></div></div></section>","<section id=\"pricing\" class=\"settings-subsection\"><div class=\"head\"><h1>ราคาติดตั้ง</h1><button class=\"btn\" id=\"loadPricingBtn\">รีเฟรช</button></div>\n  <form class=\"panel form narrow\" id=\"pricingForm\"><p class=\"hint\">ใช้คำนวณราคาโครงการทั้งโหมดการใช้ไฟและโหมดงบประมาณ</p>\n    <div class=\"grid2\"><label>ค่าแรงติดตั้ง / kWp<input id=\"laborPerKwp\" type=\"number\"></label><label>โครงสร้างและราง / kWp<input id=\"structurePerKwp\" type=\"number\"></label><label>สายไฟและอุปกรณ์ / kWp<input id=\"wiringPerKwp\" type=\"number\"></label><label>ค่าขนส่ง / เดินทาง<input id=\"transportFlat\" type=\"number\"></label><label>ค่าดำเนินการ<input id=\"adminFlat\" type=\"number\"></label><label>Margin (%)<input id=\"marginPercent\" type=\"number\"></label><label>VAT (%)<input id=\"vatPercent\" type=\"number\"></label></div>\n    <div class=\"actions\"><button class=\"btn primary\" type=\"submit\">บันทึกราคา</button></div></form></section>")}
</main>`;

/* ---------- นำทาง ---------- */
function showPage(id) {
  if (['equipment','appliances','pricing'].includes(id)) {
    showPage('settings'); settings?.tab(id === 'pricing' ? 'pricing' : 'equipment');
    $(id).scrollIntoView({behavior:'smooth'}); return;
  }
  document.querySelectorAll('.nav button,.page').forEach(x => x.classList.remove('active'));
  document.querySelector(`.nav button[data-page="${id}"]`)?.classList.add('active'); $(id).classList.add('active'); scrollTo(0, 0);
}
document.querySelectorAll('.nav button').forEach(b => b.onclick = () => showPage(b.dataset.page));
document.querySelectorAll('[data-go]').forEach(b => b.onclick = () => showPage(b.dataset.go));

/* ---------- โหลดข้อมูล ---------- */
const demoEquipment = () => [
  { id: 'p1', category: 'panel', brand: 'Demo Solar', model: '580W Mono', panel_wp: 580, cost: 2500, sell_price: 3200, active: state.editEq?state.equipment.find(x=>x.id===state.editEq)?.active!==false:true, is_default: true },
  { id: 'i1', category: 'inverter', brand: 'Demo Inverter', model: '6K On Grid', power_kw: 6, phase: '1PH', cost: 22000, sell_price: 28000, active: true, system_type: 'On-Grid' },
  { id: 'i2', category: 'inverter', brand: 'Demo Inverter', model: '10K Hybrid', power_kw: 10, phase: '1PH', cost: 35000, sell_price: 45000, active: true, system_type: 'Hybrid' },
  { id: 'b1', category: 'battery', brand: 'Demo Battery', model: '10kWh LFP', capacity_kwh: 10, cost: 65000, sell_price: 82000, active: true, system_type: 'Hybrid' },
  { id: 'b2', category: 'battery', brand: 'Demo Battery', model: '15kWh LFP', capacity_kwh: 15, cost: 82000, sell_price: 99000, active: true, system_type: 'Hybrid' }];
async function loadEquipment() {
  if (!supabase) state.equipment = demoEquipment();
  else { const { data, error } = await supabase.from('equipment').select('*').order('category').order('brand'); demoMode = !!error; state.equipment = error ? demoEquipment() : (data || []); dataStatus('equipment', error); }
  renderEquipment(); settings?.rights(); lastSys = null; calc();
}
async function loadAssessments() {
  if (supabase) { const { data, error } = await supabase.from('assessments').select('*').order('created_at', { ascending: false }); state.assessments = error ? [] : (data || []); dataStatus('assessments', error); }
  renderHistory(); settings?.rights();
}
async function loadPricing() {
  if (supabase) { const { data, error } = await supabase.from('pricing_settings').select('*').limit(1).maybeSingle(); state.pricing = normalizePricing(error ? DEFAULT_PRICING : (data || DEFAULT_PRICING)); dataStatus('pricing_settings', error); }
  else state.pricing = { ...DEFAULT_PRICING };
  const p = state.pricing; [['laborPerKwp', 'labor_per_kwp'], ['structurePerKwp', 'structure_per_kwp'], ['wiringPerKwp', 'wiring_per_kwp'], ['transportFlat', 'transport_flat'], ['adminFlat', 'admin_flat'], ['marginPercent', 'margin_percent'], ['vatPercent', 'vat_percent']].forEach(([i, k]) => $(i).value = p[k]);
  calc();
}
async function loadAppliances() {
  state.apNote = '';
  if (!supabase) {
    state.appliances = [];
    state.apNote = 'ยังไม่ได้เชื่อมต่อ Supabase กรุณาตรวจสอบ config.js';
    renderAppliances();
    calc();
    return;
  }
  const { data, error } = await supabase
    .from('backup_appliances')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });
  dataStatus('backup_appliances', error);
  if (error) {
    console.error('โหลด backup_appliances ไม่สำเร็จ', error);
    state.appliances = [];
    state.apNote = 'โหลดข้อมูลโหลดสำรองไม่สำเร็จ กรุณารัน schema.sql ใน Supabase และตรวจสิทธิ์ RLS';
  } else {
    state.appliances = data || [];
  }
  renderAppliances(); settings?.rights();
  calc();
}

/* ---------- ตัวเลือกอุปกรณ์ ---------- */
let lastSys = null;
function fillSelects() {
  const sys = radio('systemType');
  for (const c of ['panel','inverter','battery']) {
    const el = $('sel_' + c), keep = el.value;
    const list = state.equipment.filter(x => x.category === c && x.active !== false && !equipmentIssue(x) && (c === 'panel' || !x.system_type || x.system_type === sys) && (c !== 'inverter' || x.phase === $('supplyPhase').value));
    el.innerHTML = '<option value="">อัตโนมัติ</option>' + list.map(x => `<option value="${x.id}">${esc(x.brand)} ${esc(x.model)} · ${spec(x)} · ${money(x.sell_price)}</option>`).join('');
    el.value = list.some(x => x.id === keep) ? keep : '';
  }
}

/* ---------- คำนวณและแสดงผล ---------- */


const siteCostFields=[['labor','ค่าแรง'],['structure','โครงสร้างและราง'],['wiring','สายไฟและอุปกรณ์'],['transport','ขนส่งและเดินทาง'],['admin','ดำเนินการ'],['extra','งานเพิ่มเติม']];
const sitePanel=document.createElement('section');sitePanel.className='panel site-cost-panel';
sitePanel.innerHTML='<h3>ค่าใช้จ่ายเฉพาะโครงการปัจจุบัน</h3><p class="hint">ปรับเฉพาะงานที่กำลังประเมิน ไม่เปลี่ยนราคามาตรฐานบริษัท • ค่าต่อหน่วยเป็นก่อน Margin และ VAT • บันทึกไปกับผลประเมิน เมื่อเปิดเว็บใหม่ใช้ราคามาตรฐาน</p><div class="grid2"><label>สถานะราคา<select id="siteSurvey"><option value="preliminary">ประมาณการก่อนสำรวจ</option><option value="surveyed">ปรับตามหน้างานแล้ว</option></select></label><label>ประเภทหลังคา / ความยาก<input id="siteRoof" placeholder="ระบุจากหน้างาน ไม่เพิ่มราคาทับซ้อนอัตโนมัติ"></label></div>'+siteCostFields.map(([key,label])=>'<fieldset><legend>'+label+'</legend><div class="grid2"><label>วิธีคิด<select id="site_'+key+'_mode"><option value="standard">ราคามาตรฐานบริษัท</option><option value="per_kwp">บาทต่อ kWp</option><option value="fixed">ยอดรวมรายการนี้</option><option value="quantity">ราคาต่อหน่วย × จำนวน/ระยะ</option></select></label><label>ราคา / อัตรา (บาท)<input id="site_'+key+'_rate" type="number" min="0" step="any" disabled></label><label>จำนวน / ระยะ<input id="site_'+key+'_quantity" type="number" min="0" step="any" disabled></label><label>หน่วย / เหตุผล<input id="site_'+key+'_note" placeholder="เช่น เมตร กิโลเมตร วัน หรือรายการงาน"></label></div></fieldset>').join('')+'<label>หมายเหตุการสำรวจ<textarea id="siteCostNote" placeholder="ขอบเขตงานและที่มาของราคาประเมิน"></textarea></label><p id="siteCostMessage" role="status"></p>';
document.querySelector('[data-settings-panel=pricing]').append(sitePanel);
function projectPricing(){
 const siteCosts={},errors=[];
 for(const [key,label] of siteCostFields){const mode=$('site_'+key+'_mode').value;const rate=$('site_'+key+'_rate').value,quantity=$('site_'+key+'_quantity').value;
  $('site_'+key+'_rate').disabled=mode==='standard';$('site_'+key+'_quantity').disabled=mode!=='quantity';
  if(mode!=='standard'&&(rate===''||!Number.isFinite(Number(rate))||Number(rate)<0))errors.push(label+': กรอกราคาตั้งแต่ศูนย์ขึ้นไป');
  if(mode==='quantity'&&(quantity===''||!Number.isFinite(Number(quantity))||Number(quantity)<0))errors.push(label+': กรอกจำนวนหรือระยะตั้งแต่ศูนย์ขึ้นไป');
  siteCosts[key]={mode,rate:Number(rate),quantity:Number(quantity),note:$('site_'+key+'_note').value};
 }
 const result={...state.pricing,siteCosts,siteSurvey:$('siteSurvey').value,siteRoof:$('siteRoof').value,siteNote:$('siteCostNote').value};
 $('siteCostMessage').textContent=errors.length?errors.join(' • '):'ใช้ราคานี้คำนวณเงินลงทุน ขนาดระบบตามงบ และคืนทุนของโครงการปัจจุบัน';
 return {pricing:result,errors};
}
sitePanel.addEventListener('input',()=>calc());sitePanel.addEventListener('change',()=>calc());

function reviewInputs(r=null) {
 const issues=[...projectPricing().errors];
 for(const [id,label] of [['monthlyBill','ค่าไฟ'],['monthlyKwh','หน่วยไฟ'],['budgetAmount','งบประมาณ'],['backupHours','ชั่วโมงสำรอง'],['daytimePercent','สัดส่วนใช้กลางวัน']]){
  const v=$(id).value;if(v!==''&&(!Number.isFinite(Number(v))||Number(v)<0))issues.push(label+' ต้องเป็นตัวเลขตั้งแต่ศูนย์ขึ้นไป');
 }
 if(num('daytimePercent')>100)issues.push('สัดส่วนใช้กลางวันต้องไม่เกิน 100%');
 if(radio('calcMode')==='budget'&&!(num('budgetAmount')>0))issues.push('กรอกงบประมาณมากกว่าศูนย์');
 const hasUsage=num('monthlyKwh')>0||num('monthlyBill')>0;
 const rows=[
 ['ระดับผลประเมิน',r?.financialReady?'ประมาณการเบื้องต้นจากสัดส่วนช่วงเวลาและแบบจำลองวันตัวอย่าง ไม่ใช่โหลดหรือแดดที่วัดจริง':'กรอกค่าไฟหรือหน่วยไฟก่อนประเมินเงินประหยัด'],
  ['การใช้ไฟ',num('monthlyKwh')>0?'หน่วยไฟที่กรอก: ใช้เป็นข้อมูลจากบิล (ยังไม่ได้ตรวจเอกสาร)':num('monthlyBill')>0?'ยอดบิลที่กรอก: หน่วยไฟเป็นค่าประมาณย้อนจากอัตราที่ตั้งไว้':'ยังไม่มีค่าไฟหรือหน่วยไฟ: ดูชุดอุปกรณ์ได้ แต่ยังออกผลประเมินการเงินไม่ได้'],
  ['ช่วงเวลาใช้ไฟ',$('daytimePercent').value===''?'ใช้สัดส่วนกลางวัน/กลางคืนตามสมมติฐานของระบบ':'ใช้สัดส่วนที่กรอก: ยังไม่ได้ยืนยันจากข้อมูลมิเตอร์รายช่วงเวลา'],
  ['กำลังและผลผลิต','กำลังติดตั้งคำนวณจาก Wp × จำนวนแผง; '+'ผลผลิตใช้ค่าประมาณจากหลังบ้าน '+DEFAULTS.yieldPerKwpMonth+' kWh/kWp/เดือน ไม่ใช่ค่ามาตรฐานรับรองทุกพื้นที่'],
  ['อัตราค่าไฟ',($('billingMode').value==='auto'?'ระบบเลือกประเภทอัตราเบื้องต้นตามลักษณะอาคาร ต้องเทียบประเภทในบิลจริง':'ใช้อัตราที่ผู้ดูแลเลือก')+(r?' • วิธีคำนวณ: '+r.billingMode:'')],
  ['ข้อมูลอุปกรณ์',demoMode?'อุปกรณ์ตัวอย่าง: ห้ามใช้เป็นใบเสนอราคาจริง':'ข้อมูลจากรายการอุปกรณ์ที่ตั้งไว้ ควรตรวจสเปกและราคาก่อนเสนอราคา'],
  ['ความคุ้มค่า','เงินประหยัดและคืนทุนเป็นประมาณการตามการใช้ไฟ ผลผลิต ราคาติดตั้ง และค่าใช้จ่ายที่ตั้งไว้']
 ];
 const ft=state.tariffReference;
 rows.push(['ราคาหน้างาน',$('siteSurvey').value==='surveyed'?'ปรับตามหน้างานแล้ว: '+($('siteRoof').value||'ไม่ระบุประเภทหลังคา'):'ประมาณการก่อนสำรวจ: ต้องตรวจขอบเขตงานและราคาจริง']);
 rows.push(['ค่า Ft',ft?'อ้างอิง PEA • '+ft.from+' ถึง '+ft.to+' • ตรวจสอบ '+(ft.checkedAt||ft.checked||'ไม่ระบุวันที่'):'ไม่มีอัตราที่ใช้ได้: ใช้การประเมินอย่างง่าย แทนการจำลองบิลทางการ']);
 return {ready:hasUsage&&!issues.length&&!!r?.financialReady,issues,rows,reviewedAt:new Date().toISOString(),billingMonth:$('billingMonth').value,tariffReference:ft||null,baseReference:OFFICIAL_RESIDENTIAL};
}
function canIssueAssessment(){calc();if(!state.last?.dataReview?.ready){notify('กรอกค่าไฟหรือหน่วยไฟ และตรวจค่าที่กรอกให้ถูกต้องก่อนบันทึกหรือพิมพ์');return false;}return true;}


function syncDaytimeControl(){
 const measured=false,manual=$('daytimeMode').value==='manual'&&!measured;
 const defaults=PERIOD_DEFAULTS[radio('usagePeriod')]??90;
 let value=manual?Number($('daytimeSlider').value):defaults;
 
 $('daytimePercent').value=manual?String(value):'';
 $('daytimeSlider').value=String(value);$('daytimeSlider').disabled=!manual;$('daytimeMode').disabled=measured;
 $('daytimeReadout').textContent='กลางวัน '+value.toFixed(Number.isInteger(value)?0:1)+'%';
 $('daytimeNightReadout').textContent=' • กลางคืน '+(100-value).toFixed(Number.isInteger(value)?0:1)+'%';
 $('daytimeModeNote').textContent=measured?'ใช้สัดส่วนจากไฟล์โหลดรายชั่วโมงที่นำเข้า แทนตัวเลือกประมาณการ':manual?'ปรับเอง: สัดส่วนที่ระบุเป็นข้อมูลพฤติกรรม ยังไม่ใช่ข้อมูลมิเตอร์รายชั่วโมง':'อัตโนมัติตามตัวเลือก: เป็นค่าตั้งต้นจากระบบ ยังไม่ใช่ข้อมูลมิเตอร์';
}

function calc() {
  syncDaytimeControl();
  const preflight=reviewInputs();
  const sys = radio('systemType'), mode = radio('calcMode');
  $('budgetRow').hidden = mode !== 'budget'; $('backupStep').hidden = sys !== 'Hybrid'; $('row_battery').hidden = sys !== 'Hybrid';
  const selectKey = sys + ':' + $('supplyPhase').value;
  if (selectKey !== lastSys) { lastSys = selectKey; fillSelects(); }
  const rawBackup = sys === 'Hybrid' ? backupFromAppliances(state.apQty, num('backupHours'), state.appliances.filter(a => a.active !== false).map(toCalcAppliance)) : { continuousKw: 0, surgeKw: 0, usableKwh: 0, batteryKwh: 0, items: [] };
  const selectedBilling=$('billingMode').value;
  let effectiveBilling=selectedBilling==='auto'?(buildingTariff()==='residential'?'pea112':'estimate'):selectedBilling;
  if(effectiveBilling.startsWith('pea')&&!state.tariffReference)effectiveBilling='estimate';
  const service=$('serviceCharge').value===''?(effectiveBilling==='pea111'?8.19:24.62):num('serviceCharge');
  const usage = { siteName:$('siteName').value, tariffReviewRequired:!!state.tariffFeed?.base.reviewRequired, billingMonth:$('billingMonth').value, serviceCharge:service, billingMode:effectiveBilling, ft:state.tariffReference?.value??'', billVat:7, monthlyKwh: $('monthlyKwh').value, monthlyBill: $('monthlyBill').value, tariffType: buildingTariff(), daytimePercent: $('daytimePercent').value, period: radio('usagePeriod'), phase: $('supplyPhase').value };
  const plan = usagePlan(usage, sys, rawBackup);
  const backup = plan.backup;
  $('periodAssumption').textContent = 'เว้นว่างใช้ % กลางวันตามการตั้งค่า: กลางวัน ' + PERIOD_DEFAULTS.day + '% / กลางคืน ' + PERIOD_DEFAULTS.night + '% / ทั้งคู่ ' + PERIOD_DEFAULTS.both + '% ปรับตามการใช้จริงได้';
  $('daytimePercent').placeholder = 'อัตโนมัติ ' + plan.defaultDayPercent + '%';
  $('planNote').textContent = 'กลางวัน ' + plan.dayPercent + '% • กลางคืน ' + (100-plan.dayPercent) + '% • ใช้กลางคืนประมาณ ' + plan.nightDaily.toFixed(1) + ' kWh/วัน • แบตเป้าหมาย ' + backup.batteryKwh.toFixed(1) + ' kWh (' + (plan.backup.source === 'backup-loads' ? 'จากอุปกรณ์และชั่วโมงสำรองที่กรอก' : 'อัตโนมัติจากการใช้ไฟกลางคืน') + ')';
  $('bkCont').textContent = backup.continuousKw ? backup.continuousKw.toFixed(2) + ' kW' : '—';
  $('bkSurge').textContent = backup.surgeKw ? backup.surgeKw.toFixed(2) + ' kW' : '—';
  $('bkBat').textContent = rawBackup.batteryKwh ? rawBackup.batteryKwh.toFixed(1) + ' kWh' : '—';

  const sel = { panelId: $('sel_panel').value, panelQty: num('qty_panel'), invId: $('sel_inverter').value, invQty: num('qty_inverter'), batId: $('sel_battery').value, batQty: num('qty_battery') };
  const designInput={ mode, systemType: sys, items: state.equipment, pricing: projectPricing().pricing, backup:rawBackup, sel, budget: num('budgetAmount'), usage };
  const r = preflight.issues.length?{error:preflight.issues.join(" • ")}:designSystem(designInput);
  if (r.error) { state.last = null; document.querySelectorAll('.dashboard-detail').forEach(b=>b.disabled=true);if($('dashboardDialog').open)$('dashboardDialog').close(); $('resultBody').hidden = true; $('resultEmpty').hidden = false; $('resultEmpty').textContent = r.error; $('usageNote').textContent = ''; return; }
  $('resultBody').hidden = false; $('resultEmpty').hidden = true;
  state.last = { ...r, systemType: sys, calcMode: mode, backup, pricingSnapshot:structuredClone(designInput.pricing), comparison:compareDesigns(designInput,r) };
  render(r, sys);
  state.last.dataReview=reviewInputs(r);
}
function render(r, sys) {
  const a = r.auto, nm = x => x ? `${x.brand} ${x.model}` : 'ไม่พบรุ่น';
  $('sel_panel').options[0].textContent = `อัตโนมัติ (${nm(a.panel)})`; $('sel_inverter').options[0].textContent = `อัตโนมัติ (${nm(a.inverter)})`; if (sys === 'Hybrid') $('sel_battery').options[0].textContent = a.battery ? `อัตโนมัติ (${nm(a.battery)})` : 'อัตโนมัติ';
  $('qty_panel').placeholder = `อัตโนมัติ ${a.panelQty || ''}`; $('qty_inverter').placeholder = `อัตโนมัติ ${a.invQty}`; $('qty_battery').placeholder = `อัตโนมัติ ${a.batQty || ''}`;
  $('usageNote').textContent = r.usageSource === 'actual' ? 'ใช้หน่วยไฟจริงจากบิล' : r.usageSource.startsWith('estimated') ? `ประมาณหน่วยไฟจากค่าไฟ${r.usageSource==='estimated-from-tariff'?'ด้วยโครงสร้างอัตราที่ตั้งหลังบ้าน':''} ≈ ${r.monthlyKwh.toFixed(0)} kWh/เดือน` : 'ยังไม่มีหน่วยไฟ จึงยังประเมินเงินประหยัดไม่ได้';
  const pay = r.eco.payback != null ? `${r.eco.payback} ปี` : 'ยังไม่คุ้มทุนใน 25 ปี', p = r.price;
  $('rTotal').textContent = money(p.total);
  const phase = r.phase === '3PH' ? '3 เฟส' : '1 เฟส';
  const batKwh = r.battery ? (r.batQty * Number(r.battery.capacity_kwh || 0)) : 0;
  const bill = r.billBefore?.total ?? num('monthlyBill');
  const remain = r.remainingBill;
  const savingPct = bill > 0 ? Math.min(100, (r.saveMonth / bill) * 100) : 0;
  $('rSystem').textContent = `${sys} · ${r.kwp.toFixed(2)} kWp${r.battery ? ` · แบตเตอรี่ ${batKwh.toFixed(1)} kWh` : ''}`;
  $('overviewCustomer').textContent = $('customerName').value ? `— ${$('customerName').value}` : '';
  $('ovSystem').innerHTML = `${r.kwp.toFixed(2)} kWp<br>${phase}`;
  $('ovSystem').closest('button').title=r.panelQty+' แผง × '+r.panel.panel_wp+' Wp • พื้นที่หลังคาประเมิน '+r.roof.roofArea.toFixed(1)+' ตร.ม. รวมเผื่อจัดวาง';
  $('ovBattery').textContent = sys === 'Hybrid' ? r.backup.batteryKwh.toFixed(1)+' kWh' : 'ไม่ใช้';
  $('ovBatteryLabel').textContent='ความจุแบตเตอรี่ที่แนะนำ';
  $('ovGeneration').textContent = `${Math.round(r.genYear).toLocaleString('th-TH')} kWh`;
  $('ovSavingPct').textContent = bill > 0 ? `~${savingPct.toFixed(0)}%` : '—';
  $('rPay').textContent = pay;
  const accumulated = r.cashflowRows.at(-1).accumulated;
  $('finInvestment').textContent = money(p.total);
  $('finAccumulated').textContent = money(accumulated);
  $('rProfit').textContent = money(r.eco.profit25);
  $('rProfit').closest('.finance-card').classList.toggle('negative-return',r.eco.profit25<0);
  $('finNarrative').textContent = r.eco.payback != null
    ? 'ลงทุน ' + money(p.total) + ' → คาดว่าคุ้มทุนใน ' + pay + ' → เมื่อครบ 25 ปี ประหยัดสะสม ' + money(accumulated) + ' หักเงินลงทุนแล้วเหลือ ' + money(r.eco.profit25)
    : 'ลงทุน ' + money(p.total) + ' → เงินประหยัดสะสมยังไม่ถึงเงินลงทุนภายใน 25 ปี → ผลตอบแทนหลังหักเงินลงทุน ' + money(r.eco.profit25);
  $('svBill').textContent = bill > 0 ? money(bill) : '—';
  $('svMonth').textContent = money(r.saveMonth);
  $('svYear').textContent = money(r.saveYear);
  $('svRemain').textContent = bill > 0 ? money(remain) : '—';
  renderBillAndComparison(r);
  const eq = (k, x, q, tot) => x ? `<tr><td>${catalog?.photo(x)||''}${CAT[k]}: ${esc(x.brand)} ${esc(x.model)} <span class="tag ${r.manual[k] ? 'on' : ''}">${r.manual[k] ? 'เลือกเอง' : 'อัตโนมัติ'}</span><small>${spec(x)} · ${money(x.sell_price)} / ${UNIT[k]}</small></td><td class="r">${q} ${UNIT[k]}</td><td class="r">${money(tot)}</td></tr>` : '';
  const row = (l, t, cls = '') => `<tr class="${cls}"><td>${l}</td><td></td><td class="r">${money(t)}</td></tr>`;
  $('rCost').innerHTML = eq('panel', r.panel, r.panelQty, p.panelTotal) + eq('inverter', r.inverter, r.invQty, p.inverterTotal) + eq('battery', r.battery, r.batQty, p.batteryTotal)
    + row('รวมค่าอุปกรณ์', p.equipment, 'sub') + row('ค่าแรงติดตั้ง', p.labor) + row('โครงสร้างและราง', p.structure) + row('สายไฟและอุปกรณ์ประกอบ', p.wiring) + row('ค่าขนส่ง', p.transport) + row('ค่าดำเนินการ', p.admin)
    + row('งานประกอบเฉพาะ '+sys+' (แยกจากอุปกรณ์)',p.systemBalance) + row('งานเพิ่มเติม', p.extra||0) + row('Margin', p.margin) + row('VAT', p.vat) + row('รวมทั้งสิ้น', p.total, 'total');
  const baseBeforeMargin=p.total-p.vat-p.margin;const factor=baseBeforeMargin>0?1+p.margin/baseBeforeMargin:1;
  const qr=(label,value,qty='',cls='')=>'<tr class="'+cls+'"><td>'+label+'</td><td class="r">'+qty+'</td><td class="r">'+money(value)+'</td></tr>';
  const qe=(label,item,qty,total)=>item?qr((catalog?.photo(item)||'')+esc(label+': '+item.brand+' '+item.model)+'<small>'+money(qty?total*factor/qty:0)+' / '+esc(item.unit||UNIT[item.category])+'</small>',total*factor,qty+' '+esc(item.unit||UNIT[item.category])):'';
  $('quoteCost').innerHTML=qe('แผงโซลาร์',r.panel,r.panelQty,p.panelTotal)+qe('อินเวอร์เตอร์',r.inverter,r.invQty,p.inverterTotal)+qe('แบตเตอรี่',r.battery,r.batQty,p.batteryTotal)+qr('ค่าแรงติดตั้ง',p.labor*factor)+qr('โครงสร้างและราง',p.structure*factor)+qr('สายไฟและอุปกรณ์ประกอบ',p.wiring*factor)+qr('ค่าขนส่ง',p.transport*factor)+qr('ค่าดำเนินการ',p.admin*factor)+qr('งานประกอบระบบ',p.systemBalance*factor)+qr('งานเพิ่มเติม',p.extra*factor)+qr('รวมก่อน VAT',(p.total-p.vat),'','sub')+qr('VAT',p.vat)+qr('รวมทั้งสิ้น',p.total,'','total');
  const dl = rows => rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
  $('rGen').innerHTML = dl([['ผลิตต่อวัน', `${r.genDay.toFixed(1)} kWh`], ['ผลิตต่อเดือน', `${r.genMonth.toFixed(0)} kWh`], ['ผลิตต่อปี (ปีแรก)', `${r.genYear.toFixed(0)} kWh`], ['ใช้เองได้', `${(r.ratio * 100).toFixed(0)}% ของที่ผลิต`]]);
  $('rEco').innerHTML = dl([['ประหยัดปีแรก', money(r.saveYear)], ['ROI ก่อนค่าใช้จ่ายในอนาคต 25 ปี',r.eco.roi==null?'—':r.eco.roi.toFixed(1)+'%'],['IRR', r.eco.irr == null ? '—' : r.eco.irr.toFixed(1) + '%'], ['NPV 25 ปี', money(r.eco.npv)], ['ลด CO₂', 'ยังไม่ยืนยันตัวคูณการปล่อยที่ใช้กับโครงการ']]);
  renderBar(r.eco.points, r.eco.payback, p.total, r.cashflowRows);
  document.querySelectorAll('.dashboard-detail').forEach(b=>{b.disabled=false;if(!matchMedia('(prefers-reduced-motion: reduce)').matches){b.getAnimations().forEach(a=>a.cancel());b.animate([{opacity:.65,transform:'translateY(5px)'},{opacity:1,transform:'translateY(0)'}],{duration:550,easing:'ease-out'});}});
  applyFinancialEvidence(r);
  if($('dashboardDialog').open)openDashboardDetail($('dashboardDialog').dataset.detail,false);
}

function applyFinancialEvidence(r){
 if(r.financialReady)return;
 for(const id of ['ovSavingPct','rPay','finAccumulated','rProfit','svMonth','svYear','svRemain'])$(id).textContent='รอข้อมูล';
 $('finNarrative').textContent='กรอกค่าไฟหรือหน่วยไฟเพื่อเริ่มประเมินเบื้องต้น • ขนาดแผงข้างต้นเป็นเป้าพลังงานเบื้องต้น ไม่ใช่ขนาดที่ยืนยันว่าเหมาะที่สุด';
 $('chart').innerHTML='<p class="hint">กราฟจะแสดงเมื่อมีข้อมูลเพียงพอสำหรับประเมินการเงิน</p>';$('annualBody').innerHTML='';$('chartTooltip').hidden=true;
 $('rEco').textContent='ยังไม่มีผลการเงินและการลด CO₂ ที่ยืนยันฐานข้อมูลได้';
 
 $('systemComparison').querySelectorAll('tr').forEach(tr=>{[...tr.children].slice(2).forEach(td=>td.textContent='รอข้อมูล');});
 $('batteryComparison').textContent='ยังไม่แสดงความคุ้มค่า Hybrid: ต้องยืนยันข้อจำกัดกำลังชาร์จ/จ่ายและรูปแบบควบคุมก่อน';
 for(const id of ['ovSavingPct','rPay','finAccumulated','rProfit'])$(id).closest('button').disabled=true;
}

function renderBillAndComparison(r){
 const b=r.billBefore,a=r.billAfter;
 $("svBillLabel").textContent=b?"บิลจำลองก่อนติดตั้ง/เดือน":"ค่าไฟที่กรอก/เดือน";
 const comparison=state.last.comparison;
 $('systemComparison').innerHTML=comparison.rows.map(row=>row.error?'<tr><td>'+row.panelQty+' แผง</td><td colspan="4">'+esc(row.error)+'</td></tr>':'<tr'+(row.current?' class="first-break-even"':'')+'><td>'+row.panelQty+' / '+row.kwp.toFixed(2)+(row.current?' (ปัจจุบัน)':'')+'</td><td class="r">'+money(row.investment)+'</td><td class="r">'+money(row.saving)+'</td><td class="r">'+(row.payback==null?'—':row.payback+' ปี')+'</td><td class="r">'+money(row.npv)+'</td></tr>').join('');
 const battery=comparison.battery;
 $('batteryComparison').textContent=!battery?'On-Grid: ไม่มีแบตเตอรี่ หากต้องการสำรองไฟ ให้เลือก Hybrid และกำหนดโหลดสำรอง':battery.error||('เทียบ Hybrid ปัจจุบันกับ On-Grid จำนวนแผงเท่ากัน: ลงทุนส่วนเพิ่ม '+money(battery.extraInvestment)+' • ประหยัดเพิ่ม '+money(battery.extraSaving)+'/ปี • NPV ส่วนเพิ่ม '+money(battery.incrementalNpv)+' • '+(battery.simplePayback==null?'ไม่มีระยะคืนทุนส่วนเพิ่มที่คำนวณได้จากเงินประหยัดบวก':'คืนทุนส่วนเพิ่มอย่างง่าย '+battery.simplePayback.toFixed(1)+' ปี (ยังไม่รวมค่าเสื่อม/ค่าดูแล/เปลี่ยนในตัวเลขคืนทุนอย่างง่าย)')+' • ส่วนเพิ่มรวมความต่างอินเวอร์เตอร์และแบต ไม่ใช่ราคาแบตล้วน • ประโยชน์สำรองไฟยังไม่ได้ตีเป็นเงิน');
}
function openDashboardDetail(id,show=true){
 const r=state.last;if(!r)return;const name=x=>x?[x.brand,x.model].filter(Boolean).join(' '):'ไม่มี';
 const items={
 ovSystem:['ชุดอุปกรณ์','rCost',[['แผง',name(r.panel)],['จำนวนแผง',r.panelQty+' แผง'],['กำลังติดตั้ง',r.kwp.toFixed(2)+' kWp'],['พื้นที่หลังคาประเมิน',r.roof.roofArea.toFixed(1)+' ตร.ม.'],['อินเวอร์เตอร์',name(r.inverter)+' × '+r.invQty],['กำลัง AC',(Number(r.inverter?.power_kw)*r.invQty).toFixed(1)+' kW']]],
 ovBattery:['ความจุและชุดแบตเตอรี่','backupStep',[['ความจุที่แนะนำ',r.backup.batteryKwh.toFixed(1)+' kWh'],['ยี่ห้อ / รุ่น',name(r.battery)],['จำนวน',r.batQty+' ชุด'],['ความจุติดตั้งจริง',r.installedBatteryKwh.toFixed(1)+' kWh'],['วิธีเลือก',r.backup.source==='backup-loads'?'จากอุปกรณ์สำรองและเวลาที่กรอก':'ตามการใช้ไฟกลางคืน'],['กำลังโหลดสำรอง',r.backup.continuousKw.toFixed(2)+' kW'],['เวลาสำรอง',num('backupHours')+' ชั่วโมง']]],
 ovGeneration:['พลังงานที่ผลิตและใช้ได้','rGen',[['ผลิตปีแรก',r.genYear.toFixed(0)+' kWh'],['เฉลี่ยต่อเดือน',r.genMonth.toFixed(0)+' kWh'],['ใช้ตรงกลางวัน',r.directMonthly.toFixed(1)+' kWh/เดือน'],['ใช้ผ่านแบต',r.shiftedMonthly.toFixed(1)+' kWh/เดือน']]],
 ovSavingPct:['การลดค่าไฟโดยประมาณ','svMonth',[['หน่วยไฟเดิม',r.monthlyKwh.toFixed(1)+' kWh/เดือน'],['หน่วยที่ลดการซื้อ',(r.directMonthly+r.shiftedMonthly).toFixed(1)+' kWh/เดือน'],['ค่าไฟที่ลดได้',money(r.saveMonth)+'/เดือน'],['ค่าไฟคงเหลือ',money(r.remainingBill)+'/เดือน'],['อัตราที่ใช้',r.billingMode]]],
 finInvestment:['รายละเอียดเงินลงทุน','rCost',[['แผงโซลาร์',money(r.price.panelTotal)],['อินเวอร์เตอร์',money(r.price.inverterTotal)],['แบตเตอรี่',money(r.price.batteryTotal)],['ค่าแรง',money(r.price.labor)],['โครงสร้าง',money(r.price.structure)],['สายไฟ',money(r.price.wiring)],['ขนส่ง',money(r.price.transport)],['ดำเนินการ',money(r.price.admin)],['งานประกอบระบบ',money(r.price.systemBalance)],['งานเพิ่มเติม',money(r.price.extra)],['Margin (ภายใน)',money(r.price.margin)],['VAT',money(r.price.vat)],['รวมลงทุน',money(r.price.total)]]],
 rPay:['จุดคุ้มทุนโดยประมาณ','annualBody',[['คืนทุน',r.eco.payback==null?'ยังไม่คืนทุนใน 25 ปี':r.eco.payback+' ปี'],['เงินลงทุน',money(r.price.total)],['ประหยัดปีแรก',money(r.saveYear)],['ฐานผลตอบแทน','ก่อนค่าใช้จ่ายในอนาคต']]],
 finAccumulated:['เงินประหยัดสะสม 25 ปี','annualBody',[['สะสม',money(r.cashflowRows.at(-1).accumulated)],['ฐานผลตอบแทน','ก่อนค่าใช้จ่ายในอนาคต']]],
 rProfit:['ผลตอบแทนหลังหักเงินลงทุน','annualBody',[['เงินประหยัดสะสม',money(r.cashflowRows.at(-1).accumulated)],['เงินลงทุน',money(r.price.total)],['ผลตอบแทน',money(r.eco.profit25)],['ROI',r.eco.roi?.toFixed(1)+'%'],['IRR',r.eco.irr==null?'—':r.eco.irr.toFixed(1)+'%'],['ฐานผลตอบแทน','ก่อนค่าใช้จ่ายในอนาคต']]]};
 const entry=items[id];if(!entry)return;$('dashboardDetailTitle').textContent=entry[0];const dl=document.createElement('dl');dl.className='specs';for(const [label,value]of entry[2]){const row=document.createElement('div'),dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=value;row.append(dt,dd);dl.append(row);}$('dashboardDetailBody').replaceChildren(dl);$('dashboardDialog').dataset.detail=id;
 $('detailGo').onclick=()=>{$('dashboardDialog').close();$(entry[1])?.closest('section')?.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});};if(show&&!$('dashboardDialog').open)$('dashboardDialog').showModal();
}
document.querySelectorAll('.dashboard-detail').forEach(b=>b.onclick=()=>openDashboardDetail(b.dataset.detail));
$('closeDashboardDetail').onclick=()=>$('dashboardDialog').close();
$('dashboardDialog').addEventListener('click',e=>{if(e.target===$('dashboardDialog')){const b=e.target.getBoundingClientRect();if(e.clientX<b.left||e.clientX>b.right||e.clientY<b.top||e.clientY>b.bottom)e.target.close();}});
const shortMoney = v => { const a = Math.abs(v), s = v < 0 ? '-' : ''; return a >= 1e6 ? s + (a / 1e6).toFixed(1) + 'ล.' : a >= 1e3 ? s + Math.round(a / 1e3) + 'k' : s + Math.round(a); };
function renderBar(points, payback, investment, rows) {
  const W=720,H=360,p={t:60,r:18,b:42,l:62};
  const savings=rows.map(row=>({year:row.year,value:Math.max(0,row.accumulated)}));
  const maxY=Math.max(investment,...savings.map(x=>x.value),1)*1.07,cw=W-p.l-p.r,ch=H-p.t-p.b,step=cw/savings.length,bw=Math.max(6,step-4);
  const x=i=>p.l+i*step+2,y=v=>p.t+(maxY-v)/maxY*ch;
  const firstRecovered=rows.findIndex(row=>row.year>0&&row.cumulative>=0);
  const before=firstRecovered>0?rows[firstRecovered-1]:null,after=firstRecovered>0?rows[firstRecovered]:null;
  // Use interpolation of the actual cashflows so the marker lies on the investment crossing.
  const exactPayback=before&&after?before.year+(-before.cumulative)/(after.cumulative-before.cumulative):null;
  const crossingX=exactPayback==null?null:x(0)+bw/2+exactPayback*step;
  const labelX=crossingX==null?null:Math.max(p.l+88,Math.min(W-p.r-88,crossingX));
  const detail=row=>`ปี ${row.year}\nเงินลงทุนเริ่มต้น: ${money(investment)}\nประหยัดค่าไฟปีนี้: ${money(row.saving)}\nกระแสเงินสดสุทธิปีนี้: ${money(row.net)}\nประหยัดสะสม: ${money(row.accumulated)}\nผลตอบแทนหลังหักเงินลงทุน: ${money(row.cumulative)}`;
  $('chartTooltip').hidden=true;
  $('chart').innerHTML=`<div class="chart-legend finance-legend"><span><i class="legend-before"></i>ช่วงสะสมเพื่อคืนทุน</span><span><i class="legend-after"></i>หลังจุดคุ้มทุน</span><span><i class="legend-invest"></i>เงินลงทุนเริ่มต้น</span></div>
    <p class="chart-explanation">สีฟ้า = ช่วงสะสมเพื่อคืนทุน • สีเขียว = ช่วงผลตอบแทนหลังคุ้มทุน<br>เมื่อถึงเส้นสีทอง = ชดเชยเงินลงทุนเริ่มต้นครบ</p>
    <svg viewBox="0 0 ${W} ${H}" class="svg-chart" role="group" aria-label="เงินลงทุน ${esc(money(investment))} เทียบประหยัดสะสม ${payback==null?'ยังไม่คุ้มทุนใน 25 ปี':'คุ้มทุนประมาณ '+payback+' ปี'}">
    <title>เงินลงทุนและจุดคุ้มทุน</title>
    ${crossingX==null?'':`<rect x="${crossingX}" y="${p.t}" width="${W-p.r-crossingX}" height="${ch}" fill="#eaf6f1"/>`}
    ${Array.from({length:5},(_,i)=>maxY*i/4).map(v=>`<line x1="${p.l}" y1="${y(v)}" x2="${W-p.r}" y2="${y(v)}" stroke="#dce8e3"/><text x="${p.l-8}" y="${y(v)+4}" text-anchor="end" class="tick">${shortMoney(v)}</text>`).join('')}
    ${savings.map((pt,i)=>`<rect class="chart-bar" data-year="${i}" tabindex="0" role="img" aria-label="${esc(detail(rows[i]))}" x="${x(i)}" y="${y(pt.value)}" width="${bw}" height="${Math.max(2,y(0)-y(pt.value))}" rx="3" fill="${pt.value>=investment?'#0b7a5f':'#39aabf'}"><title>${esc(detail(rows[i]))}</title></rect>${i%5===0?`<text x="${x(i)+bw/2}" y="${H-17}" text-anchor="middle" class="tick">ปี ${pt.year}</text>`:''}`).join('')}
    <line class="investment-line" x1="${p.l}" y1="${y(investment)}" x2="${W-p.r}" y2="${y(investment)}" stroke="#b58219" stroke-width="2.5" stroke-dasharray="7 4"/>
    <text x="${W-p.r-5}" y="${Math.max(p.t+12,y(investment)-9)}" text-anchor="end" class="investment-label">เงินลงทุน ${money(investment)}</text>
    ${crossingX==null?`<text x="${p.l}" y="30" class="no-payback-label">ยังไม่ถึงจุดคุ้มทุนภายใน 25 ปี</text>`:`<line class="payback-marker" x1="${crossingX}" y1="40" x2="${crossingX}" y2="${H-p.b}" stroke="#0b6b57" stroke-width="2" stroke-dasharray="4 4"/><circle cx="${crossingX}" cy="${y(investment)}" r="6" fill="#d7a63e" stroke="#ffffff" stroke-width="2"/><rect x="${labelX-88}" y="8" width="176" height="30" rx="10" fill="#0b6b57"/><text x="${labelX}" y="28" text-anchor="middle" class="payback-label">จุดคุ้มทุน ≈ ${payback} ปี</text>`}
    </svg><p class="hint">ชี้เมาส์ แตะแท่งกราฟ หรือใช้ Tab เพื่อดูรายละเอียดแต่ละปี</p>`;
  $('annualBody').innerHTML=rows.map(row=>`<tr class="${row.year===firstRecovered?'first-break-even':row.year>0&&row.cumulative>=0?'break-even':''}"><td>${row.year===0?'0 (ลงทุน)':row.year}${row.year===firstRecovered?'<small class="payback-badge">ปีแรกที่สะสมเกินทุน</small>':''}</td><td class="r">${money(row.saving)}</td><td class="r">${money(row.accumulated)}</td><td class="r">${money(row.cumulative)}</td></tr>`).join('');
  const show=event=>{
    const bar=event.target.closest?.('[data-year]');if(!bar)return;
    const tooltip=$('chartTooltip'),row=rows[Number(bar.dataset.year)];
    tooltip.textContent=detail(row);tooltip.style.whiteSpace='pre-line';tooltip.hidden=false;
    const rect=bar.getBoundingClientRect(),left=event.clientX||rect.left,top=event.clientY||rect.top;
    tooltip.style.left=Math.max(8,Math.min(left+14,innerWidth-tooltip.offsetWidth-8))+'px';
    tooltip.style.top=Math.max(8,Math.min(top+14,innerHeight-tooltip.offsetHeight-8))+'px';
  };
  $('chart').onpointerover=show;$('chart').onpointermove=show;$('chart').onclick=show;
  $('chart').querySelectorAll('.chart-bar').forEach(bar=>{
    bar.addEventListener('focus',()=>show({target:bar}));
    bar.addEventListener('blur',()=>$('chartTooltip').hidden=true);
  });
  $('chart').onpointerleave=()=>$('chartTooltip').hidden=true;
  $('chart').onkeydown=event=>{if(event.key==='Escape')$('chartTooltip').hidden=true;};
}


/* ---------- โหลดสำรอง: รายการในหน้าประเมิน + หน้าจัดการ ---------- */
const apDesc = a => `${Number(a.power_w)} W${a.has_surge ? ` • Surge ×${Number(a.surge_factor)}` : ''}`;
function renderAppliances() {
  const visible = state.appliances.filter(a => a.active !== false).sort((a,b) => Number(a.sort_order||0)-Number(b.sort_order||0));
  $('applianceList').innerHTML = visible.length ? visible.map(a => `<label class="ap-row"><span><b>${esc(a.name)}</b><small>${apDesc(a)}</small></span><input class="ap-qty" data-ap="${a.id}" type="number" min="0" value="${state.apQty[a.id] || 0}" aria-label="จำนวน ${esc(a.name)}"></label>`).join('') : '<div class="empty">ยังไม่มีรายการที่เปิดใช้งาน เพิ่มหรือเปิดได้ที่เมนู “โหลดสำรอง”</div>';
  $('apNote').textContent = state.apNote; $('apNote').hidden = !state.apNote;
  $('applianceAdmin').innerHTML = state.appliances.length ? `<div class="list">${[...state.appliances].sort((a,b)=>Number(a.sort_order||0)-Number(b.sort_order||0)).map(a => `<div class="item ${a.active === false ? 'muted-item' : ''}"><div><b>${esc(a.name)}</b><span>${apDesc(a)} · ลำดับ ${Number(a.sort_order||0)} · ${a.active === false ? 'ปิดการแสดงผล' : 'เปิดใช้งาน'}</span></div><div class="item-actions"><button class="btn small" data-ap-toggle="${a.id}">${a.active === false ? 'เปิด' : 'ปิด'}</button><button class="btn small" data-ap-edit="${a.id}">แก้ไข</button><button class="btn danger small" data-ap-del="${a.id}">ลบ</button></div></div>`).join('')}</div>` : '<div class="empty">ยังไม่มีรายการ กรอกฟอร์มด้านซ้ายเพื่อเพิ่ม</div>';
}
$('applianceAdmin').onclick = async e => {
  const ed = e.target.dataset.apEdit, del = e.target.dataset.apDel, toggle = e.target.dataset.apToggle;
  if (ed) { const a = state.appliances.find(x => x.id === ed); state.editAp = ed; $('applianceFormTitle').textContent = 'แก้ไขเครื่องใช้ไฟฟ้า'; $('apName').value = a.name; $('apPower').value = a.power_w; $('apSurge').checked = !!a.has_surge; $('apFactor').value = a.surge_factor || 3; $('apSort').value = Number(a.sort_order || 0); $('apActive').checked = a.active !== false; $('apFactorRow').hidden = !a.has_surge; $('apName').focus(); }
  if (toggle) {
    if (!await settings.requireConnection()) return;
    const a = state.appliances.find(x => x.id === toggle); if (!a) return;
    const active = a.active === false;
    if (!supabase) return notify('ต้องเชื่อมต่อ Supabase ก่อน');
    const { error } = await supabase.from('backup_appliances').update({ active }).eq('id', toggle);
    if (error) return notify(error.message);
    await loadAppliances(); notify('เปลี่ยนสถานะแล้ว');
  }
  if (del && await askConfirm('ลบรายการนี้?')) {
    if (!await settings.requireConnection()) return;
    if (!supabase) return notify('ต้องเชื่อมต่อ Supabase ก่อน');
    const { error } = await supabase.from('backup_appliances').delete().eq('id', del);
    if (error) return notify(error.message);
    notify('ลบแล้ว');
    await loadAppliances();
    delete state.apQty[del]; renderAppliances(); calc();
  }
};
$('apSurge').onchange = () => $('apFactorRow').hidden = !$('apSurge').checked;
function resetAp() { state.editAp = null; $('applianceFormTitle').textContent = 'เพิ่มเครื่องใช้ไฟฟ้า'; $('applianceForm').reset(); $('apFactorRow').hidden = true; $('apActive').checked = true; $('apSort').value = 0; }
$('apCancelBtn').onclick = resetAp;
$('applianceForm').onsubmit = async e => {
  e.preventDefault(); if (!await settings.requireConnection()) return;
  const row = { name: $('apName').value.trim(), power_w: num('apPower'), has_surge: $('apSurge').checked, surge_factor: $('apSurge').checked ? Math.max(1, num('apFactor')) : 1, sort_order: Math.max(0, num('apSort')), active: $('apActive').checked };
  if (!supabase) return notify('ต้องเชื่อมต่อ Supabase ก่อน');
  const r = state.editAp
    ? await supabase.from('backup_appliances').update(row).eq('id', state.editAp)
    : await supabase.from('backup_appliances').insert(row);
  if (r.error) return notify(r.error.message);
  await loadAppliances();
  resetAp(); renderAppliances(); calc(); notify('บันทึกอุปกรณ์สำรองไฟแล้ว');
};

/* ---------- ฐานข้อมูลอุปกรณ์ ---------- */
function renderEquipment() {
  $('equipmentList').innerHTML = Object.keys(CAT).map(c => { const list = state.equipment.filter(x => x.category === c); return `<h3>${CAT[c]}</h3>` + (list.length ? `<div class="list">${list.map(x => `<div class="item"><div>${catalog?.photo(x)||''}<b>${esc(x.brand)} ${esc(x.model)}</b><span>${spec(x)} · ขาย ${money(x.sell_price)}${x.system_type ? ' · ' + x.system_type : ''}${x.phase ? ' · ' + x.phase : ''}${x.is_default ? ' · แผงเริ่มต้น' : ''}</span></div><div class="item-actions">${supabase ? `<button type="button" class="btn small" data-eq-toggle="${x.id}" aria-pressed="${x.active !== false}" aria-label="${x.active === false ? 'แสดง' : 'ไม่แสดง'} ${esc(x.brand)} ${esc(x.model)}">${x.active === false ? 'แสดง' : 'ไม่แสดง'}</button><button class="btn small" data-eq-edit="${x.id}">แก้ไข</button><button class="btn danger small" data-eq-del="${x.id}">ลบ</button>` : ''}</div></div>`).join('')}</div>` : '<div class="empty">ยังไม่มีรายการ</div>'); }).join('');
}
function eqToggle() { const c = $('eqCategory').value; document.querySelectorAll('#equipmentForm [class*="f-"]').forEach(el => el.hidden = !el.classList.contains('f-' + c)); }
$('eqCategory').onchange = () => {eqToggle();catalog?.fields();};
function resetEq() { state.editEq = null; $('equipmentFormTitle').textContent = 'เพิ่มอุปกรณ์'; $('equipmentForm').reset(); eqToggle();catalog?.fields();catalog?.resetPhoto(); }
$('eqCancelBtn').onclick = resetEq;
$('equipmentList').onclick = async e => {
  const ed = e.target.dataset.eqEdit, del = e.target.dataset.eqDel;
  const toggle=e.target.dataset.eqToggle;
  if(toggle){
    if(!await settings.requireConnection())return;
    const item=state.equipment.find(x=>x.id===toggle);if(!item)return;
    const button=e.target;button.disabled=true;
    try{
      const active=item.active===false;if(active){const issue=equipmentIssue({...item,active:true});if(issue)return notify(issue,'error');}const {error}=await supabase.from('equipment').update({active}).eq('id',toggle);
      if(error)throw error;
      await loadEquipment();notify(active?'แสดงอุปกรณ์นี้แล้ว':'ปิดการแสดงอุปกรณ์นี้แล้ว','success');
    }catch(error){notify('เปลี่ยนสถานะไม่สำเร็จ: '+error.message,'error');}
    finally{if(button.isConnected)button.disabled=false;settings.rights();}
    return;
  }
  if (ed) { const x = state.equipment.find(i => i.id === ed); state.editEq = ed; $('equipmentFormTitle').textContent = 'แก้ไขอุปกรณ์'; $('eqCategory').value = x.category; eqToggle(); $('eqBrand').value = x.brand; $('eqModel').value = x.model; $('eqPanelWp').value = x.panel_wp || ''; $('eqPowerKw').value = x.power_kw || ''; $('eqCapacityKwh').value = x.capacity_kwh || ''; $('eqSystemType').value = x.system_type || ''; $('eqPhase').value = x.phase || ''; $('eqCost').value = x.cost || 0; $('eqSellPrice').value = x.sell_price || 0; $('eqIsDefault').value = x.is_default ? 'true' : 'false';catalog?.fields(x);catalog?.resetPhoto(x); }
  if (del && await askConfirm('ลบอุปกรณ์นี้?')) { if (!await settings.requireConnection()) return; const { error } = await supabase.from('equipment').delete().eq('id', del); if (error) notify(error.message); else {loadEquipment();notify('ลบอุปกรณ์แล้ว');} }
};
$('equipmentForm').onsubmit = async e => {
  e.preventDefault(); if (!await settings.requireConnection()) return; if (!supabase) return notify('โหมดทดลองไม่สามารถบันทึกอุปกรณ์ได้ ต้องเชื่อม Supabase ก่อน');
  const button=e.submitter||e.target.querySelector("button[type=submit],button:not([type])");if(button.disabled)return;button.disabled=true;try{
  const c = $('eqCategory').value, n = id => $(id).value ? Number($(id).value) : null;
  const issue=equipmentIssue({category:c,model:$('eqModel').value,phase:$('eqPhase').value});if(issue)return notify(issue,'error');
  if(c==='battery'&&/SUN\s*2000/i.test($('eqModel').value))return notify('SUN2000 เป็นอินเวอร์เตอร์ Huawei ไม่ใช่แบตเตอรี่ ตรวจชื่อรุ่นและประเภทอุปกรณ์ก่อนบันทึก');
  const rated=c==='panel'?n('eqPanelWp'):c==='inverter'?n('eqPowerKw'):n('eqCapacityKwh');if(['panel','inverter','battery'].includes(c)&&!(rated>0))return notify('กรอกกำลังหรือความจุอุปกรณ์เป็นค่ามากกว่า 0 ตาม datasheet');
  const payload = { category: c, brand: $('eqBrand').value, model: $('eqModel').value, panel_wp: c === 'panel' ? n('eqPanelWp') : null, power_kw: c === 'inverter' ? n('eqPowerKw') : null, capacity_kwh: c === 'battery' ? n('eqCapacityKwh') : null, system_type: c === 'panel' ? null : ($('eqSystemType').value || null), phase: c === 'inverter' ? ($('eqPhase').value || null) : null, cost: Number($('eqCost').value || 0), sell_price: Number($('eqSellPrice').value || 0), active: state.editEq?state.equipment.find(x=>x.id===state.editEq)?.active!==false:true, is_default: c === 'panel' && $('eqIsDefault').value === 'true' };
  if(!Number.isFinite(payload.cost)||payload.cost<0||!Number.isFinite(payload.sell_price)||payload.sell_price<0)return notify('ต้นทุนและราคาขายต้องไม่ติดลบ','error');
  let uploaded=null;try{Object.assign(payload,await catalog.prepare());uploaded=payload.image_path;}catch(error){return notify(error.message,'error');}
  if (payload.is_default) await supabase.from('equipment').update({ is_default: false }).eq('category', 'panel');
  const res = state.editEq ? await supabase.from('equipment').update(payload).eq('id', state.editEq) : await supabase.from('equipment').insert(payload);
  if (res.error) {notify(res.error.message,'error');} else { resetEq(); await loadEquipment(); notify('บันทึกอุปกรณ์แล้ว'); }
  }catch(error){notify('บันทึกอุปกรณ์ไม่สำเร็จ: '+error.message,'error');}finally{button.disabled=false;settings.rights();}
};

/* ---------- ราคาติดตั้ง / ประวัติ / บันทึก ---------- */
$('pricingForm').onsubmit = async e => {
  e.preventDefault(); if (!await settings.requireConnection()) return;
  const payload = { id: 1, labor_per_kwp: num('laborPerKwp'), structure_per_kwp: num('structurePerKwp'), wiring_per_kwp: num('wiringPerKwp'), transport_flat: num('transportFlat'), admin_flat: num('adminFlat'), margin_percent: num('marginPercent'), vat_percent: num('vatPercent') };
  state.pricing = normalizePricing(payload);
  if (!supabase) { notify('ใช้ราคานี้ชั่วคราวในโหมดทดลอง'); return calc(); }
  const { error } = await supabase.from('pricing_settings').upsert(payload); if (error) notify(error.message); else { notify('บันทึกราคาแล้ว'); loadPricing(); }
};
function renderHistory() {
  const list = state.assessments, sum = k => list.reduce((s, a) => s + Number(a[k] || 0), 0);
  $('histStats').innerHTML = `<div><span>จำนวนการประเมิน</span><b>${list.length}</b></div><div><span>มูลค่าโครงการรวม</span><b>${money(sum('project_price'))}</b></div><div><span>ประหยัดต่อเดือนรวม</span><b>${money(sum('monthly_saving'))}</b></div>`;
  $('historyBody').innerHTML = list.length ? list.map(a => `<tr><td>${new Date(a.created_at).toLocaleDateString('th-TH')}</td><td>${esc(a.customer_name)}<small>${esc(a.site_name || '')}</small></td><td>${esc(a.system_type || '-')}</td><td class="r">${Number(a.recommended_kwp || 0).toFixed(2)}</td><td class="r">${money(a.project_price)}</td><td class="r">${a.payback_year ? a.payback_year + ' ปี' : '-'}</td><td class="r"><button class="btn danger small" data-del="${a.id}">ลบ</button></td></tr>`).join('') : '<tr><td colspan="7"><div class="empty">ยังไม่มีประวัติการประเมิน</div></td></tr>';
}
$('historyBody').onclick = async e => { const id = e.target.dataset.del; if (!id || !supabase || !await askConfirm('ลบรายการนี้?')) return; if (!await settings.requireConnection()) return; const { error } = await supabase.from('assessments').delete().eq('id', id); if (error) notify(error.message); else {loadAssessments();notify('ลบรายการแล้ว');} };
$('saveBtn').onclick = async () => {
  if(!canIssueAssessment())return;
  if (!await settings.requireConnection()) { showPage('settings'); return; }
  if (demoMode) return notify('กำลังใช้อุปกรณ์ตัวอย่าง ไม่สามารถบันทึกเป็นการประเมินจริงได้');
  const r = state.last; if (!r) return notify('ยังไม่มีผลประเมินให้บันทึก'); if (!supabase) return notify('โหมดทดลองไม่สามารถบันทึกได้ ต้องเชื่อม Supabase ก่อน');
  const line = (x, q) => x ? { id: x.id, name: `${x.brand} ${x.model}`, qty: q, image_path:x.image_path||null, unit:x.unit||UNIT[x.category], specs:x.specs||{}, unit_price: x.category==='battery'&&Number(x.sell_price)<=0?Number(x.capacity_kwh)*DEFAULTS.batteryPricePerKwh:Number(x.sell_price || 0) } : null;
  const payload = { customer_name: $('customerName').value || 'ไม่ระบุชื่อ', phone: $('phone').value, site_name: $('siteName').value, system_type: r.systemType, calc_mode: r.calcMode, monthly_kwh: r.monthlyKwh || 0, monthly_bill: num('monthlyBill'), daytime_percent: r.dayPercent, panel_wp: Number(r.panel.panel_wp || 0), recommended_kwp: r.kwp, panel_count: r.panelQty, inverter_kw: Number(r.inverter?.power_kw || 0) * r.invQty, battery_kwh: r.battery ? Number(r.battery.capacity_kwh || 0) * r.batQty : 0, project_price: r.price.total, monthly_saving: r.saveMonth, annual_saving: r.saveYear, saving_percent: num('monthlyBill') > 0 ? Math.min(100, r.saveMonth / num('monthlyBill') * 100) : 0, payback_year: r.eco.payback, final_profit: r.eco.profit25, selected_panel: `${r.panel.brand} ${r.panel.model}`, selected_inverter: r.inverter ? `${r.inverter.brand} ${r.inverter.model}` : null, selected_battery: r.battery ? `${r.battery.brand} ${r.battery.model}` : null, line_items: { settings_snapshot: settings.snapshot(), pricing_snapshot: r.pricingSnapshot, design_inputs: { data_review:r.dataReview, energy_basis:r.energyBasis, building: $('buildingType').value, phase: r.phase, usage_period: radio('usagePeriod'), daytime_percent: r.dayPercent, night_daily_kwh: r.nightDaily, battery_target_kwh: r.backup.batteryKwh, battery_sizing_source:r.backup.source, financial_model_version:15, financial_scope:'before_future_costs', roi:r.eco.roi, irr:r.eco.irr, annual_cashflows:r.cashflowRows, raw_saving:r.rawSaving, model_reserve:r.modelReserve, remaining_bill:r.remainingBill,  roof:r.roof, backup_required_kwh:r.backupRequiredKwh, billing_month:$('billingMonth').value, service_charge:r.billBefore?.service??num('serviceCharge'), tariff_reference:{base:r.billBefore?OFFICIAL_RESIDENTIAL:null,ft:state.tariffReference||null}, bill_before:r.billBefore, bill_after:r.billAfter, comparison:r.comparison, billing_mode:r.billingMode, tariff_configured_mode:$('billingMode').value, ft:state.tariffReference?.value??null, bill_vat:7 }, panel: line(r.panel, r.panelQty), inverter: line(r.inverter, r.invQty), battery: line(r.battery, r.batQty), backup: r.backup.items.map(i => ({ appliance_id: i.id, name: i.name, qty: i.qty, watt: i.powerW })) }, notes: $('notes').value };
  const { data: saved, error } = await supabase.from('assessments').insert(payload).select('id').single();
  if (error) return notify('บันทึกไม่สำเร็จ: ' + error.message);
  const eqRows = [r.panel && { assessment_id: saved.id, equipment_id: uuidOrNull(r.panel.id), category: 'panel', qty: r.panelQty, unit_price: Number(r.panel.sell_price || 0) }, r.inverter && { assessment_id: saved.id, equipment_id: uuidOrNull(r.inverter.id), category: 'inverter', qty: r.invQty, unit_price: Number(r.inverter.sell_price || 0) }, r.battery && { assessment_id: saved.id, equipment_id: uuidOrNull(r.battery.id), category: 'battery', qty: r.batQty, unit_price: Number(r.battery.sell_price || 0) }].filter(Boolean);
  if (eqRows.length) { const { error: eqErr } = await supabase.from('assessment_equipment').insert(eqRows); if (eqErr) console.warn('บันทึกรายการอุปกรณ์ย่อยไม่สำเร็จ', eqErr); }
  const backupRows = r.backup.items.map(i => ({ assessment_id: saved.id, appliance_id: uuidOrNull(i.id), appliance_name: i.name, qty: i.qty, power_w: i.powerW, startup_w: i.startW }));
  if (backupRows.length) { const { error: bkErr } = await supabase.from('assessment_backup_loads').insert(backupRows); if (bkErr) console.warn('บันทึก snapshot โหลดสำรองไม่สำเร็จ', bkErr); }
  notify('บันทึกการประเมินแล้ว'); loadAssessments();
};
$('printBtn').onclick = async () => {if(!canIssueAssessment())return;await Promise.race([Promise.allSettled([...document.querySelectorAll('img.equipment-photo')].map(x=>x.decode())),new Promise(r=>setTimeout(r,5000))]);print();};
$('refreshHistoryBtn').onclick = loadAssessments; $('refreshEquipmentBtn').onclick = loadEquipment; $('loadPricingBtn').onclick = loadPricing;

/* ---------- การตั้งค่าอัตโนมัติ / รีเซ็ตฟอร์ม ---------- */
function setEquipmentAuto() {
  ['panel','inverter','battery'].forEach(c => {
    const select = $('sel_' + c);
    const qty = $('qty_' + c);
    if (select) select.value = '';
    if (qty) qty.value = '';
  });
  calc();
}


$('autoEquipmentBtn').onclick = setEquipmentAuto;

/* ---------- เริ่มทำงาน ---------- */
$('buildingType').onchange = () => {
  $('supplyPhase').value = catalog?.location()?.phase || '1PH';
  lastSys = null; calc();
};
document.querySelectorAll('input[name="usagePeriod"]').forEach(input => input.onchange = () => {
  const system = radio('usagePeriod') === 'day' ? 'On-Grid' : 'Hybrid';
  document.querySelector('input[name="systemType"][value="' + system + '"]').checked = true;
  lastSys = null; calc();
});
// Technical tariff controls belong to the existing calculation settings category.
const basis=document.querySelector('.calculation-basis');
document.querySelector('[data-settings-panel=calculation]').append(basis);basis.open=true;
basis.querySelector('summary').textContent='อัตราค่าไฟ • ระบบเลือก Ft และ VAT อัตโนมัติ';
const help=document.createElement('p');help.className='hint';help.textContent='ลูกค้าไม่ต้องกรอก Ft หรืออัตราค่าไฟ: ระบบใช้ค่าที่ตั้งหน้านี้ โหมดอัตโนมัติใช้ PEA บ้าน 1.1.2 เป็นสมมติฐานตั้งต้น ต้องตรวจประเภทบิลก่อนเสนอราคาจริง สถานที่อื่นใช้ประมาณการ ไม่รองรับบิล TOU/demand และส่วนลดพิเศษ ค่าบริการบ้านตั้งต้น 24.62 บาทก่อน VAT อ้างอิงเอกสาร PEA พ.ค. 2566 ปรับได้ตามบิล';basis.prepend(help);
const saveTariff=document.createElement('button');saveTariff.type='button';saveTariff.className='btn primary';saveTariff.id='saveTariffSettings';saveTariff.textContent='บันทึกประเภทบิลและค่าบริการ';basis.append(saveTariff);
const tariffSaveMessage=document.createElement('p');tariffSaveMessage.id='tariffSaveMessage';tariffSaveMessage.setAttribute('role','status');basis.append(tariffSaveMessage);
const tariffFieldIds=['billingMode','serviceCharge'];
let lastAppliedTariff='';
function applySavedTariff(){
 const config=settings?.snapshot().calculation.tariffConfig;
 const key=JSON.stringify(config||{});if(key===lastAppliedTariff)return;lastAppliedTariff=key;
 if(config){for(const id of tariffFieldIds)if(config[id]!=null)$(id).value=config[id];state.tariffReference=null;}
 else{$('billingMode').value='auto';$('serviceCharge').value='';}
 useFtReference();
}
saveTariff.onclick=async()=>{
 try{const config=Object.fromEntries(tariffFieldIds.map(id=>[id,$(id).value]));
  await settings.saveTariffConfig(config);lastAppliedTariff=JSON.stringify(settings.snapshot().calculation.tariffConfig);tariffSaveMessage.textContent='บันทึกแล้ว ลูกค้าใช้ค่าระบบโดยไม่ต้องกรอกอัตราเอง';calc();
 }catch(error){tariffSaveMessage.textContent='บันทึกไม่ได้: '+error.message;}
};
basis.addEventListener('input',()=>{calc();});
basis.addEventListener('change',()=>{calc();});
$('billingMode').value='auto';
$('billingMonth').value=new Date().toLocaleDateString('en-CA',{year:'numeric',month:'2-digit',timeZone:'Asia/Bangkok'}).slice(0,7);
// Use an explicit ISO month, independent of the browser locale's date order.
{const parts=new Intl.DateTimeFormat('en',{year:'numeric',month:'2-digit',timeZone:'Asia/Bangkok'}).formatToParts(new Date());$('billingMonth').value=parts.find(x=>x.type==='year').value+'-'+parts.find(x=>x.type==='month').value;}
let tariffModule=null,tariffLoading=false;
const formatChecked=value=>new Intl.DateTimeFormat('th-TH',{dateStyle:'medium',timeStyle:'short'}).format(new Date(value));
function tariffReference(month){
 if(state.tariffFeed&&tariffModule)return tariffModule.selectFt(state.tariffFeed,month);
 const fallback=officialFtForMonth(month);return fallback?{...fallback,checkedAt:fallback.checked+'T00:00:00+07:00',sourceUrl:fallback.url,stale:true,feedDegraded:true,baseReviewRequired:false}:null;
}
function useFtReference(explicit=false){
 const ref=tariffReference($('billingMonth').value);
 if(!ref){if(explicit)$('ftSourceNote').textContent='ไม่มี Ft สำหรับรอบบิลนี้ ระบบจะใช้การประเมินอย่างง่ายแทน ไม่เดาค่า Ft';return;}
 if(ref.baseReviewRequired){$('ftSourceNote').textContent='ประกาศอัตราฐานเปลี่ยน ต้องตรวจสูตรก่อนใช้ PEA อัตโนมัติ';return;}
 if(!explicit&&(ref.stale||ref.feedDegraded))return;
 
 state.tariffReference=ref;
 $('ftSourceNote').textContent=(ref.stale||ref.feedDegraded?'ใช้ข้อมูลเดิม ต้องตรวจเทียบกับบิล: ':'ใช้ Ft จากข้อมูลอัปเดต: ')+ref.value+' บาท/หน่วย • '+ref.from+' ถึง '+ref.to+' • ตรวจ '+formatChecked(ref.checkedAt);
}
async function refreshTariffFeed(){
 if(tariffLoading)return;tariffLoading=true;$('refreshTariffFeed').disabled=true;
 try{
  tariffModule=tariffModule||await withTimeout(Promise.resolve(SolarTariffs),5000,'ตัวอ่านอัตราค่าไฟ');
  const feed=await tariffModule.loadTariffs();state.tariffFeed=feed;
  $('tariffReferenceNote').textContent=(feed.status==='ok'?'ข้อมูลตรวจจาก PEA':'ตรวจแหล่งทางการได้ไม่ครบ เก็บข้อมูลเดิม')+' • ตรวจแหล่งทางการครั้งล่าสุด '+formatChecked(feed.lastAttemptAt)+' • '+(feed.base.reviewRequired?'ประกาศอัตราฐานเปลี่ยน ต้องตรวจสูตรก่อนใช้':'ไม่พบการเปลี่ยนแปลงในประกาศอัตราฐานที่เฝ้าตรวจ')+' • เว็บอ่านไฟล์ที่ตัวตรวจตามเวลาจัดทำ ไม่ใช่ API คำนวณบิลของการไฟฟ้า';
  const reference=tariffReference($('billingMonth').value);
  if(state.tariffReference&&(!reference||reference.stale||reference.feedDegraded||reference.baseReviewRequired)){state.tariffReference=null;$('ftSourceNote').textContent='ข้อมูลอัตโนมัติยังยืนยันไม่ได้ เลือกตรวจแหล่งอ้างอิงหรือใช้ข้อมูลเดิมหลังตรวจรอบบิล';}
  if($('billingMode').value.startsWith('pea')||$('billingMode').value==='auto')useFtReference();
 }catch(error){$('tariffReferenceNote').textContent='ตรวจไฟล์อัปเดตไม่ได้: '+error.message+' • ยังมีข้อมูลอ้างอิงเดิม กดใช้หลังตรวจรอบบิลได้ • การเปิดเว็บไม่ต้องรอส่วนนี้';}
 finally{tariffLoading=false;$('refreshTariffFeed').disabled=false;calc();}
}
$('refreshTariffFeed').onclick=refreshTariffFeed;
$('applyOfficialFt').onclick=()=>{useFtReference(true);calc();};

$('billingMonth').addEventListener('input',()=>{if(state.tariffReference){state.tariffReference=null;}if($('billingMode').value.startsWith('pea')||$('billingMode').value==='auto')useFtReference();calc();});
$('billingMode').addEventListener('change',()=>{if($('billingMode').value.startsWith('pea')||$('billingMode').value==='auto')useFtReference();calc();});
setTimeout(()=>{void refreshTariffFeed();},0);
setInterval(()=>{if(!document.hidden)void refreshTariffFeed();},15*60*1000);
$('inputs').addEventListener('input', e => { if (e.target.dataset.ap) state.apQty[e.target.dataset.ap] = Number(e.target.value || 0); calc(); });
// Catalog and CSV are bundled in main.js.
 catalog=mountCatalog({getClient:()=>supabase,getSettings:()=>settings,state,DEFAULTS,CAT,UNIT,esc,notify,calc,renderEquipment});
 const spec=x=>coreSpec(x)+(catalog?.summary(x)||'');
 mountEquipmentCsv({getClient:()=>supabase,state,requireConnection:()=>settings.requireConnection(),reload:loadEquipment,notify,esc,equipmentIssue});
 eqToggle(); resetAp();
settings = mountSettings({getClient:()=>supabase,modules:{DEFAULTS,BILL_RATES,PERIOD_DEFAULTS},recalculate:()=>{catalog?.refreshLocations();lastSys=null;calc();},report:error=>window.solarBoot?.showError(error)});
// Render and bind the complete UI with existing demo defaults before any network work.
await Promise.all([loadEquipment(), loadAppliances(), loadAssessments(), loadPricing()]);
window.solarBoot?.ready();
// Give the browser a paint opportunity before starting optional remote dependencies.
setTimeout(() => { connectAndLoad().catch(error => {
  console.error('Startup failed', error);
  window.solarBoot?.showError(error);
}); }, 0);

async function connectAndLoad() {
  try {
    const { SUPABASE_URL, SUPABASE_KEY } = await withTimeout(import(localModule('./config.js')), 8000, 'config.js');
    if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error('ยังไม่ได้ตั้งค่า Supabase');
    const { createClient } = await withTimeout(import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm'), 8000, 'Supabase CDN');
    supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: {persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}, global: { fetch: boundedFetch } });
  } catch (error) {
    console.warn('เปิดโหมดจำกัด', error);
    setConnection('โหมดจำกัด • อุปกรณ์ตัวอย่าง ไม่ใช้เสนอราคาจริง • ไม่สามารถบันทึกได้ (' + error.message + ')');
    return;
  }
  setConnection('กำลังโหลดข้อมูล Supabase • ยังใช้อุปกรณ์ตัวอย่าง');
  const loaders = [loadEquipment, loadAppliances, loadAssessments, loadPricing, async () => {await settings.load();applySavedTariff();calc();}];
  const results = await Promise.allSettled(loaders.map(load => load()));
  results.forEach((result, i) => {
    if (result.status === 'rejected') {
      dataStatus(['equipment', 'backup_appliances', 'assessments', 'pricing_settings', 'settings'][i], result.reason);
      console.error('Data load failed', result.reason);
      window.solarBoot?.showError(result.reason);
    }
  });
}

const notificationObserver=new MutationObserver(changes=>{for(const id of new Set(changes.map(c=>c.target.nodeType===3?c.target.parentElement?.id:c.target.id))){if(!['companyMessage','calculationMessage','tariffSaveMessage'].includes(id))continue;const message=document.getElementById(id)?.textContent;if(message&&/บันทึกแล้ว|บันทึกไม่สำเร็จ|บันทึกไม่ได้|ผิดพลาด/.test(message))notify(message,/บันทึกแล้ว/.test(message)?'success':'error');}});for(const id of ['companyMessage','calculationMessage','tariffSaveMessage']){const el=document.getElementById(id);if(el)notificationObserver.observe(el,{childList:true,subtree:true,characterData:true});}

document.addEventListener('submit',event=>{if(['companyForm','calculationForm','equipmentForm','applianceForm','pricingForm'].includes(event.target.id))notify('กำลังดำเนินการ กรุณารอสักครู่','info');},true);
