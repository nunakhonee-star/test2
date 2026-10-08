
export const DEFAULT_PRICING = { labor_per_kwp:6000, structure_per_kwp:3500, wiring_per_kwp:1800, transport_flat:5000, admin_flat:3000, margin_percent:8, vat_percent:7 };
export const DEFAULTS = { yieldPerKwpMonth:125, batteryDod:0.90, batteryEff:0.95, batteryReserve:1.10, tariffGrowth:0.02, degradation:0.005, discount:0.08, maintenance:0.005, co2KgPerKwh:0.5664, analysisYears:25 };
export const BILL_RATES = { residential:4.2, business:4.8, industrial:4.5 };

export function moneyN(v){ return Number(v||0); }
export function normalizePricing(p={}){ return { ...DEFAULT_PRICING, ...p }; }
export function estimateMonthlyKwh(monthlyKwh, monthlyBill, tariffType){ const k = moneyN(monthlyKwh); if(k>0) return { monthlyKwh:k, source:'actual' }; const b = moneyN(monthlyBill); const rate = BILL_RATES[tariffType] || BILL_RATES.residential; return { monthlyKwh: b>0? b/rate : 0, source: b>0?'estimated':'none' }; }
export function defaultPanel(items){ return items.find(x=>x.category==='panel' && x.is_default) || items.find(x=>x.category==='panel'); }
export function chooseClosest(items, field, target, category, systemType=''){ const list = items.filter(x=>x.category===category && x.active!==false && Number(x[field]||0)>0 && (!systemType || !x.system_type || x.system_type===systemType)); if(!list.length || !target) return null; return [...list].sort((a,b)=>Math.abs(Number(a[field])-target)-Math.abs(Number(b[field])-target))[0]; }
export function toCalcAppliance(r){ const has=!!r.has_surge; return { id:r.id, name:r.name, powerW:Number(r.power_w||0), hasSurge:has, surge:has?Number(r.surge_factor||1):1 }; }
export function backupFromAppliances(qtys, hours, library=[]){ let contW=0, extraSurge=0, items=[]; for(const a of library){ const qty = Math.max(0, Number(qtys[a.id]||0)); if(!qty) continue; const runW = a.powerW*qty; const startW = a.hasSurge ? a.powerW*a.surge*qty : runW; contW += runW; if(a.hasSurge) extraSurge += Math.max(0, startW-runW); items.push({ ...a, qty, runW, startW }); } const continuousKw = contW/1000; const surgeKw = (contW+extraSurge)/1000; const usableKwh = continuousKw*moneyN(hours); const batteryKwh = usableKwh>0 ? usableKwh/(DEFAULTS.batteryDod*DEFAULTS.batteryEff)*DEFAULTS.batteryReserve : 0; return { items, continuousKw, surgeKw, usableKwh, batteryKwh }; }
export function priceEstimate({panel,panelCount,inverter,battery,batteryCount,inverterCount=1,pricing}){ pricing = normalizePricing(pricing); const kwp = panel ? (Number(panel.panel_wp||0) * Number(panelCount||0) / 1000) : 0; const panelTotal = panel ? Number(panel.sell_price||0) * panelCount : 0; const inverterTotal = inverter ? Number(inverter.sell_price||0) * Math.max(1,inverterCount||1) : 0; const batteryTotal = battery ? Number(battery.sell_price||0) * Math.max(1,batteryCount||1) : 0; const equipment = panelTotal + inverterTotal + batteryTotal; const labor = kwp*pricing.labor_per_kwp; const structure = kwp*pricing.structure_per_kwp; const wiring = kwp*pricing.wiring_per_kwp; const transport = pricing.transport_flat; const admin = pricing.admin_flat; const base = equipment+labor+structure+wiring+transport+admin; const margin = base*(pricing.margin_percent/100); const vatBase = base+margin; const vat = vatBase*(pricing.vat_percent/100); const total = vatBase + vat; return { kwp,panelTotal,inverterTotal,batteryTotal,equipment,labor,structure,wiring,transport,admin,margin,vat,total }; }
export function usageCalculation({monthlyKwh, monthlyBill, tariffType, daytimePercent, panelWp}){ const usage = estimateMonthlyKwh(monthlyKwh, monthlyBill, tariffType); const kwh = usage.monthlyKwh; const dayPct = Math.max(0, Math.min(100, Number(daytimePercent||0))); const dayUse = kwh*(dayPct/100); const panelCount = kwh>0 ? Math.max(1, Math.ceil((dayUse/DEFAULTS.yieldPerKwpMonth*1000)/Number(panelWp||580))) : 0; const kwp = panelCount*Number(panelWp||580)/1000; const invTarget = kwp>0 ? kwp/1.15 : 0; const genMonth = kwp*DEFAULTS.yieldPerKwpMonth; const selfUse = Math.min(dayUse, genMonth); const excess = Math.max(0, genMonth-selfUse); const effRate = kwh>0 && moneyN(monthlyBill)>0 ? moneyN(monthlyBill)/kwh : 0; const saveMonth = selfUse*effRate; return { source:usage.source, monthlyKwh:kwh, dayUse, panelCount, kwp, invTarget, genMonth, genYear:genMonth*12, genDay:genMonth*12/365, selfUse, excess, selfUseRatio:genMonth>0?selfUse/genMonth:0, saveMonth, saveYear:saveMonth*12 }; }
export function budgetCalculation({budget, systemType, panel, items, pricing, backup}){ const b = moneyN(budget); if(!b || !panel) return null; let best = null; for(let count=1; count<=500; count++){ const kwp = count*Number(panel.panel_wp||0)/1000; const invTarget = Math.max(kwp/1.15, systemType==='Hybrid' ? backup.continuousKw*1.25 : 0, systemType==='Hybrid' ? backup.surgeKw : 0); const inverter = chooseClosest(items,'power_kw',invTarget,'inverter',systemType); if(!inverter) continue; let battery = null, batteryCount = 0; if(systemType==='Hybrid' && backup.batteryKwh>0){ battery = chooseClosest(items,'capacity_kwh',backup.batteryKwh,'battery','Hybrid'); if(battery) batteryCount = Math.max(1, Math.ceil(backup.batteryKwh/Number(battery.capacity_kwh||1))); } const price = priceEstimate({panel,panelCount:count,inverter,battery,batteryCount,pricing}); if(price.total<=b) best = { panelCount:count, kwp, inverter, battery, batteryCount, price }; else break; } if(!best) return null; const genMonth = best.kwp*DEFAULTS.yieldPerKwpMonth; return { ...best, genMonth, genYear:genMonth*12, genDay:genMonth*12/365 }; }
export function npv(rate, cashflows){ return cashflows.reduce((s,c,i)=> s + c / Math.pow(1+rate,i), 0); }
export function irr(cashflows){ let low=-0.99, high=1.5; let lv=npv(low,cashflows), hv=npv(high,cashflows); if(lv*hv>0) return null; for(let i=0;i<120;i++){ const mid=(low+high)/2; const mv=npv(mid,cashflows); if(Math.abs(mv)<1e-7) return mid; if(lv*mv<0){ high=mid; hv=mv; } else { low=mid; lv=mv; } } return (low+high)/2; }
export function economics(projectPrice, annualSaving){ const invest = moneyN(projectPrice), y1 = moneyN(annualSaving); let points=[{year:0,cumulative:-invest}], flows=[-invest], cum=-invest, payback=null; for(let year=1; year<=DEFAULTS.analysisYears; year++){ const save = y1 * Math.pow(1+DEFAULTS.tariffGrowth, year-1) * Math.pow(1-DEFAULTS.degradation, year-1); const maint = invest*DEFAULTS.maintenance; const net = save-maint; const prev=cum; cum += net; if(payback===null && cum>=0 && net>0){ payback = Number(((year-1)+((-prev)/net)).toFixed(1)); } points.push({year,cumulative:cum}); flows.push(net); } const by = y => points.find(p=>p.year===y)?.cumulative ?? null; const i = irr(flows); return { points, payback, irr: i===null?null:i*100, npv: npv(DEFAULTS.discount,flows), profit1: by(1), profit20: by(20), profit25: by(25) } }
export function co2(yearKwh){ return moneyN(yearKwh)*DEFAULTS.co2KgPerKwh/1000; }

/* ออกแบบระบบ: ใช้รุ่น/จำนวนที่เลือกเอง ถ้าไม่เลือกให้คำนวณอัตโนมัติ */
export function designSystem({ mode, systemType, items, pricing, backup, sel, budget, usage }){
  const hybrid = systemType==='Hybrid', warnings=[];
  const panel = items.find(x=>x.id===sel.panelId) || defaultPanel(items);
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
  const invQty = sel.invQty>0 ? Math.floor(sel.invQty) : autoInvQty;
  const need = hybrid ? backup.batteryKwh : 0;
  const autoBat = need>0 ? chooseClosest(items,'capacity_kwh',need,'battery','Hybrid') : null;
  const battery = hybrid ? (items.find(x=>x.id===sel.batId) || autoBat) : null;
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
