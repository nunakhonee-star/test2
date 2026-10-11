
export const DEFAULT_PRICING = { labor_per_kwp:6000, structure_per_kwp:3500, wiring_per_kwp:1800, transport_flat:5000, admin_flat:3000, margin_percent:8, vat_percent:7 };
export const PERIOD_DEFAULTS = {day:90,night:10,both:50};
export const DEFAULTS = { batteryReplacementYear:0,batteryReplacementCost:0,inverterReplacementYear:0,inverterReplacementCost:0, yieldPerKwpMonth:125, batteryDod:0.90, batteryEff:0.95, batteryRoundTripEff:0.90, batteryReserve:1.10, tariffGrowth:0, degradation:0.005, discount:0.08, maintenance:0.005, co2KgPerKwh:0.5664, analysisYears:25 };
export const BILL_RATES = { residential:4.2, business:4.8, industrial:4.5 };

export function moneyN(v){ return Number(v||0); }
export function normalizePricing(p={}){ return { ...DEFAULT_PRICING, ...p }; }
export function estimateMonthlyKwh(monthlyKwh, monthlyBill, tariffType){ const k = moneyN(monthlyKwh); if(k>0) return { monthlyKwh:k, source:'actual' }; const b = moneyN(monthlyBill); const rate = BILL_RATES[tariffType] || BILL_RATES.residential; return { monthlyKwh: b>0? b/rate : 0, source: b>0?'estimated':'none' }; }
export function defaultPanel(items){ const valid=items.filter(x=>x.category==='panel' && x.active!==false && Number(x.panel_wp)>0); return valid.find(x=>x.is_default) || valid[0]; }
export function chooseClosest(items, field, target, category, systemType=''){ const list = items.filter(x=>x.category===category && x.active!==false && Number(x[field]||0)>0 && (!systemType || !x.system_type || x.system_type===systemType)); if(!list.length || !target) return null; if(category==='inverter')return [...list].filter(x=>Number(x[field])>=target).sort((a,b)=>Number(a[field])-Number(b[field]))[0] || [...list].sort((a,b)=>Number(b[field])-Number(a[field]))[0]; return [...list].sort((a,b)=>Math.abs(Number(a[field])-target)-Math.abs(Number(b[field])-target))[0]; }
export function toCalcAppliance(r){ const has=!!r.has_surge; return { id:r.id, name:r.name, powerW:Number(r.power_w||0), hasSurge:has, surge:has?Number(r.surge_factor||1):1 }; }
export function backupFromAppliances(qtys, hours, library=[]){ let contW=0, extraSurge=0, items=[]; for(const a of library){ const qty = Math.max(0, Math.floor(Number(qtys[a.id]||0))); if(!Number.isFinite(qty)||!qty||!Number.isFinite(a.powerW)||a.powerW<=0) continue; const runW = a.powerW*qty; const startW = a.hasSurge ? a.powerW*Math.max(1,Number(a.surge)||1)*qty : runW; contW += runW; if(a.hasSurge) extraSurge += Math.max(0, startW-runW); items.push({ ...a, qty, runW, startW }); } const continuousKw = contW/1000; const surgeKw = (contW+extraSurge)/1000; const usableKwh = continuousKw*Math.max(0,moneyN(hours)); const batteryKwh = usableKwh>0 ? usableKwh/(DEFAULTS.batteryDod*DEFAULTS.batteryEff)*DEFAULTS.batteryReserve : 0; return { items, continuousKw, surgeKw, usableKwh, batteryKwh }; }

export function siteCost(pricing,key,standard,kwp){
 const item=pricing.siteCosts?.[key];if(!item||item.mode==='standard')return standard;
 if(!['fixed','per_kwp','quantity'].includes(item.mode))throw Error('วิธีคิดราคาหน้างานไม่ถูกต้อง');
 const rate=Number(item.rate),qty=Number(item.quantity??1);
 if(!Number.isFinite(rate)||rate<0||!Number.isFinite(qty)||qty<0)throw Error('ราคาหน้างานและจำนวนต้องไม่ติดลบ');
 return rate*(item.mode==='per_kwp'?kwp:item.mode==='quantity'?qty:1);
}

export function priceEstimate({panel,panelCount,inverter,battery,batteryCount,inverterCount=1,pricing}){ pricing = normalizePricing(pricing); const kwp = panel ? (Number(panel.panel_wp||0) * Number(panelCount||0) / 1000) : 0; const panelTotal = panel ? Number(panel.sell_price||0) * panelCount : 0; const inverterTotal = inverter ? Number(inverter.sell_price||0) * Math.max(1,inverterCount||1) : 0; const batteryTotal = battery ? Number(battery.sell_price||0) * Math.max(1,batteryCount||1) : 0; const equipment = panelTotal + inverterTotal + batteryTotal; const labor = siteCost(pricing,'labor',kwp*pricing.labor_per_kwp,kwp); const structure = siteCost(pricing,'structure',kwp*pricing.structure_per_kwp,kwp); const wiring = siteCost(pricing,'wiring',kwp*pricing.wiring_per_kwp,kwp); const transport = siteCost(pricing,'transport',pricing.transport_flat,kwp); const admin = siteCost(pricing,'admin',pricing.admin_flat,kwp); const extra = siteCost(pricing,'extra',0,kwp); const base = equipment+labor+structure+wiring+transport+admin+extra; const margin = base*(pricing.margin_percent/100); const vatBase = base+margin; const vat = vatBase*(pricing.vat_percent/100); const total = vatBase + vat; return { kwp,panelTotal,inverterTotal,batteryTotal,equipment,labor,structure,wiring,transport,admin,extra,margin,vat,total }; }
export function usageCalculation({monthlyKwh, monthlyBill, tariffType, daytimePercent, panelWp, yieldPerKwpMonth=DEFAULTS.yieldPerKwpMonth}){ const usage = estimateMonthlyKwh(monthlyKwh, monthlyBill, tariffType); const kwh = usage.monthlyKwh; const dayPct = Math.max(0, Math.min(100, Number(daytimePercent||0))); const dayUse = kwh*(dayPct/100); const panelCount = kwh>0 ? Math.max(1, Math.ceil((dayUse/yieldPerKwpMonth*1000)/Number(panelWp||580))) : 0; const kwp = panelCount*Number(panelWp||580)/1000; const invTarget = kwp>0 ? kwp/1.15 : 0; const genMonth = kwp*yieldPerKwpMonth; const selfUse = Math.min(dayUse, genMonth); const excess = Math.max(0, genMonth-selfUse); const effRate = kwh>0 && moneyN(monthlyBill)>0 ? moneyN(monthlyBill)/kwh : 0; const saveMonth = selfUse*effRate; return { source:usage.source, monthlyKwh:kwh, dayUse, panelCount, kwp, invTarget, genMonth, genYear:genMonth*12, genDay:genMonth*12/365, selfUse, excess, selfUseRatio:genMonth>0?selfUse/genMonth:0, saveMonth, saveYear:saveMonth*12 }; }
export function budgetCalculation({budget, systemType, panel, items, pricing, backup}){ const b = moneyN(budget); if(!b || !panel) return null; let best = null; for(let count=1; count<=500; count++){ const kwp = count*Number(panel.panel_wp||0)/1000; const invTarget = Math.max(kwp/1.15, systemType==='Hybrid' ? backup.continuousKw*1.25 : 0, systemType==='Hybrid' ? backup.surgeKw : 0); const inverter = chooseClosest(items,'power_kw',invTarget,'inverter',systemType); if(!inverter) continue; let battery = null, batteryCount = 0; if(systemType==='Hybrid' && backup.batteryKwh>0){ battery = chooseClosest(items,'capacity_kwh',backup.batteryKwh,'battery','Hybrid'); if(battery) batteryCount = Math.max(1, Math.ceil(backup.batteryKwh/Number(battery.capacity_kwh||1))); } const price = priceEstimate({panel,panelCount:count,inverter,battery,batteryCount,inverterCount:Math.max(1,Math.ceil(invTarget/Number(inverter.power_kw||invTarget||1))),pricing}); if(price.total<=b) best = { panelCount:count, kwp, inverter, battery, batteryCount, price };  } if(!best) return null; const genMonth = best.kwp*DEFAULTS.yieldPerKwpMonth; return { ...best, genMonth, genYear:genMonth*12, genDay:genMonth*12/365 }; }
export function npv(rate, cashflows){ return cashflows.reduce((s,c,i)=> s + c / Math.pow(1+rate,i), 0); }
export function irr(cashflows){ const signs=cashflows.filter(x=>x!==0).map(Math.sign); if(signs.slice(1).filter((s,i)=>s!==signs[i]).length!==1)return null; let low=-0.99, high=1.5; let lv=npv(low,cashflows), hv=npv(high,cashflows); if(lv*hv>0) return null; for(let i=0;i<120;i++){ const mid=(low+high)/2; const mv=npv(mid,cashflows); if(Math.abs(mv)<1e-7) return mid; if(lv*mv<0){ high=mid; hv=mv; } else { low=mid; lv=mv; } } return (low+high)/2; }
export function replacementCost(year,{battery=true,inverter=true}={}){ return (battery&&year===DEFAULTS.batteryReplacementYear?DEFAULTS.batteryReplacementCost:0)+(inverter&&year===DEFAULTS.inverterReplacementYear?DEFAULTS.inverterReplacementCost:0); }
export function economics(projectPrice, annualSaving, replacements={}){ const invest = moneyN(projectPrice), y1 = moneyN(annualSaving); let points=[{year:0,cumulative:-invest}], flows=[-invest], cum=-invest, payback=null; for(let year=1; year<=DEFAULTS.analysisYears; year++){ const save = y1 * Math.pow(1+DEFAULTS.tariffGrowth, year-1) * Math.pow(1-DEFAULTS.degradation, year-1); const maint = invest*DEFAULTS.maintenance; const replacement = replacementCost(year,replacements); const net = save-maint-replacement; const prev=cum; cum += net; if(payback===null && cum>=0 && net>0){ payback = Number(((year-1)+((-prev)/net)).toFixed(1)); } points.push({year,cumulative:cum}); flows.push(net); } const by = y => points.find(p=>p.year===y)?.cumulative ?? null; const i = irr(flows); return { points, payback, irr: i===null?null:i*100, npv: npv(DEFAULTS.discount,flows), profit1: by(1), profit20: by(20), profit25: by(25) } }
export function co2(yearKwh){ return moneyN(yearKwh)*DEFAULTS.co2KgPerKwh/1000; }

/* ออกแบบระบบ: ใช้รุ่น/จำนวนที่เลือกเอง ถ้าไม่เลือกให้คำนวณอัตโนมัติ */
function baseDesignSystem({ mode, systemType, items, pricing, backup, sel, budget, usage }){
  const hybrid = systemType==='Hybrid', warnings=[];
  const panel = items.find(x=>x.id===sel.panelId && x.category==='panel' && x.active!==false && Number(x.panel_wp)>0) || defaultPanel(items);
  if(!panel) return { error:'ยังไม่มีแผง Solar ในฐานข้อมูลอุปกรณ์' };
  const wp = Number(panel.panel_wp||0);
  const u = estimateMonthlyKwh(usage.monthlyKwh, usage.monthlyBill, usage.tariffType);
  let autoPanel = 0;
  if(mode==='budget'){ const b = budgetCalculation({budget,systemType,panel,items,pricing,backup}); autoPanel = b ? b.panelCount : 0; }
  else autoPanel = usageCalculation({...usage, panelWp:wp}).panelCount;
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
  const price = priceEstimate({panel,panelCount:panelQty,inverter,battery,batteryCount:batQty,inverterCount:invQty,pricing});
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
export function usagePlan(usage, systemType, backup) {
  const defaultDayPercent = PERIOD_DEFAULTS[usage.period] ?? 90;
  let dayPercent = Math.max(0, Math.min(100, usage.daytimePercent === '' || usage.daytimePercent == null ? defaultDayPercent : Number(usage.daytimePercent)));
  const estimated = estimateUsage(usage);
  if(usage.hourlyLoad){const a=usage.hourlyLoad.hourlyKwh,total=a.reduce((s,v)=>s+v,0);dayPercent=total>0?a.reduce((s,v,i)=>s+((i%24>=6&&i%24<18)?v:0),0)/total*100:0;}
  const dayMonthly = estimated.monthlyKwh * dayPercent / 100;
  const nightDaily = (estimated.monthlyKwh - dayMonthly) / 30;
  const hybrid = systemType === 'Hybrid';
  const nightBattery = hybrid ? nightDaily / (DEFAULTS.batteryDod * DEFAULTS.batteryEff) * DEFAULTS.batteryReserve : 0;
  return { defaultDayPercent, dayPercent, dayMonthly, nightDaily, estimated,
    solarMonthlyTarget: dayMonthly + (hybrid ? nightDaily * 30 / DEFAULTS.batteryRoundTripEff : 0),
    backup: {...backup, batteryKwh: hybrid ? Math.max(backup.batteryKwh || 0, nightBattery) : 0} };
}


// Local standard time: Jan 1 00:00 through Dec 31 23:00, non-leap year.
export function parseHourlyLoad(data){
 const a=data?.hourlyKwh;
 if(data?.timezone!=='Asia/Bangkok'||!Number.isInteger(data.year)||data.year<2000||data.year>2100||data.year%4===0||!Array.isArray(a)||a.length!==8760||a.some(v=>typeof v!=='number'||!Number.isFinite(v)||v<0)||!a.some(v=>v>0))throw Error('โหลดต้องเป็น JSON ปีปกติที่ไม่ใช่ปีอธิกสุรทิน เขต Asia/Bangkok และ hourlyKwh ครบ 8760 ค่า หน่วย kWh ต่อชั่วโมง');
 return {year:data.year,timezone:'Asia/Bangkok',hourlyKwh:[...a],source:'user-imported-hourly-load'};
}
export function hourlyBalance(usage,kwp,batteryCapacity=0,hybrid=false){
 const load=usage.hourlyLoad?.hourlyKwh,pv=usage.production?.hourlyYield;
 if(!load||!pv)return null;
 if(load.length!==8760||pv.length!==8760||usage.production.station?.tz!==7)throw Error('ข้อมูลรายชั่วโมงต้องครบปีและใช้เวลาท้องถิ่นประเทศไทยตรงกัน');
 const days=[31,28,31,30,31,30,31,31,30,31,30,31],months=[];let t=0;
 // Capacity is deliverable AC kWh; round-trip losses charged on PV input.
 let soc=0;const cap=hybrid?batteryCapacity:0;
 for(const n of days){let direct=0,shifted=0,exported=0,imported=0,generated=0,consumed=0,loss=0,charge=0;
  const openingSoc=soc;
  for(let h=0;h<n*24;h++,t++){
   const g=pv[t]*kwp,l=load[t];generated+=g;consumed+=l;
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

export function designSystem({mode, systemType, items, pricing, backup, sel, budget, usage}) {
  const badBattery=items.find(x=>x.category==='battery'&&x.active!==false&&/SUN\s*2000/i.test(x.model||''));if(systemType==='Hybrid'&&badBattery)return {error:'ข้อมูลอุปกรณ์ผิดประเภท: '+badBattery.model+' เป็นอินเวอร์เตอร์ Huawei ไม่ใช่แบตเตอรี่ กรุณาแก้ประเภทและสเปกจากเอกสารผู้ผลิตในหลังบ้าน'};
  const billingError=validateBilling(usage); if(billingError)return {error:billingError};
  if(sel.panelId&&!items.some(x=>x.id===sel.panelId&&x.category==='panel'&&x.active!==false&&Number(x.panel_wp)>0))return {error:'แผงที่เลือกไม่มีสเปกกำลังที่ใช้งานได้'};
  if(sel.batId&&systemType==='Hybrid'&&!items.some(x=>x.id===sel.batId&&x.category==='battery'&&x.active!==false&&Number(x.capacity_kwh)>0))return {error:'แบตเตอรี่ที่เลือกไม่มีสเปกความจุที่ใช้งานได้'};
  const plan = usagePlan(usage, systemType, backup);
  const phase = usage.phase || '1PH';
  // Unknown phases cannot be silently treated as compatible with the installation.
  const compatible = items.filter(x => x.category !== 'inverter' || x.phase === phase);
  const inverterChoices = compatible.filter(x => x.category === 'inverter' && x.active !== false && Number(x.power_kw)>0 && (!x.system_type || x.system_type === systemType));
  if (!inverterChoices.length) return {error: 'ไม่พบ Inverter ' + (phase === '1PH' ? '1 เฟส' : '3 เฟส') + ' สำหรับ ' + systemType + ' กรุณาเพิ่มอุปกรณ์หรือระบุเฟสในฐานข้อมูลให้ตรงกับมิเตอร์จริง'};
  if (sel.invId && !inverterChoices.some(x => x.id === sel.invId)) return {error:'Inverter ที่เลือกไม่ตรงกับเฟสหรือประเภทระบบ กรุณาเลือกใหม่'};
  const r = baseDesignSystem({mode, systemType, items:compatible, pricing, backup:plan.backup, sel, budget,
    usage:{...usage, yieldPerKwpMonth:usage.production?.monthlyYield?.reduce((s,v)=>s+v,0)/12||DEFAULTS.yieldPerKwpMonth, monthlyKwh:plan.solarMonthlyTarget, monthlyBill:0, daytimePercent:100}});
  if (r.error) return r;
  const yields=usage.production?.monthlyYield || Array(12).fill(DEFAULTS.yieldPerKwpMonth);
  const generations=yields.map(y=>r.kwp*y);
  r.genYear=generations.reduce((s,v)=>s+v,0);r.genMonth=r.genYear/12;r.genDay=r.genYear/365;
  const availableCapacity=r.battery?r.batQty*Number(r.battery.capacity_kwh||0)*DEFAULTS.batteryDod*DEFAULTS.batteryEff/DEFAULTS.batteryReserve:0;
  const hourly=hourlyBalance(usage,r.kwp,availableCapacity,systemType==='Hybrid');
  const directByMonth=hourly?hourly.months.map(m=>m.direct):generations.map(g=>Math.min(plan.dayMonthly,g));
  const direct=directByMonth.reduce((s,v)=>s+v,0)/12;
  const availableBattery = r.battery ? r.batQty * Number(r.battery.capacity_kwh || 0) * DEFAULTS.batteryDod * DEFAULTS.batteryEff / DEFAULTS.batteryReserve : 0;
  const shiftedByMonth=hourly?hourly.months.map(m=>m.shifted):generations.map((g,i)=>systemType==='Hybrid'?Math.min(plan.nightDaily*30,availableBattery*30,Math.max(0,g-directByMonth[i])*DEFAULTS.batteryRoundTripEff):0);
  const shifted=shiftedByMonth.reduce((s,v)=>s+v,0)/12;
  const bill = moneyN(usage.monthlyBill), kwh = hourly?hourly.months.reduce((s,m)=>s+m.consumed,0)/12:plan.estimated.monthlyKwh;
  const monthlyLoads=hourly?hourly.months.map(m=>m.consumed):Array(12).fill(kwh);
  const savings=generations.map((g,i)=>billSaving(usage,monthlyLoads[i],directByMonth[i]+shiftedByMonth[i]));
  const saveMonth=savings.reduce((s,v)=>s+v,0)/12;
  const billBefore=usage.billingMode?.startsWith('pea')?averageBills(monthlyLoads.map(k=>calculateBill(usage,k))):null;
  const billAfter=billBefore?averageBills(generations.map((g,i)=>calculateBill(usage,Math.max(0,monthlyLoads[i]-directByMonth[i]-shiftedByMonth[i])))):null;
  const replacements={battery:!!r.battery,inverter:!!r.inverter};
  const eco = economics(r.price.total, saveMonth * 12,replacements);
  const cashflowRows = eco.points.map((pt, i) => {
    if (!i) return {year:0,saving:0,maintenance:0,replacement:0,net:-r.price.total,accumulated:0,cumulative:pt.cumulative};
    const saving = saveMonth * 12 * Math.pow(1+DEFAULTS.tariffGrowth,i-1) * Math.pow(1-DEFAULTS.degradation,i-1);
    const maintenance = r.price.total * DEFAULTS.maintenance;
    const replacement = replacementCost(pt.year,replacements);
    return {year:pt.year,saving,maintenance,replacement,net:saving-maintenance-replacement,accumulated:pt.cumulative+r.price.total,cumulative:pt.cumulative};
  });
  r.warnings.push(hourly?'จับคู่โหลดที่นำเข้ากับผลผลิต PVWatts ทีละชั่วโมง; ผลผลิตยังเป็นการจำลอง ไม่รับรองเงินประหยัดจริง':usage.production?'มีผลผลิตรายเดือน แต่ยังไม่มีข้อมูลครบเพื่อจับคู่โหลดรายชั่วโมง':'ผลผลิตใช้สมมติฐาน '+DEFAULTS.yieldPerKwpMonth+' kWh/kWp/เดือน ยังไม่มีข้อมูลแดด ทิศทาง และเงาบังเฉพาะสถานที่');
  if(billBefore&&bill>0&&Math.abs(billBefore.total-bill)>Math.max(10,bill*.02))r.warnings.push('บิลจำลองก่อนติดตั้งต่างจากบิลที่กรอก '+Math.abs(billBefore.total-bill).toFixed(2)+' บาท ตรวจรอบบิล ประเภทอัตรา Ft ค่าบริการ และรายการพิเศษก่อนใช้เสนอราคา');
  r.warnings.push('เงินประหยัดและคืนทุนเป็นประมาณการ ไม่คิดรายได้จากไฟส่วนเกิน และไม่ลดค่าบริการหรือค่าความต้องการพลังไฟฟ้า');
  if(!usage.billingMode || usage.billingMode==='estimate')r.warnings.push('ใช้อัตราเฉลี่ยประมาณการ ไม่ใช่การจำลองบิลขั้นบันได/TOU กรุณาระบุวิธีค่าไฟตามบิลก่อนเสนอราคาจริง');
  if(plan.estimated.source.startsWith('estimated'))r.warnings.push('หน่วยไฟประมาณย้อนกลับจากยอดบิลและอัตราที่ตั้งไว้ ควรใช้หน่วยไฟจริงเพื่อเพิ่มความแม่นยำ');
  if(r.invQty>1)r.warnings.push('จำนวนอินเวอร์เตอร์เป็นการประเมินกำลังรวม ต้องยืนยันรุ่นที่ต่อขนานได้และข้อจำกัดของผู้ผลิตก่อนติดตั้ง');
  if(r.battery)r.warnings.push('แบตเตอรี่เป็นคำแนะนำด้านความจุ ต้องตรวจแรงดัน BMS กระแสจ่าย จำนวนที่ต่อได้ และความเข้ากันได้กับอินเวอร์เตอร์ตามคู่มือรุ่นจริง');
  if(r.eco.irr==null)r.warnings.push('IRR ไม่แสดงเมื่อกระแสเงินสดไม่มีรากที่ยืนยันได้ในช่วงที่ค้นหา หรือมีการเปลี่ยนเครื่องหมายหลายครั้ง');
  if(backup.usableKwh>0&&(!backup.items?.length))r.warnings.push('ข้อมูลโหลดสำรองไม่ครบ');
  if (systemType === 'On-Grid' && usage.period !== 'day') r.warnings.push('เลือก On-Grid เอง: ระบบไม่เก็บไฟไว้ใช้กลางคืน คิดเงินประหยัดเฉพาะการใช้ไฟกลางวัน');
  if (systemType === 'Hybrid' && plan.nightDaily > 0) r.warnings.push('การใช้ไฟกลางคืนเป็นค่าเฉลี่ยรายวัน ระยะเวลาจ่ายไฟจริงขึ้นกับโหลดและข้อจำกัดของแบตเตอรี่/อินเวอร์เตอร์');
  if (systemType === 'Hybrid' && shifted + 0.01 < plan.nightDaily*30) r.warnings.push('พลังงานจากแผงหรือแบตเตอรี่ยังไม่ครอบคลุมไฟกลางคืนทั้งหมด ส่วนที่ขาดใช้ไฟจากการไฟฟ้า');
  const firstRecovered=eco.points.findIndex(p=>p.year>0&&p.cumulative>=0);
  if(firstRecovered>=0&&eco.points.slice(firstRecovered+1).some(p=>p.cumulative<0)) r.warnings.push('ค่าเปลี่ยนอุปกรณ์ทำให้ยอดสุทธิกลับมาติดลบหลังจุดคุ้มทุนครั้งแรก กรุณาดูตารางรายปีประกอบ');
  if(!hourly)r.warnings.push('ยังไม่แสดงเงินประหยัดและคืนทุน: ยอดรวมรายเดือนไม่เพียงพอที่จะยืนยันการใช้ไฟตรงกับการผลิต ให้นำเข้าโหลดรายชั่วโมงและผล PVWatts รายชั่วโมงในตั้งค่า');
  return {...r,financialReady:!!hourly&&systemType==='On-Grid'&&!!billBefore,hourlyBalance:hourly, energyBasis:hourly?'hourly-matched':'monthly-upper-bound',billBefore,billAfter,eco,saveMonth,saveYear:saveMonth*12,ratio:r.genMonth>0?(direct + shifted / DEFAULTS.batteryRoundTripEff)/r.genMonth:0,
    co2:co2((direct+shifted)*12),monthlyKwh:kwh,usageSource:plan.estimated.source,backup:plan.backup,
    backupRequiredKwh:backup.batteryKwh||0, nightRequiredKwh:plan.nightDaily/(DEFAULTS.batteryDod*DEFAULTS.batteryEff)*DEFAULTS.batteryReserve, productionSource:usage.production?.source||'default-assumption', billingMode:usage.billingMode||'estimate', phase,dayPercent:plan.dayPercent,nightDaily:plan.nightDaily,directMonthly:direct,shiftedMonthly:shifted,cashflowRows};
}

// PEA residential base energy rates effective September 2026. Ft, VAT and
// fixed charges are separate inputs; billing category never changes with solar.
export function residentialEnergy(kwh, mode='pea112') {
  const tiers=mode==='pea111'?[[15,2.3488],[10,2.9882],[175,3],[200,4.1584],[Infinity,4.3583]]:[[200,3],[200,4.1584],[Infinity,4.3583]];
  let remaining=Math.max(0,Number(kwh)||0),total=0;
  for(const [width,rate]of tiers){const used=Math.min(remaining,width);total+=used*rate;remaining-=used;if(remaining<=0)break;}
  return total;
}
export function validateBilling(u){
  if(Number(u.monthlyKwh)<0||Number(u.monthlyBill)<0)return 'หน่วยไฟและค่าไฟต้องไม่ติดลบ';
  if(Number(u.fixedCharges)<0||(Number(u.monthlyBill)>0&&Number(u.fixedCharges)>Number(u.monthlyBill)))return 'ค่าใช้จ่ายคงที่ต้องอยู่ระหว่าง 0 และยอดบิล';
  if(u.billVat!=null&&(!Number.isFinite(Number(u.billVat))||Number(u.billVat)<0||Number(u.billVat)>100))return 'VAT ต้องอยู่ระหว่าง 0–100%';
  if(!u.billingMode||u.billingMode==='estimate')return null;
  if(!(Number(u.monthlyKwh)>0)&&!(Number(u.monthlyBill)>0))return null;
  if(u.billingMode.startsWith('pea')&&u.tariffReviewRequired)return 'พบประกาศอัตราฐานเปลี่ยน ต้องตรวจสูตรใหม่ก่อนใช้ PEA อัตโนมัติ กรุณาใช้อัตราจากบิลระหว่างรอตรวจ';
  if(u.billingMode.startsWith('pea')&&(!/^\d{4}-(0[1-9]|1[0-2])$/.test(u.billingMonth||'')||u.billingMonth<'2026-09'))return 'ตาราง PEA บ้านชุดนี้เริ่มกันยายน 2569 กรอกรอบบิลตั้งแต่เดือนดังกล่าว หรือใช้อัตราจากบิล';
  if(u.billingMode.startsWith('pea')&&(u.serviceCharge===''||u.serviceCharge==null))return 'กรอกค่าบริการก่อน VAT ตามบิล (รวม 0 หากไม่มี)';
  for(const key of ['serviceCharge','demandCharge','otherCharges'])if(u[key]!=null&&(!Number.isFinite(Number(u[key]))||Number(u[key])<0))return 'ค่าบริการ ค่า demand และรายการอื่นต้องไม่ติดลบ';
  if(u.billingMode.startsWith('pea')&&(u.ft===''||u.ft==null||!Number.isFinite(Number(u.ft))))return 'กรอกค่า Ft จากบิล (บาท/หน่วย) รวมถึงค่า 0 หากบิลระบุ 0';
  if(u.billingMode==='manual'&&(!Number.isFinite(Number(u.energyRate))||!(Number(u.energyRate)>0)))return 'กรอกอัตราค่าไฟพลังงานที่หลีกเลี่ยงได้ รวม Ft และ VAT ตามบิล';
  if(Number(u.fixedCharges)<0)return 'ค่าใช้จ่ายคงที่ต้องไม่ติดลบ';
  return null;
}
export function estimateUsage(u){
 if(u.hourlyLoad)return {monthlyKwh:u.hourlyLoad.hourlyKwh.reduce((s,v)=>s+v,0)/12,source:'hourly-import'};
 if(Number(u.monthlyKwh)>0)return {monthlyKwh:Number(u.monthlyKwh),source:'actual'};
 if(u.billingMode?.startsWith('pea')&&Number(u.monthlyBill)>0&&u.ft!==''&&u.ft!=null&&Number.isFinite(Number(u.ft))){
  const target=Number(u.monthlyBill);let low=0,high=1000;if(target<=calculateBill(u,0).total)return {monthlyKwh:0,source:'estimated-from-tariff'};
  while(calculateBill(u,high).total<target&&high<1e8)high*=2;
  for(let i=0;i<80;i++){const mid=(low+high)/2;if(calculateBill(u,mid).total>target)high=mid;else low=mid;}
  return {monthlyKwh:(low+high)/2,source:'estimated-from-tariff'};
 }
 return estimateMonthlyKwh(u.monthlyKwh,u.monthlyBill,u.tariffType);
}
export function billSaving(u,kwh,offset){
  const avoided=Math.min(Math.max(0,offset),Math.max(0,kwh));
  let result;
  if(u.billingMode?.startsWith('pea'))return Math.max(0,calculateBill(u,kwh).total-calculateBill(u,kwh-avoided).total);
  else if(u.billingMode==='manual')result=avoided*Number(u.energyRate);
  else {const variable=Math.max(0,Number(u.monthlyBill||0)-Number(u.fixedCharges||0));const rate=kwh>0&&Number(u.monthlyBill)>0?variable/kwh:(BILL_RATES[u.tariffType]||BILL_RATES.residential);result=avoided*rate;}
  const cap=Number(u.monthlyBill)>0?Math.max(0,Number(u.monthlyBill)-Number(u.fixedCharges||0)):Infinity;
  return Math.max(0,Math.min(cap,result));
}
export function parsePvwatts(data){
  const size=Number(data?.inputs?.system_capacity),months=data?.outputs?.ac_monthly;
  if(data?.errors?.length||!Number.isFinite(size)||size<=0||!Array.isArray(months)||months.length!==12||months.some(x=>typeof x!=='number'||!Number.isFinite(x)||x<0)||!months.some(x=>x>0))throw Error('ต้องเป็นไฟล์ JSON ผลลัพธ์ PVWatts ที่มี system_capacity และ ac_monthly ครบ 12 เดือน');
  const monthlyYield=months.map(x=>x/size);
  if(monthlyYield.some(x=>x>400))throw Error('ผลผลิตต่อ kWp สูงผิดปกติ ตรวจหน่วยและขนาดระบบในไฟล์');
  let hourlyYield=null;
  if(data.outputs.ac!=null){const a=data.outputs.ac;
   if(!Array.isArray(a)||a.length!==8760||a.some(v=>typeof v!=='number'||!Number.isFinite(v)||v<0)||Number(data.station_info?.tz)!==7)throw Error('PVWatts รายชั่วโมงต้องครบ 8760 ค่า Wac และ station_info.tz = 7');
   hourlyYield=a.map(v=>v/1000/size);
   let t=0;for(const [m,n] of [31,28,31,30,31,30,31,31,30,31,30,31].entries()){const sum=hourlyYield.slice(t,t+n*24).reduce((a,b)=>a+b,0);t+=n*24;if(Math.abs(sum-monthlyYield[m])>Math.max(.05,monthlyYield[m]*.02))throw Error('ผลผลิตรายชั่วโมงกับรายเดือนในไฟล์ไม่สอดคล้องกัน');}
  }
  return {source:'user-imported-pvwatts',hourlyYield,monthlyYield,inputs:Object.fromEntries(Object.entries(data.inputs).filter(([key])=>['system_capacity','module_type','losses','array_type','tilt','azimuth','lat','lon','dc_ac_ratio','inv_eff','dataset'].includes(key))),station:data.station_info||{},version:data.version||null};
}

export const OFFICIAL_FT={provider:'PEA',value:.1623,unit:'THB/kWh',from:'2026-09',to:'2026-12',checked:'2026-10-11',url:'https://www.pea.co.th/en/our-services/tariff/ft?page=0'};
export const OFFICIAL_RESIDENTIAL={provider:'PEA',from:'2026-09',checked:'2026-10-11',url:'https://www.pea.co.th/news/corporate-news/2412'};
export function officialFtForMonth(month){return /^\d{4}-(0[1-9]|1[0-2])$/.test(month)&&month>=OFFICIAL_FT.from&&month<=OFFICIAL_FT.to?{...OFFICIAL_FT}:null;}
export function calculateBill(u,kwh){
 const energy=residentialEnergy(kwh,u.billingMode),ft=Math.max(0,kwh)*Number(u.ft),service=Number(u.serviceCharge||0),demand=Number(u.demandCharge||0),other=Number(u.otherCharges||0);
 const subtotal=energy+ft+service+demand+other,vat=subtotal*Number(u.billVat??7)/100;
 return {kwh:Math.max(0,kwh),energy,ft,service,demand,other,subtotal,vat,total:subtotal+vat};
}
export function averageBills(bills){return Object.fromEntries(Object.keys(bills[0]).map(key=>[key,bills.reduce((s,b)=>s+b[key],0)/bills.length]));}
// These are explicitly sampled alternatives, not a global engineering optimum.
export function compareDesigns(input,current){
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
