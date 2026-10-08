// All local modules share the release token from index.html.
const release = new URL(import.meta.url).searchParams.get('v') || '20261009-2';
const localModule = name => new URL(name + '?v=' + encodeURIComponent(release), import.meta.url).href;
const { DEFAULT_PRICING, normalizePricing, backupFromAppliances, toCalcAppliance, designSystem, usagePlan } = await import(localModule('./calc.js'));
let supabase = null;
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
const radio = n => document.querySelector(`input[name="${n}"]:checked`)?.value;
const money = v => new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB', maximumFractionDigits: 0 }).format(Number(v || 0));
const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const uuidOrNull = v => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(v || '')) ? v : null;
const seg = (name, opts) => `<div class="seg">${opts.map(([v, l], i) => `<label><input type="radio" name="${name}" value="${v}" ${i ? '' : 'checked'}><span>${l}</span></label>`).join('')}</div>`;
const CAT = { panel: 'แผงโซลาร์', inverter: 'Inverter', battery: 'แบตเตอรี่' }, UNIT = { panel: 'แผง', inverter: 'ตัว', battery: 'ลูก' };
const spec = x => x.panel_wp ? `${x.panel_wp} Wp` : x.power_kw ? `${x.power_kw} kW` : x.capacity_kwh ? `${x.capacity_kwh} kWh` : '';

/* ---------- โครงหน้า ---------- */
$('app').innerHTML = `
<header class="top">
  <div class="brand"><span class="mark">☀</span><div><b>Solar Office Pro</b><small>Solar Sales & Sizing Suite</small></div></div>
  <nav class="nav">${[
    ['calculator','⌁','ประเมินระบบ'],
    ['history','◷','ประวัติลูกค้า'],
    ['equipment','◇','ฐานข้อมูลอุปกรณ์'],
    ['appliances','⚡','โหลดสำรอง'],
    ['pricing','฿','ราคาติดตั้ง']
  ].map(([id,icon,l],i)=>`<button data-page="${id}" class="${i?'':'active'}"><span class="nav-icon">${icon}</span><span>${l}</span></button>`).join('')}</nav>
  <span class="mode">กำลังเชื่อมต่อ • ข้อมูลตัวอย่าง ไม่ใช้เสนอราคาจริง</span>
</header>
<main>
<section id="calculator" class="page active"><div class="calc">

<div class="inputs" id="inputs">
  <section class="step"><h2>ลูกค้าและประเภทงาน</h2>
    <div class="grid3"><label>ชื่อลูกค้า<input id="customerName" placeholder="คุณสมชาย / บริษัท ABC"></label><label>เบอร์โทร<input id="phone" inputmode="tel"></label><label>สถานที่ / โครงการ<input id="siteName"></label></div>
    <div class="grid2">
      <label>ลักษณะอาคาร<select id="buildingType"><option value="home">บ้านอยู่อาศัย</option><option value="factory">โรงงาน / อุตสาหกรรม</option><option value="business">สำนักงาน / ธุรกิจ</option></select></label>
      <label>โครงสร้างระบบไฟ<select id="supplyPhase"><option value="1PH">1 เฟส</option><option value="3PH">3 เฟส</option></select><small>บ้านตั้งต้น 1 เฟส โรงงาน/ธุรกิจ 3 เฟส ปรับให้ตรงกับมิเตอร์จริงได้</small></label>
    </div>
    <div class="field"><span>ช่วงเวลาใช้ไฟหลัก</span>${seg('usagePeriod', [['day', '☀ กลางวัน'], ['night', '☾ กลางคืน'], ['both', '◐ ทั้งกลางวัน–กลางคืน']])}</div>
    <div class="period-guide">
      <p><b>☀ กลางวัน</b> = On-Grid (ไม่ต้องมีแบต) โดยทั่วไปคืนทุนเร็วสุด</p>
      <p><b>☾ กลางคืน</b> = Hybrid (แบตใหญ่) เก็บไฟไว้ใช้ตอนกลางคืน</p>
      <p><b>◐ ทั้งคู่</b> = Hybrid (แบตกลาง) ใช้ตลอดวัน + กันไฟดับตามโหลดที่เลือก</p>
      <small>ขนาดแบตจริงคำนวณจากการใช้ไฟและโหลดสำรอง ไม่ใช่ขนาดตายตัว</small>
    </div>
    <div class="grid2"><div class="field"><span>ประเภทระบบ (ปรับเองได้)</span>${seg('systemType', [['On-Grid', 'On-Grid'], ['Hybrid', 'Hybrid (มีแบตเตอรี่)']])}</div><div class="field"><span>ประเมินจาก</span>${seg('calcMode', [['usage', 'การใช้ไฟ'], ['budget', 'งบประมาณ']])}</div></div>
  </section>

  <section class="step"><h2>การใช้ไฟและงบประมาณ</h2>
    <div id="budgetRow" class="grid2" hidden><label>งบประมาณลูกค้า (บาท)<input id="budgetAmount" type="number" placeholder="เช่น 100000"></label></div>
    <div class="grid2">
      <label>หน่วยไฟต่อเดือน (kWh)<input id="monthlyKwh" type="number" placeholder="เช่น 1200"><small>เว้นว่างได้ ระบบจะประมาณจากค่าไฟ</small></label>
      <label>ค่าไฟต่อเดือน (บาท)<input id="monthlyBill" type="number" placeholder="เช่น 5000"></label>
      <label>ประเภทผู้ใช้ไฟ<select id="tariffType"><option value="residential">บ้านอยู่อาศัย</option><option value="business">ธุรกิจทั่วไป</option><option value="industrial">โรงงาน / อุตสาหกรรม</option></select></label>
      <label>ใช้ไฟช่วงกลางวัน (%)<input id="daytimePercent" type="number" min="0" max="100" placeholder="อัตโนมัติ 90%"><small id="periodAssumption"></small></label>
    </div>
    <p class="hint" id="usageNote"></p><p class="hint" id="planNote"></p>
  </section>

  <section class="step" id="backupStep" hidden><h2>โหลดสำรอง (Hybrid)</h2>
    <div class="row-between"><label class="inline">สำรองไฟนาน (ชั่วโมง)<input id="backupHours" type="number" step="0.5" min="0" placeholder="เช่น 5"></label><button type="button" class="link" data-go="appliances">จัดการรายการโหลด</button></div>
    <div id="applianceList" class="ap-list"></div>
    <div class="figures"><div><span>โหลดต่อเนื่อง</span><b id="bkCont">—</b></div><div><span>โหลดสูงสุด (Surge)</span><b id="bkSurge">—</b></div><div><span>แบตเตอรี่ที่ต้องใช้</span><b id="bkBat">—</b></div></div>
  </section>

  <section class="step equipment-step"><div class="step-head"><div><h2>อุปกรณ์ที่ติดตั้ง</h2><p class="hint">ค่าเริ่มต้นเป็น “อัตโนมัติ” ระบบจะเลือกรุ่นและจำนวนที่เหมาะสมให้ตามข้อมูลที่กรอก</p></div><div class="equipment-actions"><button type="button" class="btn btn-auto" id="autoEquipmentBtn"><span class="btn-icon">✦</span> เลือกอัตโนมัติ</button></div></div>
    ${Object.keys(CAT).map(c => `<div class="eq-row" id="row_${c}"><span class="eq-name">${CAT[c]}</span><select id="sel_${c}" aria-label="${CAT[c]}"></select><label class="qty"><input id="qty_${c}" type="number" min="0" step="1" placeholder="อัตโนมัติ" aria-label="จำนวน${CAT[c]}"><span>${UNIT[c]}</span></label></div>`).join('')}
  </section>

  <section class="step"><h2>หมายเหตุ</h2><textarea id="notes" placeholder="รายละเอียดเพิ่มเติม (ไม่บังคับ)"></textarea>
    <div class="actions"><button class="btn primary" id="saveBtn"><span class="btn-icon">✓</span> บันทึกการประเมิน</button><button class="btn btn-soft" id="printBtn"><span class="btn-icon">▣</span> พิมพ์ / PDF</button></div></section>
</div>

<aside class="result" id="result">
  <div id="resultEmpty" class="empty" hidden></div>
  <div id="resultBody">
    <div class="headline"><span>ราคาโครงการรวม (รวม VAT)</span><b id="rTotal">—</b><small id="rSystem">—</small></div>
    <section class="overview-panel">
      <div class="overview-title">สรุปภาพรวมระบบ <span id="overviewCustomer">—</span></div>
      <div class="overview-grid">
        <div class="overview-card"><b id="ovSystem">—</b><span>ขนาดระบบโซลาร์เซลล์</span></div>
        <div class="overview-card"><b id="ovBattery">—</b><span>แบตเตอรี่สำรอง</span></div>
        <div class="overview-card"><b id="ovGeneration">—</b><span>พลังงานผลิตได้ต่อปี</span></div>
        <div class="overview-card"><b id="ovSavingPct">—</b><span>ลดค่าไฟโดยประมาณ</span></div>
      </div>
    </section>
    <div class="trio"><div><span>ประหยัดค่าไฟ / เดือน</span><b id="rSave">—</b></div><div><span>คืนทุน</span><b id="rPay">—</b></div><div><span>กำไรสุทธิ 25 ปี</span><b id="rProfit">—</b></div></div>
    <section class="panel savings-panel"><h3>ค่าไฟฟ้าที่ประหยัดได้</h3><div class="savings-grid"><div><span>ค่าไฟปัจจุบัน/เดือน</span><b id="svBill">—</b></div><div><span>ประหยัด/เดือน</span><b id="svMonth">—</b></div><div><span>ประหยัด/ปี</span><b id="svYear">—</b></div><div><span>ค่าไฟคงเหลือโดยประมาณ</span><b id="svRemain">—</b></div></div></section>
    <div id="rWarn"></div>
    <section class="panel"><h3>อุปกรณ์และค่าใช้จ่าย</h3><div class="table-wrap"><table class="cost"><thead><tr><th>รายการ</th><th class="r">จำนวน</th><th class="r">จำนวนเงิน</th></tr></thead><tbody id="rCost"></tbody></table></div></section>
    <section class="panel"><h3>การผลิตไฟฟ้า</h3><dl class="specs" id="rGen"></dl></section>
    <section class="panel"><h3>ความคุ้มค่าและเงินประหยัดสะสม</h3><dl class="specs" id="rEco"></dl><div class="chart-wrap" id="chart"></div><div id="chartTooltip" class="chart-tooltip" role="tooltip" hidden></div><div class="table-wrap annual-wrap"><table class="cost annual-table"><caption>เงินประหยัดและกระแสเงินสดรายปี (บาท)</caption><thead><tr><th>ปี</th><th class="r">ประหยัดค่าไฟ</th><th class="r">บำรุงรักษา</th><th class="r">กระแสเงินสดสุทธิ</th><th class="r">ประหยัดสุทธิสะสม</th><th class="r">สุทธิหลังหักลงทุน</th></tr></thead><tbody id="annualBody"></tbody></table></div><p class="hint">ประมาณการตามสมมติฐานเดิม 25 ปี ยังไม่รวมค่าเปลี่ยนแบตเตอรี่/อินเวอร์เตอร์ในอนาคต</p></section>
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
    <label class="f-inverter">เฟส<select id="eqPhase"><option value="">ไม่ระบุ</option><option value="1PH">1 Phase</option><option value="3PH">3 Phase</option></select></label>
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
    <div class="grid2"><label>ลำดับแสดงผล<input id="apSort" type="number" min="0" value="0"></label><label class="check align-end"><input id="apActive" type="checkbox" checked><span>เปิดแสดงในหน้าประเมิน</span></label></div>
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
  { id: 'i1', category: 'inverter', brand: 'Demo Inverter', model: '6K On Grid', power_kw: 6, phase: '1PH', cost: 22000, sell_price: 28000, active: true, system_type: 'On-Grid' },
  { id: 'i2', category: 'inverter', brand: 'Demo Inverter', model: '10K Hybrid', power_kw: 10, phase: '1PH', cost: 35000, sell_price: 45000, active: true, system_type: 'Hybrid' },
  { id: 'b1', category: 'battery', brand: 'Demo Battery', model: '10kWh LFP', capacity_kwh: 10, cost: 65000, sell_price: 82000, active: true, system_type: 'Hybrid' },
  { id: 'b2', category: 'battery', brand: 'Demo Battery', model: '15kWh LFP', capacity_kwh: 15, cost: 82000, sell_price: 99000, active: true, system_type: 'Hybrid' }];
async function loadEquipment() {
  if (!supabase) state.equipment = demoEquipment();
  else { const { data, error } = await supabase.from('equipment').select('*').order('category').order('brand'); demoMode = !!error; state.equipment = error ? demoEquipment() : (data || []); dataStatus('equipment', error); }
  renderEquipment(); lastSys = null; calc();
}
async function loadAssessments() {
  if (supabase) { const { data, error } = await supabase.from('assessments').select('*').order('created_at', { ascending: false }); state.assessments = error ? [] : (data || []); dataStatus('assessments', error); }
  renderHistory();
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
  renderAppliances();
  calc();
}

/* ---------- ตัวเลือกอุปกรณ์ ---------- */
let lastSys = null;
function fillSelects() {
  const sys = radio('systemType');
  for (const c of Object.keys(CAT)) {
    const el = $('sel_' + c), keep = el.value;
    const list = state.equipment.filter(x => x.category === c && x.active !== false && (c === 'panel' || !x.system_type || x.system_type === sys) && (c !== 'inverter' || x.phase === $('supplyPhase').value));
    el.innerHTML = '<option value="">อัตโนมัติ</option>' + list.map(x => `<option value="${x.id}">${esc(x.brand)} ${esc(x.model)} · ${spec(x)} · ${money(x.sell_price)}</option>`).join('');
    el.value = list.some(x => x.id === keep) ? keep : '';
  }
}

/* ---------- คำนวณและแสดงผล ---------- */
function calc() {
  const sys = radio('systemType'), mode = radio('calcMode');
  $('budgetRow').hidden = mode !== 'budget'; $('backupStep').hidden = sys !== 'Hybrid'; $('row_battery').hidden = sys !== 'Hybrid';
  const selectKey = sys + ':' + $('supplyPhase').value;
  if (selectKey !== lastSys) { lastSys = selectKey; fillSelects(); }
  const rawBackup = sys === 'Hybrid' ? backupFromAppliances(state.apQty, num('backupHours'), state.appliances.filter(a => a.active !== false).map(toCalcAppliance)) : { continuousKw: 0, surgeKw: 0, usableKwh: 0, batteryKwh: 0, items: [] };
  const usage = { monthlyKwh: $('monthlyKwh').value, monthlyBill: $('monthlyBill').value, tariffType: $('tariffType').value, daytimePercent: $('daytimePercent').value, period: radio('usagePeriod'), phase: $('supplyPhase').value };
  const plan = usagePlan(usage, sys, rawBackup);
  const backup = plan.backup;
  $('periodAssumption').textContent = 'เว้นว่างใช้สมมติฐาน: กลางวัน 90% / กลางคืน 10% / ทั้งคู่ 50% ปรับตามการใช้จริงได้';
  $('daytimePercent').placeholder = 'อัตโนมัติ ' + plan.defaultDayPercent + '%';
  $('planNote').textContent = 'กลางวัน ' + plan.dayPercent + '% • กลางคืน ' + (100-plan.dayPercent) + '% • ใช้กลางคืนประมาณ ' + plan.nightDaily.toFixed(1) + ' kWh/วัน • แบตเป้าหมาย ' + backup.batteryKwh.toFixed(1) + ' kWh (ใช้ค่ามากกว่าระหว่างกลางคืนกับโหลดสำรอง)';
  $('bkCont').textContent = backup.continuousKw ? backup.continuousKw.toFixed(2) + ' kW' : '—';
  $('bkSurge').textContent = backup.surgeKw ? backup.surgeKw.toFixed(2) + ' kW' : '—';
  $('bkBat').textContent = backup.batteryKwh ? backup.batteryKwh.toFixed(1) + ' kWh' : '—';

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
  const phase = r.phase === '3PH' ? '3 เฟส' : '1 เฟส';
  const batKwh = r.battery ? (r.batQty * Number(r.battery.capacity_kwh || 0)) : 0;
  const bill = num('monthlyBill');
  const remain = Math.max(0, bill - r.saveMonth);
  const savingPct = bill > 0 ? Math.min(100, (r.saveMonth / bill) * 100) : 0;
  $('rSystem').textContent = `${sys} · ${r.kwp.toFixed(2)} kWp${r.battery ? ` · แบตเตอรี่ ${batKwh.toFixed(1)} kWh` : ''}`;
  $('overviewCustomer').textContent = $('customerName').value ? `— ${$('customerName').value}` : '';
  $('ovSystem').innerHTML = `${r.kwp.toFixed(2)} kWp.<br>${phase}`;
  $('ovBattery').textContent = sys === 'Hybrid' ? `${batKwh.toFixed(1)} kWh` : 'ไม่ใช้';
  $('ovGeneration').textContent = `${Math.round(r.genYear).toLocaleString('th-TH')} kWh`;
  $('ovSavingPct').textContent = bill > 0 ? `~${savingPct.toFixed(0)}%` : '—';
  $('rSave').textContent = money(r.saveMonth); $('rPay').textContent = pay; $('rProfit').textContent = money(r.eco.profit25);
  $('svBill').textContent = bill > 0 ? money(bill) : '—';
  $('svMonth').textContent = money(r.saveMonth);
  $('svYear').textContent = money(r.saveYear);
  $('svRemain').textContent = bill > 0 ? money(remain) : '—';
  $('rWarn').innerHTML = r.warnings.map(w => `<p class="warn">${esc(w)}</p>`).join('');
  const eq = (k, x, q, tot) => x ? `<tr><td>${CAT[k]}: ${esc(x.brand)} ${esc(x.model)} <span class="tag ${r.manual[k] ? 'on' : ''}">${r.manual[k] ? 'เลือกเอง' : 'อัตโนมัติ'}</span><small>${spec(x)} · ${money(x.sell_price)} / ${UNIT[k]}</small></td><td class="r">${q} ${UNIT[k]}</td><td class="r">${money(tot)}</td></tr>` : '';
  const row = (l, t, cls = '') => `<tr class="${cls}"><td>${l}</td><td></td><td class="r">${money(t)}</td></tr>`;
  $('rCost').innerHTML = eq('panel', r.panel, r.panelQty, p.panelTotal) + eq('inverter', r.inverter, r.invQty, p.inverterTotal) + eq('battery', r.battery, r.batQty, p.batteryTotal)
    + row('รวมค่าอุปกรณ์', p.equipment, 'sub') + row('ค่าแรงติดตั้ง', p.labor) + row('โครงสร้างและราง', p.structure) + row('สายไฟและอุปกรณ์ประกอบ', p.wiring) + row('ค่าขนส่ง', p.transport) + row('ค่าดำเนินการ', p.admin)
    + row('Margin', p.margin) + row('VAT', p.vat) + row('รวมทั้งสิ้น', p.total, 'total');
  const dl = rows => rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
  $('rGen').innerHTML = dl([['ผลิตต่อวัน', `${r.genDay.toFixed(1)} kWh`], ['ผลิตต่อเดือน', `${r.genMonth.toFixed(0)} kWh`], ['ผลิตต่อปี (ปีแรก)', `${r.genYear.toFixed(0)} kWh`], ['ใช้เองได้', `${(r.ratio * 100).toFixed(0)}% ของที่ผลิต`]]);
  $('rEco').innerHTML = dl([['ประหยัดปีแรก', money(r.saveYear)], ['IRR', r.eco.irr == null ? '—' : r.eco.irr.toFixed(1) + '%'], ['NPV 25 ปี', money(r.eco.npv)], ['ลด CO₂', `${r.co2.toFixed(1)} ตัน/ปี`]]);
  renderBar(r.eco.points, r.eco.payback, p.total, r.cashflowRows);
}
const shortMoney = v => { const a = Math.abs(v), s = v < 0 ? '-' : ''; return a >= 1e6 ? s + (a / 1e6).toFixed(1) + 'ล.' : a >= 1e3 ? s + Math.round(a / 1e3) + 'k' : s + Math.round(a); };
function renderBar(points, payback, investment, rows) {
  const W=640,H=270,p={t:20,r:10,b:40,l:56};
  const savings=rows.map(row=>({year:row.year,value:Math.max(0,row.accumulated)}));
  const maxY=Math.max(investment,...savings.map(x=>x.value),1),cw=W-p.l-p.r,ch=H-p.t-p.b,step=cw/savings.length,bw=Math.max(6,step-3);
  const x=i=>p.l+i*step+1,y=v=>p.t+(maxY-v)/maxY*ch;
  const detail=row=>`ปี ${row.year}\nประหยัดค่าไฟ: ${money(row.saving)}\nบำรุงรักษา: ${money(row.maintenance)}\nกระแสเงินสดสุทธิ: ${money(row.net)}\nประหยัดสุทธิสะสม: ${money(row.accumulated)}\nสุทธิหลังหักลงทุน: ${money(row.cumulative)}`;
  $('chartTooltip').hidden=true;
  $('chart').innerHTML=`<div class="chart-legend"><span><i class="legend-save"></i>ประหยัดสุทธิสะสม (หักบำรุงรักษา)</span><span><i class="legend-invest"></i>เงินลงทุน</span></div><p class="hint">ชี้เมาส์ แตะแท่งกราฟ หรือใช้ Tab เพื่อดูรายละเอียดรายปี</p><svg viewBox="0 0 ${W} ${H}" class="svg-chart" role="group" aria-label="เงินประหยัดสะสมเทียบเงินลงทุน">${Array.from({length:5},(_,i)=>maxY*i/4).map(v=>`<line x1="${p.l}" y1="${y(v)}" x2="${W-p.r}" y2="${y(v)}" stroke="#e8eeec"/><text x="${p.l-6}" y="${y(v)+4}" text-anchor="end" class="tick">${shortMoney(v)}</text>`).join('')}<line x1="${p.l}" y1="${y(investment)}" x2="${W-p.r}" y2="${y(investment)}" stroke="#d7a63e" stroke-width="2" stroke-dasharray="6 4"/>${savings.map((pt,i)=>`<rect class="chart-bar" data-year="${i}" tabindex="0" role="img" aria-label="${esc(detail(rows[i]))}" x="${x(i)}" y="${y(pt.value)}" width="${bw}" height="${Math.max(2,y(0)-y(pt.value))}" rx="2" fill="${pt.value>=investment?'#0b7a5f':'#39aabf'}"><title>${esc(detail(rows[i]))}</title></rect>${i%5===0?`<text x="${x(i)+bw/2}" y="${H-14}" text-anchor="middle" class="tick">ปี ${pt.year}</text>`:''}`).join('')}</svg>`;
  $('annualBody').innerHTML=rows.map(row=>`<tr class="${row.year>0&&row.cumulative>=0?'break-even':''}"><td>${row.year===0?'0 (ลงทุน)':row.year}</td><td class="r">${money(row.saving)}</td><td class="r">${money(row.maintenance)}</td><td class="r">${money(row.net)}</td><td class="r">${money(row.accumulated)}</td><td class="r">${money(row.cumulative)}</td></tr>`).join('');
  const show=event=>{
    const bar=event.target.closest?.('[data-year]');if(!bar)return;
    const tooltip=$('chartTooltip'),row=rows[Number(bar.dataset.year)];
    tooltip.textContent=detail(row);tooltip.style.whiteSpace='pre-line';tooltip.hidden=false;
    const rect=bar.getBoundingClientRect(),left=event.clientX||rect.left,top=event.clientY||rect.top;
    tooltip.style.left=Math.max(8,Math.min(left+14,innerWidth-tooltip.offsetWidth-8))+'px';
    tooltip.style.top=Math.max(8,Math.min(top+14,innerHeight-tooltip.offsetHeight-8))+'px';
  };
  $('chart').onpointerover=show;$('chart').onpointermove=show;$('chart').onclick=show;
  $('chart').querySelectorAll('.chart-bar').forEach(bar => {
    bar.addEventListener('focus', () => show({target:bar}));
    bar.addEventListener('blur', () => $('chartTooltip').hidden=true);
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
    const a = state.appliances.find(x => x.id === toggle); if (!a) return;
    const active = a.active === false;
    if (!supabase) return alert('ต้องเชื่อมต่อ Supabase ก่อน');
    const { error } = await supabase.from('backup_appliances').update({ active }).eq('id', toggle);
    if (error) return alert(error.message);
    await loadAppliances();
  }
  if (del && confirm('ลบรายการนี้?')) {
    if (!supabase) return alert('ต้องเชื่อมต่อ Supabase ก่อน');
    const { error } = await supabase.from('backup_appliances').delete().eq('id', del);
    if (error) return alert(error.message);
    await loadAppliances();
    delete state.apQty[del]; renderAppliances(); calc();
  }
};
$('apSurge').onchange = () => $('apFactorRow').hidden = !$('apSurge').checked;
function resetAp() { state.editAp = null; $('applianceFormTitle').textContent = 'เพิ่มเครื่องใช้ไฟฟ้า'; $('applianceForm').reset(); $('apFactorRow').hidden = true; $('apActive').checked = true; $('apSort').value = 0; }
$('apCancelBtn').onclick = resetAp;
$('applianceForm').onsubmit = async e => {
  e.preventDefault();
  const row = { name: $('apName').value.trim(), power_w: num('apPower'), has_surge: $('apSurge').checked, surge_factor: $('apSurge').checked ? Math.max(1, num('apFactor')) : 1, sort_order: Math.max(0, num('apSort')), active: $('apActive').checked };
  if (!supabase) return alert('ต้องเชื่อมต่อ Supabase ก่อน');
  const r = state.editAp
    ? await supabase.from('backup_appliances').update(row).eq('id', state.editAp)
    : await supabase.from('backup_appliances').insert(row);
  if (r.error) return alert(r.error.message);
  await loadAppliances();
  resetAp(); renderAppliances(); calc();
};

/* ---------- ฐานข้อมูลอุปกรณ์ ---------- */
function renderEquipment() {
  $('equipmentList').innerHTML = Object.keys(CAT).map(c => { const list = state.equipment.filter(x => x.category === c); return `<h3>${CAT[c]}</h3>` + (list.length ? `<div class="list">${list.map(x => `<div class="item"><div><b>${esc(x.brand)} ${esc(x.model)}</b><span>${spec(x)} · ขาย ${money(x.sell_price)}${x.system_type ? ' · ' + x.system_type : ''}${x.phase ? ' · ' + x.phase : ''}${x.is_default ? ' · แผงเริ่มต้น' : ''}</span></div><div class="item-actions">${supabase ? `<button class="btn small" data-eq-edit="${x.id}">แก้ไข</button><button class="btn danger small" data-eq-del="${x.id}">ลบ</button>` : ''}</div></div>`).join('')}</div>` : '<div class="empty">ยังไม่มีรายการ</div>'); }).join('');
}
function eqToggle() { const c = $('eqCategory').value; document.querySelectorAll('#equipmentForm [class*="f-"]').forEach(el => el.hidden = !el.classList.contains('f-' + c)); }
$('eqCategory').onchange = eqToggle;
function resetEq() { state.editEq = null; $('equipmentFormTitle').textContent = 'เพิ่มอุปกรณ์'; $('equipmentForm').reset(); eqToggle(); }
$('eqCancelBtn').onclick = resetEq;
$('equipmentList').onclick = async e => {
  const ed = e.target.dataset.eqEdit, del = e.target.dataset.eqDel;
  if (ed) { const x = state.equipment.find(i => i.id === ed); state.editEq = ed; $('equipmentFormTitle').textContent = 'แก้ไขอุปกรณ์'; $('eqCategory').value = x.category; eqToggle(); $('eqBrand').value = x.brand; $('eqModel').value = x.model; $('eqPanelWp').value = x.panel_wp || ''; $('eqPowerKw').value = x.power_kw || ''; $('eqCapacityKwh').value = x.capacity_kwh || ''; $('eqSystemType').value = x.system_type || ''; $('eqPhase').value = x.phase || ''; $('eqCost').value = x.cost || 0; $('eqSellPrice').value = x.sell_price || 0; $('eqIsDefault').value = x.is_default ? 'true' : 'false'; }
  if (del && confirm('ลบอุปกรณ์นี้?')) { const { error } = await supabase.from('equipment').delete().eq('id', del); if (error) alert(error.message); else loadEquipment(); }
};
$('equipmentForm').onsubmit = async e => {
  e.preventDefault(); if (!supabase) return alert('โหมดทดลองไม่สามารถบันทึกอุปกรณ์ได้ ต้องเชื่อม Supabase ก่อน');
  const c = $('eqCategory').value, n = id => $(id).value ? Number($(id).value) : null;
  const payload = { category: c, brand: $('eqBrand').value, model: $('eqModel').value, panel_wp: c === 'panel' ? n('eqPanelWp') : null, power_kw: c === 'inverter' ? n('eqPowerKw') : null, capacity_kwh: c === 'battery' ? n('eqCapacityKwh') : null, system_type: c === 'panel' ? null : ($('eqSystemType').value || null), phase: c === 'inverter' ? ($('eqPhase').value || null) : null, cost: Number($('eqCost').value || 0), sell_price: Number($('eqSellPrice').value || 0), active: true, is_default: c === 'panel' && $('eqIsDefault').value === 'true' };
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
  if (demoMode) return alert('กำลังใช้อุปกรณ์ตัวอย่าง ไม่สามารถบันทึกเป็นการประเมินจริงได้');
  const r = state.last; if (!r) return alert('ยังไม่มีผลประเมินให้บันทึก'); if (!supabase) return alert('โหมดทดลองไม่สามารถบันทึกได้ ต้องเชื่อม Supabase ก่อน');
  const line = (x, q) => x ? { id: x.id, name: `${x.brand} ${x.model}`, qty: q, unit_price: Number(x.sell_price || 0) } : null;
  const payload = { customer_name: $('customerName').value || 'ไม่ระบุชื่อ', phone: $('phone').value, site_name: $('siteName').value, system_type: r.systemType, calc_mode: r.calcMode, monthly_kwh: r.monthlyKwh || 0, monthly_bill: num('monthlyBill'), daytime_percent: r.dayPercent, panel_wp: Number(r.panel.panel_wp || 0), recommended_kwp: r.kwp, panel_count: r.panelQty, inverter_kw: Number(r.inverter?.power_kw || 0) * r.invQty, battery_kwh: r.battery ? Number(r.battery.capacity_kwh || 0) * r.batQty : 0, project_price: r.price.total, monthly_saving: r.saveMonth, annual_saving: r.saveYear, saving_percent: num('monthlyBill') > 0 ? Math.min(100, r.saveMonth / num('monthlyBill') * 100) : 0, payback_year: r.eco.payback, final_profit: r.eco.profit25, selected_panel: `${r.panel.brand} ${r.panel.model}`, selected_inverter: r.inverter ? `${r.inverter.brand} ${r.inverter.model}` : null, selected_battery: r.battery ? `${r.battery.brand} ${r.battery.model}` : null, line_items: { design_inputs: { building: $('buildingType').value, phase: r.phase, usage_period: radio('usagePeriod'), daytime_percent: r.dayPercent, night_daily_kwh: r.nightDaily, battery_target_kwh: r.backup.batteryKwh }, panel: line(r.panel, r.panelQty), inverter: line(r.inverter, r.invQty), battery: line(r.battery, r.batQty), backup: r.backup.items.map(i => ({ appliance_id: i.id, name: i.name, qty: i.qty, watt: i.powerW })) }, notes: $('notes').value };
  const { data: saved, error } = await supabase.from('assessments').insert(payload).select('id').single();
  if (error) return alert('บันทึกไม่สำเร็จ: ' + error.message);
  const eqRows = [r.panel && { assessment_id: saved.id, equipment_id: uuidOrNull(r.panel.id), category: 'panel', qty: r.panelQty, unit_price: Number(r.panel.sell_price || 0) }, r.inverter && { assessment_id: saved.id, equipment_id: uuidOrNull(r.inverter.id), category: 'inverter', qty: r.invQty, unit_price: Number(r.inverter.sell_price || 0) }, r.battery && { assessment_id: saved.id, equipment_id: uuidOrNull(r.battery.id), category: 'battery', qty: r.batQty, unit_price: Number(r.battery.sell_price || 0) }].filter(Boolean);
  if (eqRows.length) { const { error: eqErr } = await supabase.from('assessment_equipment').insert(eqRows); if (eqErr) console.warn('บันทึกรายการอุปกรณ์ย่อยไม่สำเร็จ', eqErr); }
  const backupRows = r.backup.items.map(i => ({ assessment_id: saved.id, appliance_id: uuidOrNull(i.id), appliance_name: i.name, qty: i.qty, power_w: i.powerW, startup_w: i.startW }));
  if (backupRows.length) { const { error: bkErr } = await supabase.from('assessment_backup_loads').insert(backupRows); if (bkErr) console.warn('บันทึก snapshot โหลดสำรองไม่สำเร็จ', bkErr); }
  alert('บันทึกการประเมินแล้ว'); loadAssessments();
};
$('printBtn').onclick = () => print();
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
  const building = $('buildingType').value;
  $('supplyPhase').value = building === 'home' ? '1PH' : '3PH';
  $('tariffType').value = building === 'home' ? 'residential' : building === 'factory' ? 'industrial' : 'business';
  lastSys = null; calc();
};
document.querySelectorAll('input[name="usagePeriod"]').forEach(input => input.onchange = () => {
  const system = radio('usagePeriod') === 'day' ? 'On-Grid' : 'Hybrid';
  document.querySelector('input[name="systemType"][value="' + system + '"]').checked = true;
  lastSys = null; calc();
});
$('inputs').addEventListener('input', e => { if (e.target.dataset.ap) state.apQty[e.target.dataset.ap] = Number(e.target.value || 0); calc(); });
eqToggle(); resetAp();
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
    supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { global: { fetch: boundedFetch } });
  } catch (error) {
    console.warn('เปิดโหมดจำกัด', error);
    setConnection('โหมดจำกัด • อุปกรณ์ตัวอย่าง ไม่ใช้เสนอราคาจริง • ไม่สามารถบันทึกได้ (' + error.message + ')');
    return;
  }
  setConnection('กำลังโหลดข้อมูล Supabase • ยังใช้อุปกรณ์ตัวอย่าง');
  const loaders = [loadEquipment, loadAppliances, loadAssessments, loadPricing];
  const results = await Promise.allSettled(loaders.map(load => load()));
  results.forEach((result, i) => {
    if (result.status === 'rejected') {
      dataStatus(['equipment', 'backup_appliances', 'assessments', 'pricing_settings'][i], result.reason);
      console.error('Data load failed', result.reason);
      window.solarBoot?.showError(result.reason);
    }
  });
}
