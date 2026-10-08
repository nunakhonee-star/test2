import { DEFAULT_PRICING, APPLIANCE_LIBRARY, normalizePricing, backupFromAppliances, toCalcAppliance, designSystem } from './calc.js';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

let supabase = null;
if (SUPABASE_URL && SUPABASE_KEY) {
  try { const m = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm'); supabase = m.createClient(SUPABASE_URL, SUPABASE_KEY); }
  catch (e) { console.warn('Supabase โหลดไม่ได้', e); }
}

const state = { equipment: [], assessments: [], appliances: [], apQty: {}, apLocal: true, apNote: '', pricing: { ...DEFAULT_PRICING }, editEq: null, editAp: null, last: null };
const $ = id => document.getElementById(id);
const num = id => Number($(id).value || 0);
const radio = n => document.querySelector(`input[name="${n}"]:checked`)?.value;
const money = v => new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB', maximumFractionDigits: 0 }).format(Number(v || 0));
const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const seg = (name, opts) => `<div class="seg">${opts.map(([v, l], i) => `<label><input type="radio" name="${name}" value="${v}" ${i ? '' : 'checked'}><span>${l}</span></label>`).join('')}</div>`;
const CAT = { panel: 'แผงโซลาร์', inverter: 'Inverter', battery: 'แบตเตอรี่' }, UNIT = { panel: 'แผง', inverter: 'ตัว', battery: 'ลูก' };
const spec = x => x.panel_wp ? `${x.panel_wp} Wp` : x.power_kw ? `${x.power_kw} kW` : x.capacity_kwh ? `${x.capacity_kwh} kWh` : '';

/* ---------- โครงหน้า ---------- */
$('app').innerHTML = `
<header class="top">
  <div class="brand"><span class="mark">☀</span><b>Solar Office Pro</b></div>
  <nav class="nav">${[['calculator', 'ประเมินระบบ'], ['history', 'ประวัติลูกค้า'], ['equipment', 'ฐานข้อมูลอุปกรณ์'], ['appliances', 'โหลดสำรอง'], ['pricing', 'ราคาติดตั้ง']].map(([id, l], i) => `<button data-page="${id}" class="${i ? '' : 'active'}">${l}</button>`).join('')}</nav>
  <span class="mode">${supabase ? 'เชื่อมต่อ Supabase' : 'โหมดทดลอง (ไม่บันทึกลงฐานข้อมูล)'}</span>
</header>
<main>
<section id="calculator" class="page active"><div class="calc">

<div class="inputs" id="inputs">
  <section class="step"><h2>ลูกค้าและประเภทงาน</h2>
    <div class="grid3"><label>ชื่อลูกค้า<input id="customerName" placeholder="คุณสมชาย / บริษัท ABC"></label><label>เบอร์โทร<input id="phone" inputmode="tel"></label><label>สถานที่ / โครงการ<input id="siteName"></label></div>
    <div class="grid2"><div class="field"><span>ประเภทระบบ</span>${seg('systemType', [['On-Grid', 'On-Grid'], ['Hybrid', 'Hybrid (มีแบตเตอรี่)']])}</div><div class="field"><span>ประเมินจาก</span>${seg('calcMode', [['usage', 'การใช้ไฟ'], ['budget', 'งบประมาณ']])}</div></div>
  </section>

  <section class="step"><h2>การใช้ไฟและงบประมาณ</h2>
    <div id="budgetRow" class="grid2" hidden><label>งบประมาณลูกค้า (บาท)<input id="budgetAmount" type="number" value="100000"></label></div>
    <div class="grid2">
      <label>หน่วยไฟต่อเดือน (kWh)<input id="monthlyKwh" type="number" value="1200"><small>เว้นว่างได้ ระบบจะประมาณจากค่าไฟ</small></label>
      <label>ค่าไฟต่อเดือน (บาท)<input id="monthlyBill" type="number" value="5000"></label>
      <label>ประเภทผู้ใช้ไฟ<select id="tariffType"><option value="residential">บ้านอยู่อาศัย</option><option value="business">ธุรกิจทั่วไป</option><option value="industrial">โรงงาน / อุตสาหกรรม</option></select></label>
      <label>ใช้ไฟช่วงกลางวัน (%)<input id="daytimePercent" type="number" min="0" max="100" value="70"></label>
    </div>
    <p class="hint" id="usageNote"></p>
  </section>

  <section class="step" id="backupStep" hidden><h2>โหลดสำรอง (Hybrid)</h2>
    <div class="row-between"><label class="inline">สำรองไฟนาน (ชั่วโมง)<input id="backupHours" type="number" step="0.5" min="0" value="5"></label><button type="button" class="link" data-go="appliances">จัดการรายการโหลด</button></div>
    <div id="applianceList" class="ap-list"></div>
    <div class="figures"><div><span>โหลดต่อเนื่อง</span><b id="bkCont">—</b></div><div><span>โหลดสูงสุด (Surge)</span><b id="bkSurge">—</b></div><div><span>แบตเตอรี่ที่ต้องใช้</span><b id="bkBat">—</b></div></div>
  </section>

  <section class="step"><h2>อุปกรณ์ที่ติดตั้ง</h2>
    <p class="hint">เลือกรุ่นและกรอกจำนวนเองได้ ถ้าเลือก “อัตโนมัติ” หรือเว้นจำนวนว่าง ระบบจะเลือกให้ตามข้อมูลด้านบน</p>
    ${Object.keys(CAT).map(c => `<div class="eq-row" id="row_${c}"><span class="eq-name">${CAT[c]}</span><select id="sel_${c}" aria-label="${CAT[c]}"></select><label class="qty"><input id="qty_${c}" type="number" min="0" step="1" placeholder="อัตโนมัติ" aria-label="จำนวน${CAT[c]}"><span>${UNIT[c]}</span></label></div>`).join('')}
  </section>

  <section class="step"><h2>หมายเหตุ</h2><textarea id="notes" placeholder="รายละเอียดเพิ่มเติม (ไม่บังคับ)"></textarea>
    <div class="actions"><button class="btn primary" id="saveBtn">บันทึกการประเมิน</button><button class="btn" id="printBtn">พิมพ์ / PDF</button></div></section>
</div>

<aside class="result" id="result">
  <div id="resultEmpty" class="empty" hidden></div>
  <div id="resultBody">
    <div class="headline"><span>ราคาโครงการรวม (รวม VAT)</span><b id="rTotal">—</b><small id="rSystem">—</small></div>
    <div class="trio"><div><span>ประหยัดค่าไฟ / เดือน</span><b id="rSave">—</b></div><div><span>คืนทุน</span><b id="rPay">—</b></div><div><span>กำไรสุทธิ 25 ปี</span><b id="rProfit">—</b></div></div>
    <div id="rWarn"></div>
    <section class="panel"><h3>อุปกรณ์และค่าใช้จ่าย</h3><div class="table-wrap"><table class="cost"><thead><tr><th>รายการ</th><th class="r">จำนวน</th><th class="r">จำนวนเงิน</th></tr></thead><tbody id="rCost"></tbody></table></div></section>
    <section class="panel"><h3>การผลิตไฟฟ้า</h3><dl class="specs" id="rGen"></dl></section>
    <section class="panel"><h3>ผลตอบแทน 25 ปี</h3><dl class="specs" id="rEco"></dl><div class="chart-wrap" id="chart"></div></section>
  </div>
</aside>
</div></section>

<section id="history" class="page"><div class="head"><h1>ประวัติการประเมิน</h1><button class="btn" id="refreshHistoryBtn">รีเฟรช</button></div>
  <div class="figures big" id="histStats"></div>
  <div class="panel"><div class="table-wrap"><table class="cost"><thead><tr><th>วันที่</th><th>ลูกค้า</th><th>ระบบ</th><th class="r">kWp</th><th class="r">ราคาโครงการ</th><th class="r">คืนทุน</th><th></th></tr></thead><tbody id="historyBody"></tbody></table></div></div></section>

<section id="equipment" class="page"><div class="head"><h1>ฐานข้อมูลอุปกรณ์</h1><button class="btn" id="refreshEquipmentBtn">รีเฟรช</button></div>
  <div class="admin"><form class="panel form" id="equipmentForm"><h3 id="equipmentFormTitle">เพิ่มอุปกรณ์</h3>
    <label>ประเภท<select id="eqCategory"><option value="panel">แผงโซลาร์</option><option value="inverter">Inverter</option><option value="battery">แบตเตอรี่</option></select></label>
    <div class="grid2"><label>ยี่ห้อ<input id="eqBrand" required></label><label>รุ่น<input id="eqModel" required></label></div>
    <label class="f-panel">กำลังแผง (Wp)<input id="eqPanelWp" type="number"></label>
    <label class="f-inverter">กำลัง Inverter (kW)<input id="eqPowerKw" type="number" step="0.1"></label>
    <label class="f-battery">ความจุ (kWh)<input id="eqCapacityKwh" type="number" step="0.1"></label>
    <label class="f-inverter f-battery">ใช้ได้กับระบบ<select id="eqSystemType"><option value="">ทุกระบบ</option><option>On-Grid</option><option>Hybrid</option></select></label>
    <div class="grid2"><label>ต้นทุน<input id="eqCost" type="number"></label><label>ราคาขาย<input id="eqSellPrice" type="number"></label></div>
    <label class="f-panel">ใช้เป็นแผงเริ่มต้น<select id="eqIsDefault"><option value="false">ไม่ใช่</option><option value="true">ใช่</option></select></label>
    <div class="actions"><button class="btn primary" type="submit">บันทึก</button><button class="btn" type="button" id="eqCancelBtn">ล้างฟอร์ม</button></div></form>
    <div class="panel" id="equipmentList"></div></div></section>

<section id="appliances" class="page"><div class="head"><h1>โหลดสำรองสำหรับระบบ Hybrid</h1></div>
  <p class="hint wide" id="apNote"></p>
  <div class="admin"><form class="panel form" id="applianceForm"><h3 id="applianceFormTitle">เพิ่มเครื่องใช้ไฟฟ้า</h3>
    <label>ชื่อเครื่องใช้ไฟฟ้า<input id="apName" required placeholder="เช่น แอร์ 9,000 BTU"></label>
    <label>กำลังไฟขณะทำงาน (W)<input id="apPower" type="number" min="1" required></label>
    <label class="check"><input id="apSurge" type="checkbox"><span>มีไฟกระชากตอนสตาร์ท (Surge)</span></label>
    <label id="apFactorRow" hidden>ตัวคูณ Surge (เท่า)<input id="apFactor" type="number" min="1" step="0.1" value="3"></label>
    <div class="actions"><button class="btn primary" type="submit">บันทึก</button><button class="btn" type="button" id="apCancelBtn">ล้างฟอร์ม</button></div></form>
    <div class="panel" id="applianceAdmin"></div></div></section>

<section id="pricing" class="page"><div class="head"><h1>ราคาติดตั้ง</h1><button class="btn" id="loadPricingBtn">รีเฟรช</button></div>
  <form class="panel form narrow" id="pricingForm"><p class="hint">ใช้คำนวณราคาโครงการทั้งโหมดการใช้ไฟและโหมดงบประมาณ</p>
    <div class="grid2"><label>ค่าแรงติดตั้ง / kWp<input id="laborPerKwp" type="number"></label><label>โครงสร้างและราง / kWp<input id="structurePerKwp" type="number"></label><label>สายไฟและอุปกรณ์ / kWp<input id="wiringPerKwp" type="number"></label><label>ค่าขนส่ง / เดินทาง<input id="transportFlat" type="number"></label><label>ค่าดำเนินการ<input id="adminFlat" type="number"></label><label>Margin (%)<input id="marginPercent" type="number"></label><label>VAT (%)<input id="vatPercent" type="number"></label></div>
    <div class="actions"><button class="btn primary" type="submit">บันทึกราคา</button></div></form></section>
</main>`;

/* ---------- นำทาง ---------- */
function showPage(id) {
  document.querySelectorAll('.nav button,.page').forEach(x => x.classList.remove('active'));
  document.querySelector(`.nav button[data-page="${id}"]`)?.classList.add('active'); $(id).classList.add('active'); scrollTo(0, 0);
}
document.querySelectorAll('.nav button').forEach(b => b.onclick = () => showPage(b.dataset.page));
document.querySelectorAll('[data-go]').forEach(b => b.onclick = () => showPage(b.dataset.go));

/* ---------- โหลดข้อมูล ---------- */
const demoEquipment = () => [
  { id: 'p1', category: 'panel', brand: 'Demo Solar', model: '580W Mono', panel_wp: 580, cost: 2500, sell_price: 3200, active: true, is_default: true },
  { id: 'i1', category: 'inverter', brand: 'Demo Inverter', model: '6K On Grid', power_kw: 6, cost: 22000, sell_price: 28000, active: true, system_type: 'On-Grid' },
  { id: 'i2', category: 'inverter', brand: 'Demo Inverter', model: '10K Hybrid', power_kw: 10, cost: 35000, sell_price: 45000, active: true, system_type: 'Hybrid' },
  { id: 'b1', category: 'battery', brand: 'Demo Battery', model: '10kWh LFP', capacity_kwh: 10, cost: 65000, sell_price: 82000, active: true, system_type: 'Hybrid' },
  { id: 'b2', category: 'battery', brand: 'Demo Battery', model: '15kWh LFP', capacity_kwh: 15, cost: 82000, sell_price: 99000, active: true, system_type: 'Hybrid' }];
async function loadEquipment() {
  if (!supabase) state.equipment = demoEquipment();
  else { const { data, error } = await supabase.from('equipment').select('*').order('category').order('brand'); state.equipment = error ? demoEquipment() : (data || []); }
  renderEquipment(); lastSys = null; calc();
}
async function loadAssessments() {
  if (supabase) { const { data, error } = await supabase.from('assessments').select('*').order('created_at', { ascending: false }); state.assessments = error ? [] : (data || []); }
  renderHistory();
}
async function loadPricing() {
  if (supabase) { const { data, error } = await supabase.from('pricing_settings').select('*').limit(1).maybeSingle(); state.pricing = normalizePricing(error ? DEFAULT_PRICING : (data || DEFAULT_PRICING)); }
  else state.pricing = { ...DEFAULT_PRICING };
  const p = state.pricing; [['laborPerKwp', 'labor_per_kwp'], ['structurePerKwp', 'structure_per_kwp'], ['wiringPerKwp', 'wiring_per_kwp'], ['transportFlat', 'transport_flat'], ['adminFlat', 'admin_flat'], ['marginPercent', 'margin_percent'], ['vatPercent', 'vat_percent']].forEach(([i, k]) => $(i).value = p[k]);
  calc();
}
const AP_LOCAL = 'sop_appliances';
async function loadAppliances() {
  state.apLocal = true; state.apNote = '';
  if (supabase) {
    const { data, error } = await supabase.from('backup_appliances').select('*').order('sort_order').order('name');
    if (!error) { state.apLocal = false; state.appliances = (data || []).filter(a => a.active !== false); }
    else state.apNote = 'ยังไม่พบตาราง backup_appliances ในฐานข้อมูล รายการนี้จึงเก็บในเบราว์เซอร์เครื่องนี้ ให้รัน schema.sql ใน Supabase เพื่อใช้ร่วมกันทุกเครื่อง';
  }
  if (state.apLocal) {
    let saved = null; try { saved = JSON.parse(localStorage.getItem(AP_LOCAL)); } catch { }
    state.appliances = saved || APPLIANCE_LIBRARY.map(a => ({ id: a.id, name: a.name, power_w: a.powerW, has_surge: a.hasSurge, surge_factor: a.surge }));
  }
  renderAppliances(); calc();
}
const saveLocalAp = () => { try { localStorage.setItem(AP_LOCAL, JSON.stringify(state.appliances)); } catch { } };

/* ---------- ตัวเลือกอุปกรณ์ ---------- */
let lastSys = null;
function fillSelects() {
  const sys = radio('systemType');
  for (const c of Object.keys(CAT)) {
    const el = $('sel_' + c), keep = el.value;
    const list = state.equipment.filter(x => x.category === c && x.active !== false && (c === 'panel' || !x.system_type || x.system_type === sys));
    el.innerHTML = '<option value="">อัตโนมัติ</option>' + list.map(x => `<option value="${x.id}">${esc(x.brand)} ${esc(x.model)} · ${spec(x)} · ${money(x.sell_price)}</option>`).join('');
    el.value = list.some(x => x.id === keep) ? keep : '';
  }
}

/* ---------- คำนวณและแสดงผล ---------- */
function calc() {
  const sys = radio('systemType'), mode = radio('calcMode');
  $('budgetRow').hidden = mode !== 'budget'; $('backupStep').hidden = sys !== 'Hybrid'; $('row_battery').hidden = sys !== 'Hybrid';
  if (sys !== lastSys) { lastSys = sys; fillSelects(); }
  const backup = sys === 'Hybrid' ? backupFromAppliances(state.apQty, num('backupHours'), state.appliances.map(toCalcAppliance)) : { continuousKw: 0, surgeKw: 0, usableKwh: 0, batteryKwh: 0, items: [] };
  $('bkCont').textContent = backup.continuousKw ? backup.continuousKw.toFixed(2) + ' kW' : '—';
  $('bkSurge').textContent = backup.surgeKw ? backup.surgeKw.toFixed(2) + ' kW' : '—';
  $('bkBat').textContent = backup.batteryKwh ? backup.batteryKwh.toFixed(1) + ' kWh' : '—';
  const usage = { monthlyKwh: $('monthlyKwh').value, monthlyBill: $('monthlyBill').value, tariffType: $('tariffType').value, daytimePercent: $('daytimePercent').value };
  const sel = { panelId: $('sel_panel').value, panelQty: num('qty_panel'), invId: $('sel_inverter').value, invQty: num('qty_inverter'), batId: $('sel_battery').value, batQty: num('qty_battery') };
  const r = designSystem({ mode, systemType: sys, items: state.equipment, pricing: state.pricing, backup, sel, budget: num('budgetAmount'), usage });
  if (r.error) { state.last = null; $('resultBody').hidden = true; $('resultEmpty').hidden = false; $('resultEmpty').textContent = r.error; $('usageNote').textContent = ''; return; }
  $('resultBody').hidden = false; $('resultEmpty').hidden = true;
  state.last = { ...r, systemType: sys, calcMode: mode, backup };
  render(r, sys);
}
function render(r, sys) {
  const a = r.auto, nm = x => x ? `${x.brand} ${x.model}` : 'ไม่พบรุ่น';
  $('sel_panel').options[0].textContent = `อัตโนมัติ (${nm(a.panel)})`; $('sel_inverter').options[0].textContent = `อัตโนมัติ (${nm(a.inverter)})`; if (sys === 'Hybrid') $('sel_battery').options[0].textContent = a.battery ? `อัตโนมัติ (${nm(a.battery)})` : 'อัตโนมัติ';
  $('qty_panel').placeholder = `อัตโนมัติ ${a.panelQty || ''}`; $('qty_inverter').placeholder = `อัตโนมัติ ${a.invQty}`; $('qty_battery').placeholder = `อัตโนมัติ ${a.batQty || ''}`;
  $('usageNote').textContent = r.usageSource === 'actual' ? 'ใช้หน่วยไฟจริงจากบิล' : r.usageSource === 'estimated' ? `ประมาณหน่วยไฟจากค่าไฟ ≈ ${r.monthlyKwh.toFixed(0)} kWh/เดือน` : 'ยังไม่มีข้อมูลหน่วยไฟ จึงสมมติใช้ไฟเองได้ 80% ของที่ผลิต';
  const pay = r.eco.payback ? `${r.eco.payback} ปี` : 'เกิน 25 ปี', p = r.price;
  $('rTotal').textContent = money(p.total);
  $('rSystem').textContent = `${sys} · ${r.kwp.toFixed(2)} kWp${r.battery ? ` · แบตเตอรี่ ${(r.batQty * Number(r.battery.capacity_kwh || 0)).toFixed(1)} kWh` : ''}`;
  $('rSave').textContent = money(r.saveMonth); $('rPay').textContent = pay; $('rProfit').textContent = money(r.eco.profit25);
  $('rWarn').innerHTML = r.warnings.map(w => `<p class="warn">${esc(w)}</p>`).join('');
  const eq = (k, x, q, tot) => x ? `<tr><td>${CAT[k]}: ${esc(x.brand)} ${esc(x.model)} <span class="tag ${r.manual[k] ? 'on' : ''}">${r.manual[k] ? 'เลือกเอง' : 'อัตโนมัติ'}</span><small>${spec(x)} · ${money(x.sell_price)} / ${UNIT[k]}</small></td><td class="r">${q} ${UNIT[k]}</td><td class="r">${money(tot)}</td></tr>` : '';
  const row = (l, t, cls = '') => `<tr class="${cls}"><td>${l}</td><td></td><td class="r">${money(t)}</td></tr>`;
  $('rCost').innerHTML = eq('panel', r.panel, r.panelQty, p.panelTotal) + eq('inverter', r.inverter, r.invQty, p.inverterTotal) + eq('battery', r.battery, r.batQty, p.batteryTotal)
    + row('รวมค่าอุปกรณ์', p.equipment, 'sub') + row('ค่าแรงติดตั้ง', p.labor) + row('โครงสร้างและราง', p.structure) + row('สายไฟและอุปกรณ์ประกอบ', p.wiring) + row('ค่าขนส่ง', p.transport) + row('ค่าดำเนินการ', p.admin)
    + row('Margin', p.margin) + row('VAT', p.vat) + row('รวมทั้งสิ้น', p.total, 'total');
  const dl = rows => rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
  $('rGen').innerHTML = dl([['ผลิตต่อวัน', `${r.genDay.toFixed(1)} kWh`], ['ผลิตต่อเดือน', `${r.genMonth.toFixed(0)} kWh`], ['ผลิตต่อปี (ปีแรก)', `${r.genYear.toFixed(0)} kWh`], ['ใช้เองได้', `${(r.ratio * 100).toFixed(0)}% ของที่ผลิต`]]);
  $('rEco').innerHTML = dl([['ประหยัดปีแรก', money(r.saveYear)], ['IRR', r.eco.irr == null ? '—' : r.eco.irr.toFixed(1) + '%'], ['NPV 25 ปี', money(r.eco.npv)], ['ลด CO₂', `${r.co2.toFixed(1)} ตัน/ปี`]]);
  renderBar(r.eco.points, r.eco.payback);
}
const shortMoney = v => { const a = Math.abs(v), s = v < 0 ? '-' : ''; return a >= 1e6 ? s + (a / 1e6).toFixed(1) + 'ล.' : a >= 1e3 ? s + Math.round(a / 1e3) + 'k' : s + Math.round(a); };
function renderBar(points, payback) {
  const W = 640, H = 260, p = { t: 16, r: 10, b: 36, l: 52 }, vals = points.map(x => x.cumulative), minY = Math.min(...vals, 0), maxY = Math.max(...vals, 0), span = Math.max(1, maxY - minY);
  const cw = W - p.l - p.r, ch = H - p.t - p.b, step = cw / points.length, bw = Math.max(6, step - 3), x = i => p.l + i * step + 1, y = v => p.t + (maxY - v) / span * ch, z = y(0);
  const ticks = Array.from({ length: 5 }, (_, i) => minY + (maxY - minY) * i / 4), pi = payback == null ? null : Math.round(payback);
  $('chart').innerHTML = `<svg viewBox="0 0 ${W} ${H}" class="svg-chart" role="img" aria-label="กราฟกำไรสะสม">${ticks.map(v => `<line x1="${p.l}" y1="${y(v)}" x2="${W - p.r}" y2="${y(v)}" stroke="#e8eeec"/><text x="${p.l - 6}" y="${y(v) + 4}" text-anchor="end" class="tick">${shortMoney(v)}</text>`).join('')}<line x1="${p.l}" y1="${z}" x2="${W - p.r}" y2="${z}" stroke="#7d8f89"/>${points.map((pt, i) => { const top = Math.min(z, y(pt.cumulative)), h = Math.abs(z - y(pt.cumulative)); return `<rect x="${x(i)}" y="${top}" width="${bw}" height="${Math.max(1, h)}" rx="2" fill="${pt.cumulative >= 0 ? '#0b7a5f' : '#f0a500'}"/>${i % 5 === 0 ? `<text x="${x(i) + bw / 2}" y="${H - 14}" text-anchor="middle" class="tick">ปี ${pt.year}</text>` : ''}`; }).join('')}${pi !== null && points[pi] ? `<line x1="${x(pi) + bw / 2}" y1="${p.t}" x2="${x(pi) + bw / 2}" y2="${H - p.b}" stroke="#12231f" stroke-dasharray="4 4"/><text x="${x(pi) + bw / 2 + 4}" y="${p.t + 10}" class="tick">คืนทุน</text>` : ''}</svg>`;
}

/* ---------- โหลดสำรอง: รายการในหน้าประเมิน + หน้าจัดการ ---------- */
const apDesc = a => `${Number(a.power_w)} W${a.has_surge ? ` • Surge ×${Number(a.surge_factor)}` : ''}`;
function renderAppliances() {
  $('applianceList').innerHTML = state.appliances.length ? state.appliances.map(a => `<label class="ap-row"><span><b>${esc(a.name)}</b><small>${apDesc(a)}</small></span><input class="ap-qty" data-ap="${a.id}" type="number" min="0" value="${state.apQty[a.id] || 0}" aria-label="จำนวน ${esc(a.name)}"></label>`).join('') : '<div class="empty">ยังไม่มีรายการ เพิ่มได้ที่เมนู “โหลดสำรอง”</div>';
  $('apNote').textContent = state.apNote; $('apNote').hidden = !state.apNote;
  $('applianceAdmin').innerHTML = state.appliances.length ? `<div class="list">${state.appliances.map(a => `<div class="item"><div><b>${esc(a.name)}</b><span>${apDesc(a)}</span></div><div class="item-actions"><button class="btn small" data-ap-edit="${a.id}">แก้ไข</button><button class="btn danger small" data-ap-del="${a.id}">ลบ</button></div></div>`).join('')}</div>` : '<div class="empty">ยังไม่มีรายการ กรอกฟอร์มด้านซ้ายเพื่อเพิ่ม</div>';
}
$('applianceAdmin').onclick = async e => {
  const ed = e.target.dataset.apEdit, del = e.target.dataset.apDel;
  if (ed) { const a = state.appliances.find(x => x.id === ed); state.editAp = ed; $('applianceFormTitle').textContent = 'แก้ไขเครื่องใช้ไฟฟ้า'; $('apName').value = a.name; $('apPower').value = a.power_w; $('apSurge').checked = !!a.has_surge; $('apFactor').value = a.surge_factor || 3; $('apFactorRow').hidden = !a.has_surge; $('apName').focus(); }
  if (del && confirm('ลบรายการนี้?')) {
    if (state.apLocal) { state.appliances = state.appliances.filter(x => x.id !== del); saveLocalAp(); }
    else { const { error } = await supabase.from('backup_appliances').delete().eq('id', del); if (error) return alert(error.message); await loadAppliances(); }
    delete state.apQty[del]; renderAppliances(); calc();
  }
};
$('apSurge').onchange = () => $('apFactorRow').hidden = !$('apSurge').checked;
function resetAp() { state.editAp = null; $('applianceFormTitle').textContent = 'เพิ่มเครื่องใช้ไฟฟ้า'; $('applianceForm').reset(); $('apFactorRow').hidden = true; }
$('apCancelBtn').onclick = resetAp;
$('applianceForm').onsubmit = async e => {
  e.preventDefault();
  const row = { name: $('apName').value.trim(), power_w: num('apPower'), has_surge: $('apSurge').checked, surge_factor: $('apSurge').checked ? Math.max(1, num('apFactor')) : 1, active: true };
  if (state.apLocal) {
    if (state.editAp) Object.assign(state.appliances.find(a => a.id === state.editAp), row); else state.appliances.push({ id: 'l' + Date.now(), ...row });
    saveLocalAp();
  } else {
    const r = state.editAp ? await supabase.from('backup_appliances').update(row).eq('id', state.editAp) : await supabase.from('backup_appliances').insert(row);
    if (r.error) return alert(r.error.message); await loadAppliances();
  }
  resetAp(); renderAppliances(); calc();
};

/* ---------- ฐานข้อมูลอุปกรณ์ ---------- */
function renderEquipment() {
  $('equipmentList').innerHTML = Object.keys(CAT).map(c => { const list = state.equipment.filter(x => x.category === c); return `<h3>${CAT[c]}</h3>` + (list.length ? `<div class="list">${list.map(x => `<div class="item"><div><b>${esc(x.brand)} ${esc(x.model)}</b><span>${spec(x)} · ขาย ${money(x.sell_price)}${x.system_type ? ' · ' + x.system_type : ''}${x.is_default ? ' · แผงเริ่มต้น' : ''}</span></div><div class="item-actions">${supabase ? `<button class="btn small" data-eq-edit="${x.id}">แก้ไข</button><button class="btn danger small" data-eq-del="${x.id}">ลบ</button>` : ''}</div></div>`).join('')}</div>` : '<div class="empty">ยังไม่มีรายการ</div>'); }).join('');
}
function eqToggle() { const c = $('eqCategory').value; document.querySelectorAll('#equipmentForm [class*="f-"]').forEach(el => el.hidden = !el.classList.contains('f-' + c)); }
$('eqCategory').onchange = eqToggle;
function resetEq() { state.editEq = null; $('equipmentFormTitle').textContent = 'เพิ่มอุปกรณ์'; $('equipmentForm').reset(); eqToggle(); }
$('eqCancelBtn').onclick = resetEq;
$('equipmentList').onclick = async e => {
  const ed = e.target.dataset.eqEdit, del = e.target.dataset.eqDel;
  if (ed) { const x = state.equipment.find(i => i.id === ed); state.editEq = ed; $('equipmentFormTitle').textContent = 'แก้ไขอุปกรณ์'; $('eqCategory').value = x.category; eqToggle(); $('eqBrand').value = x.brand; $('eqModel').value = x.model; $('eqPanelWp').value = x.panel_wp || ''; $('eqPowerKw').value = x.power_kw || ''; $('eqCapacityKwh').value = x.capacity_kwh || ''; $('eqSystemType').value = x.system_type || ''; $('eqCost').value = x.cost || 0; $('eqSellPrice').value = x.sell_price || 0; $('eqIsDefault').value = x.is_default ? 'true' : 'false'; }
  if (del && confirm('ลบอุปกรณ์นี้?')) { const { error } = await supabase.from('equipment').delete().eq('id', del); if (error) alert(error.message); else loadEquipment(); }
};
$('equipmentForm').onsubmit = async e => {
  e.preventDefault(); if (!supabase) return alert('โหมดทดลองไม่สามารถบันทึกอุปกรณ์ได้ ต้องเชื่อม Supabase ก่อน');
  const c = $('eqCategory').value, n = id => $(id).value ? Number($(id).value) : null;
  const payload = { category: c, brand: $('eqBrand').value, model: $('eqModel').value, panel_wp: c === 'panel' ? n('eqPanelWp') : null, power_kw: c === 'inverter' ? n('eqPowerKw') : null, capacity_kwh: c === 'battery' ? n('eqCapacityKwh') : null, system_type: c === 'panel' ? null : ($('eqSystemType').value || null), cost: Number($('eqCost').value || 0), sell_price: Number($('eqSellPrice').value || 0), active: true, is_default: c === 'panel' && $('eqIsDefault').value === 'true' };
  if (payload.is_default) await supabase.from('equipment').update({ is_default: false }).eq('category', 'panel');
  const res = state.editEq ? await supabase.from('equipment').update(payload).eq('id', state.editEq) : await supabase.from('equipment').insert(payload);
  if (res.error) alert(res.error.message); else { resetEq(); loadEquipment(); }
};

/* ---------- ราคาติดตั้ง / ประวัติ / บันทึก ---------- */
$('pricingForm').onsubmit = async e => {
  e.preventDefault();
  const payload = { id: 1, labor_per_kwp: num('laborPerKwp'), structure_per_kwp: num('structurePerKwp'), wiring_per_kwp: num('wiringPerKwp'), transport_flat: num('transportFlat'), admin_flat: num('adminFlat'), margin_percent: num('marginPercent'), vat_percent: num('vatPercent') };
  state.pricing = normalizePricing(payload);
  if (!supabase) { alert('ใช้ราคานี้ชั่วคราวในโหมดทดลอง'); return calc(); }
  const { error } = await supabase.from('pricing_settings').upsert(payload); if (error) alert(error.message); else { alert('บันทึกราคาแล้ว'); loadPricing(); }
};
function renderHistory() {
  const list = state.assessments, sum = k => list.reduce((s, a) => s + Number(a[k] || 0), 0);
  $('histStats').innerHTML = `<div><span>จำนวนการประเมิน</span><b>${list.length}</b></div><div><span>มูลค่าโครงการรวม</span><b>${money(sum('project_price'))}</b></div><div><span>ประหยัดต่อเดือนรวม</span><b>${money(sum('monthly_saving'))}</b></div>`;
  $('historyBody').innerHTML = list.length ? list.map(a => `<tr><td>${new Date(a.created_at).toLocaleDateString('th-TH')}</td><td>${esc(a.customer_name)}<small>${esc(a.site_name || '')}</small></td><td>${esc(a.system_type || '-')}</td><td class="r">${Number(a.recommended_kwp || 0).toFixed(2)}</td><td class="r">${money(a.project_price)}</td><td class="r">${a.payback_year ? a.payback_year + ' ปี' : '-'}</td><td class="r"><button class="btn danger small" data-del="${a.id}">ลบ</button></td></tr>`).join('') : '<tr><td colspan="7"><div class="empty">ยังไม่มีประวัติการประเมิน</div></td></tr>';
}
$('historyBody').onclick = async e => { const id = e.target.dataset.del; if (!id || !supabase || !confirm('ลบรายการนี้?')) return; const { error } = await supabase.from('assessments').delete().eq('id', id); if (error) alert(error.message); else loadAssessments(); };
$('saveBtn').onclick = async () => {
  const r = state.last; if (!r) return alert('ยังไม่มีผลประเมินให้บันทึก'); if (!supabase) return alert('โหมดทดลองไม่สามารถบันทึกได้ ต้องเชื่อม Supabase ก่อน');
  const line = (x, q) => x ? { id: x.id, name: `${x.brand} ${x.model}`, qty: q, unit_price: Number(x.sell_price || 0) } : null;
  const payload = { customer_name: $('customerName').value || 'ไม่ระบุชื่อ', phone: $('phone').value, site_name: $('siteName').value, system_type: r.systemType, calc_mode: r.calcMode, monthly_kwh: r.monthlyKwh || 0, daytime_percent: num('daytimePercent'), panel_wp: Number(r.panel.panel_wp || 0), recommended_kwp: r.kwp, panel_count: r.panelQty, inverter_kw: Number(r.inverter?.power_kw || 0) * r.invQty, battery_kwh: r.battery ? Number(r.battery.capacity_kwh || 0) * r.batQty : 0, project_price: r.price.total, monthly_saving: r.saveMonth, payback_year: r.eco.payback, final_profit: r.eco.profit25, selected_panel: `${r.panel.brand} ${r.panel.model}`, selected_inverter: r.inverter ? `${r.inverter.brand} ${r.inverter.model}` : null, selected_battery: r.battery ? `${r.battery.brand} ${r.battery.model}` : null, line_items: { panel: line(r.panel, r.panelQty), inverter: line(r.inverter, r.invQty), battery: line(r.battery, r.batQty), backup: r.backup.items.map(i => ({ name: i.name, qty: i.qty, watt: i.powerW })) }, notes: $('notes').value };
  const { error } = await supabase.from('assessments').insert(payload); if (error) alert('บันทึกไม่สำเร็จ: ' + error.message); else { alert('บันทึกการประเมินแล้ว'); loadAssessments(); }
};
$('printBtn').onclick = () => print();
$('refreshHistoryBtn').onclick = loadAssessments; $('refreshEquipmentBtn').onclick = loadEquipment; $('loadPricingBtn').onclick = loadPricing;

/* ---------- เริ่มทำงาน ---------- */
$('inputs').addEventListener('input', e => { if (e.target.dataset.ap) state.apQty[e.target.dataset.ap] = Number(e.target.value || 0); calc(); });
eqToggle(); resetAp();
await Promise.all([loadEquipment(), loadAppliances(), loadAssessments(), loadPricing()]);
