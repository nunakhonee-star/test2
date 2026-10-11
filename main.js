// All local modules share the release token from index.html.
const release = new URL(import.meta.url).searchParams.get('v') || '20261012-3';
const localModule = name => new URL(name + '?v=' + encodeURIComponent(release), import.meta.url).href;
const { DEFAULT_PRICING, normalizePricing, backupFromAppliances, toCalcAppliance, designSystem, usagePlan, OFFICIAL_FT, OFFICIAL_RESIDENTIAL, officialFtForMonth, compareDesigns, DEFAULTS, BILL_RATES, PERIOD_DEFAULTS } = await import(localModule('./calc.js'));
const {settingsMarkup,mountSettings} = await import(localModule('./settings.js'));

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
        <button type="button" disabled class="finance-card payback dashboard-detail" data-detail="rPay"><span>จุดคุ้มทุนครั้งแรกโดยประมาณ</span><b id="rPay">—</b><small>ประหยัดสุทธิสะสมเท่ากับเงินลงทุน</small><span class="detail-link">ดูรายละเอียด ↗</span></button>
        <button type="button" disabled class="finance-card accumulated dashboard-detail" data-detail="finAccumulated"><span>ประหยัดสุทธิสะสม 25 ปี</span><b id="finAccumulated">—</b><small>หักค่าดูแล/เปลี่ยนอุปกรณ์แล้ว ยังไม่หักทุน</small><span class="detail-link">ดูรายละเอียด ↗</span></button>
        <button type="button" disabled class="finance-card profit dashboard-detail" data-detail="rProfit"><span>สุทธิหลังหักเงินลงทุน 25 ปี</span><b id="rProfit">—</b><small>ประหยัดสุทธิสะสม − เงินลงทุนเริ่มต้น</small><span class="detail-link">ดูรายละเอียด ↗</span></button>
      </div>
      <p class="finance-story" id="finNarrative"></p>
    </section>
    <section class="panel savings-panel"><h3>ค่าไฟฟ้าที่ประหยัดได้</h3><div class="savings-grid"><div><span id="svBillLabel">ค่าไฟปัจจุบัน/เดือน</span><b id="svBill">—</b></div><div><span>ประหยัด/เดือน</span><b id="svMonth">—</b></div><div><span>ประหยัด/ปี</span><b id="svYear">—</b></div><div><span>ค่าไฟคงเหลือโดยประมาณ</span><b id="svRemain">—</b></div></div></section>
    <section class="panel"><h3>เปรียบเทียบขนาดแผงและส่วนเพิ่ม Hybrid</h3><p class="hint">เทียบประมาณ 80%, 100%, 120% ของจำนวนแผงปัจจุบันภายใต้สมมติฐานเดียวกัน ไม่ใช่ผลออกแบบที่ยืนยันว่าเหมาะที่สุด ขนาดและจำนวนเครื่องเปลี่ยนตามอุปกรณ์ที่มี</p><div class="table-wrap"><table class="cost"><thead><tr><th>แผง / kWp</th><th class="r">เงินลงทุน</th><th class="r">ประหยัด/ปี</th><th class="r">คืนทุน</th><th class="r">NPV 25 ปี</th></tr></thead><tbody id="systemComparison"></tbody></table></div><p id="batteryComparison" class="hint"></p></section>
    <section class="panel"><h3>เส้นทางคืนทุนและเงินประหยัดสะสม</h3><div class="chart-wrap" id="chart"></div><div id="chartTooltip" class="chart-tooltip" role="tooltip" hidden></div><div class="table-wrap annual-wrap"><table class="cost annual-table"><caption>รายละเอียดเงินลงทุนและเงินประหยัดรายปี (บาท)</caption><thead><tr><th>ปี</th><th class="r">ประหยัดค่าไฟ</th><th class="r">ขายไฟตามสัญญา</th><th class="r">บำรุงรักษา</th><th class="r">เปลี่ยนอุปกรณ์</th><th class="r">กระแสเงินสดสุทธิ</th><th class="r">ประหยัดสุทธิสะสม</th><th class="r">สุทธิหลังหักลงทุน</th></tr></thead><tbody id="annualBody"></tbody></table></div><details class="financial-details"><summary>ดูตัวชี้วัดเพิ่มเติม: ROI / IRR / NPV / CO₂</summary><dl class="specs" id="rEco"></dl></details><p class="hint">ประมาณการ 25 ปี รวมค่าเปลี่ยนอุปกรณ์เฉพาะรายการที่ระบุในหน้าตั้งค่า</p></section>
    <section class="panel"><h3>รายละเอียดชุดอุปกรณ์และเงินลงทุน</h3><div class="table-wrap"><table class="cost"><thead><tr><th>รายการ</th><th class="r">จำนวน</th><th class="r">จำนวนเงิน</th></tr></thead><tbody id="rCost"></tbody></table></div></section>
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
    const list = state.equipment.filter(x => x.category === c && x.active !== false && (c === 'panel' || !x.system_type || x.system_type === sys) && (c !== 'inverter' || x.phase === $('supplyPhase').value));
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
    ? 'ลงทุน ' + money(p.total) + ' → คาดว่าคุ้มทุนใน ' + pay + ' → เมื่อครบ 25 ปี ประหยัดสุทธิสะสม ' + money(accumulated) + ' หักเงินลงทุนแล้วเหลือ ' + money(r.eco.profit25)
    : 'ลงทุน ' + money(p.total) + ' → เงินประหยัดสุทธิสะสมยังไม่ถึงเงินลงทุนภายใน 25 ปี → สุทธิหลังหักเงินลงทุน ' + money(r.eco.profit25);
  $('finNarrative').textContent += ' (ประมาณการจากแบบจำลองวันตัวอย่าง ไม่ใช่ผลวัดจริง ค่าเปลี่ยนอุปกรณ์ตามที่ตั้งไว้)';
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
  const dl = rows => rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
  $('rGen').innerHTML = dl([['ผลิตต่อวัน', `${r.genDay.toFixed(1)} kWh`], ['ผลิตต่อเดือน', `${r.genMonth.toFixed(0)} kWh`], ['ผลิตต่อปี (ปีแรก)', `${r.genYear.toFixed(0)} kWh`], ['ใช้เองได้', `${(r.ratio * 100).toFixed(0)}% ของที่ผลิต`]]);
  $('rEco').innerHTML = dl([['ประหยัดปีแรก', money(r.saveYear)], ['ROI สุทธิ 25 ปี',r.eco.roi==null?'—':r.eco.roi.toFixed(1)+'%'],['รายได้ขายไฟปีแรก (แยกจากลดบิล)',money(r.exportRevenueYear1)],['IRR', r.eco.irr == null ? '—' : r.eco.irr.toFixed(1) + '%'], ['NPV 25 ปี', money(r.eco.npv)], ['ลด CO₂', 'ยังไม่ยืนยันตัวคูณการปล่อยที่ใช้กับโครงการ']]);
  renderBar(r.eco.points, r.eco.payback, p.total, r.cashflowRows);
  document.querySelectorAll('.dashboard-detail').forEach(b=>{b.disabled=false;if(!matchMedia('(prefers-reduced-motion: reduce)').matches){b.getAnimations().forEach(a=>a.cancel());b.animate([{opacity:.65,transform:'translateY(5px)'},{opacity:1,transform:'translateY(0)'}],{duration:350,easing:'ease-out'});}});
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
 const r=state.last;if(!r)return;
 const name=x=>x?[x.brand,x.model].filter(Boolean).join(' '):'ไม่มี';
 const nominal=r.battery?r.batQty*Number(r.battery.capacity_kwh):0;
 const items={
 ovSystem:['ขนาดระบบตามอุปกรณ์จริง','rCost',[
 ['แผงที่เลือก',name(r.panel)],['กำลังต่อแผง',r.panel.panel_wp+' Wp'],['จำนวนแผง',r.panelQty+' แผง'],['พื้นที่หลังคาประเมิน',r.roof.roofArea.toFixed(1)+' ตร.ม. รวมเผื่อจัดวาง'],['สูตรพื้นที่','จำนวนแผง × พื้นที่แผงประมาณ × ตัวคูณเผื่อทางเดิน; ต้องตรวจขนาดจริงและระยะร่นหลังสำรวจ'],['กำลังติดตั้ง DC',r.kwp.toFixed(2)+' kWp = Wp ต่อแผง × จำนวน ÷ 1,000'],['อินเวอร์เตอร์',name(r.inverter)+' × '+r.invQty],['กำลังอินเวอร์เตอร์รวม AC',(Number(r.inverter?.power_kw||0)*r.invQty).toFixed(2)+' kW'],['เหตุผลจำนวนเครื่อง','เป้าหมายกำลัง = มากกว่าระหว่างแผง ÷ 1.15, โหลดสำรอง × 1.25 และ surge จากนั้นหารกำลังเครื่องและปัดขึ้น; 1.15 และ 1.25 เป็นสมมติฐาน ไม่ใช่ข้อกำหนดผู้ผลิต'],['หมายเหตุ','kWp เป็นกำลังพิกัด ไม่ใช่พลังงานที่ผลิตได้ตลอดเวลา']]],
 ovBattery:['ความต้องการและชุดแบตเตอรี่','backupStep',[
 ['วิธีเลือกความจุ',r.backup.source==='backup-loads'?'จากอุปกรณ์และชั่วโมงสำรองที่กรอก':'อัตโนมัติจากการใช้ไฟกลางคืน'],['ความจุที่แนะนำ',r.backup.batteryKwh.toFixed(1)+' kWh'],['โหลดสำรองต่อเนื่อง',r.backup.continuousKw.toFixed(2)+' kW'],['ชั่วโมงสำรอง',num('backupHours')+' ชั่วโมง'],['พลังงานที่โหลดต้องใช้',r.backup.usableKwh.toFixed(2)+' kWh'],['ความจุพิกัดที่ต้องใช้จากโหลดสำรอง',r.backupRequiredKwh.toFixed(2)+' kWh'],['สูตร','โหลด kW × ชั่วโมง ÷ (สัดส่วนความจุที่ใช้ได้ × ประสิทธิภาพจ่ายไฟ) × ตัวคูณเผื่อ'],['สมมติฐานแบต','ใช้ได้ '+(DEFAULTS.batteryDod*100).toFixed(1)+'% • ประสิทธิภาพถึงโหลด '+(DEFAULTS.batteryEff*100).toFixed(1)+'% • ตัวคูณเผื่อ '+DEFAULTS.batteryReserve],['เป้าหมายกลางคืน',r.systemType==='Hybrid'?r.nightRequiredKwh.toFixed(2)+' kWh':'ไม่ใช้แบต'],['รุ่นที่เสนอ',name(r.battery)],['ชุดติดตั้ง',r.battery?r.battery.capacity_kwh+' kWh/ชุด × '+r.batQty+' = '+nominal.toFixed(2)+' kWh':'ไม่มี'],['เงื่อนไข','ค่าเริ่มต้นใช้เป้าหมายกลางคืน เมื่อกรอกอุปกรณ์และชั่วโมงสำรองครบจะใช้โหลดสำรองแทน ไม่รับประกันครอบคลุมโหลดกลางคืนทั้งหมด ต้องยืนยัน BMS/กำลังจ่าย/การต่อเพิ่มตามคู่มือ']]],
 ovGeneration:['ที่มาของผลผลิตไฟฟ้า','rGen',[
 ['กำลังแผงติดตั้ง',r.kwp.toFixed(2)+' kWp'],['ผลผลิตปีแรก',r.genYear.toFixed(1)+' kWh/ปี'],['เฉลี่ยต่อเดือน',r.genMonth.toFixed(1)+' kWh/เดือน'],['แหล่งข้อมูล','สมมติฐานหลังบ้าน '+DEFAULTS.yieldPerKwpMonth+' kWh/kWp/เดือน'],['สูตร','ผลผลิต AC รายเดือนต่อ kWp × กำลังติดตั้ง รวม 12 เดือน'],['ใช้ไฟตรงกลางวัน',r.directMonthly.toFixed(1)+' kWh/เดือน'],['ผ่านแบตสู่โหลด',r.shiftedMonthly.toFixed(1)+' kWh/เดือน'],['ประสิทธิภาพรอบแบต',(DEFAULTS.batteryRoundTripEff*100).toFixed(1)+'%'],['ข้อจำกัด','ใช้การกระจายโหลดและแดดในวันตัวอย่าง ไม่ใช่ผลวัดจริง รายชั่วโมงอาจต่างจากหน้างาน']]],
 ovSavingPct:['วิธีประเมินเงินประหยัด','svMonth',[
 ['หน่วยไฟก่อนติดตั้ง',r.monthlyKwh.toFixed(1)+' kWh/เดือน'],['หน่วยที่ลดการซื้อโดยประมาณ',(r.directMonthly+r.shiftedMonthly).toFixed(1)+' kWh/เดือน'],['วิธีค่าไฟ',$('billingMode').selectedOptions[0].textContent],['ค่าบริการที่ยังต้องจ่าย',money(r.billBefore?.service??num('serviceCharge'))+' ก่อน VAT/เดือน'],['ประหยัดเฉลี่ยเดือนแรก',money(r.saveMonth)],['ประหยัดปีแรก',money(r.saveYear)],['ส่วนเผื่อเพดานและยอดคงเหลือขั้นต่ำ',money(r.modelReserve)+'/เดือน — ไม่ใช่ค่าสแตนด์บายทางการ'],['ยอดคงเหลือประเมิน',money(r.remainingBill)+'/เดือน'],['ขายไฟปีแรก',money(r.exportRevenueYear1)+' — แยกจากเงินลดบิล'],['หลักการ','คิดเฉพาะพลังงานที่ใช้เองสำหรับลดบิล รายได้ขายไฟแยกตามสัญญา; PEA ใช้ส่วนต่างค่าไฟขั้นบันได + Ft + VAT ประเภทบิลคงเดิม'],['ข้อจำกัด','TOU/demand ต้องตรวจข้อมูลตามช่วงเวลา ไม่รับรองว่าโหลดกลางวันทั้งหมดตรงกับแดดจริง']]],
 finInvestment:['เงินลงทุนโครงการ','rCost', [['ประเภทฐานราคา',r.systemType+' — คิด BOQ แยกตามรุ่นอินเวอร์เตอร์และแบต'],['ความจุแบตที่ใช้คิดราคา',r.installedBatteryKwh.toFixed(2)+' kWh (ปัดตามจำนวนชุดจริง)'],['แผงโซลาร์',money(r.price.panelTotal)],['อินเวอร์เตอร์',money(r.price.inverterTotal)],['แบตเตอรี่',money(r.price.batteryTotal)],['งานประกอบเฉพาะระบบ',money(r.price.systemBalance)],['รวมอุปกรณ์ (ยอดย่อย)',money(r.price.equipment)],['ค่าแรง',money(r.price.labor)],['โครงสร้าง',money(r.price.structure)],['สายและอุปกรณ์',money(r.price.wiring)],['ค่าขนส่ง',money(r.price.transport)],['ค่าดำเนินการ',money(r.price.admin)],['งานเพิ่มเติม',money(r.price.extra||0)],['Margin',money(r.price.margin)],['VAT',money(r.price.vat)],['รวมเงินลงทุน',money(r.price.total)]]],
 rPay:['จุดคุ้มทุนครั้งแรกโดยประมาณ','annualBody', [['ระยะคืนทุน',r.eco.payback==null?'ไม่คุ้มทุนในช่วงวิเคราะห์':r.eco.payback+' ปี'],['หลักการ','ปีแรกที่กระแสเงินสดสะสมหลังหักเงินลงทุนกลับถึง 0 โดยแทรกค่าระหว่างปี'],['รวมค่าใช้จ่าย','หักค่าบำรุงและค่าเปลี่ยนอุปกรณ์ที่ตั้งค่าแล้ว'],['ข้อจำกัด','เป็นคืนทุนแบบไม่คิดลด; หากเปลี่ยนอุปกรณ์ภายหลังอาจกลับติดลบได้ ดูตารางรายปีประกอบ']]],
 finAccumulated:['ประหยัดสุทธิสะสม 25 ปี','annualBody', [['ยอดสะสม',money(r.cashflowRows.at(-1).accumulated)],['สูตร','รวมเงินประหยัดและรายได้ขายไฟตามสัญญารายปี − ค่าบำรุงรักษา − ค่าเปลี่ยนอุปกรณ์'],['ค่าไฟเปลี่ยนต่อปี',(DEFAULTS.tariffGrowth*100).toFixed(1)+'%'],['ผลผลิตลดต่อปี',(DEFAULTS.degradation*100).toFixed(2)+'%'],['หมายเหตุ','ยอดนี้ยังไม่หักเงินลงทุน ไม่ใช่เงินรับประกัน และใช้อัตราเปลี่ยนแปลงตามสมมติฐาน']]],
 rProfit:['ยอดสุทธิหลังหักเงินลงทุน','annualBody', [['ประหยัดสุทธิสะสม',money(r.cashflowRows.at(-1).accumulated)],['หักเงินลงทุน',money(r.price.total)],['สุทธิ 25 ปี',money(r.eco.profit25)],['NPV ที่อัตราคิดลด '+(DEFAULTS.discount*100).toFixed(1)+'%',money(r.eco.npv)],['หมายเหตุ','ยอดสุทธิปกติยังไม่คิดลดมูลค่าเงินตามเวลา; NPV คิดลดแล้ว']]]
 };
 const entry=items[id];if(!entry)return;
 if(['ovSystem','ovSavingPct','rPay','finAccumulated','rProfit'].includes(id))entry[2].push(['สมมติฐานและเงื่อนไข',r.warnings.join(' • ')]);
 if(['rPay','rProfit'].includes(id))entry[2].push(['ROI สุทธิ 25 ปี',r.eco.roi==null?'—':r.eco.roi.toFixed(1)+'%'],['สูตร ROI','กระแสเงินสดสุทธิสะสมหลังหักทุน ÷ ทุนเริ่มต้น × 100'],['สูตร IRR','หา r ที่ทำให้ −ทุน + Σ[กระแสเงินสดสุทธิปี t ÷ (1+r)^t] = 0'],['แผงเสื่อม/ค่าไฟเพิ่ม',(DEFAULTS.degradation*100)+'% / '+(DEFAULTS.tariffGrowth*100)+'% ต่อปี (สมมติฐาน)']);
 $('dashboardDetailTitle').textContent=entry[0];$('dashboardDetailBody').replaceChildren();
 const dl=document.createElement('dl');dl.className='specs';
 for(const [label,value]of entry[2]){const row=document.createElement('div'),dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=value;row.append(dt,dd);dl.append(row);}
 $('dashboardDetailBody').append(dl);$('dashboardDialog').dataset.detail=id;
 $('detailGo').onclick=()=>{const target=$(entry[1]);$('dashboardDialog').close();if(target?.closest('[hidden]'))return;target?.closest('section')?.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});};
 if(show&&!$('dashboardDialog').open)$('dashboardDialog').showModal();
}
document.querySelectorAll('.dashboard-detail').forEach(b=>b.onclick=()=>openDashboardDetail(b.dataset.detail));
$('closeDashboardDetail').onclick=()=>$('dashboardDialog').close();
$('dashboardDialog').addEventListener('click',e=>{if(e.target===$('dashboardDialog')){const b=e.target.getBoundingClientRect();if(e.clientX<b.left||e.clientX>b.right||e.clientY<b.top||e.clientY>b.bottom)e.target.close();}});
const shortMoney = v => { const a = Math.abs(v), s = v < 0 ? '-' : ''; return a >= 1e6 ? s + (a / 1e6).toFixed(1) + 'ล.' : a >= 1e3 ? s + Math.round(a / 1e3) + 'k' : s + Math.round(a); };
function renderBar(points, payback, investment, rows) {
  const W=720,H=360,p={t:62,r:18,b:42,l:62};
  let operating=0;
  const savings=rows.map(row=>{if(row.year>0)operating+=row.saving+(row.exportRevenue||0)-row.maintenance;return {year:row.year,value:operating};});
  const netValues=rows.map(row=>row.accumulated);
  const minY=Math.min(0,...netValues,...savings.map(x=>x.value)),maxY=Math.max(investment,...savings.map(x=>x.value),1)*1.08;
  const ch=H-p.t-p.b,step=(W-p.l-p.r)/savings.length,bw=Math.max(6,step-4);
  const x=i=>p.l+i*step+2,y=v=>p.t+(maxY-v)/(maxY-minY)*ch;
  const firstRecovered=rows.findIndex(row=>row.year>0&&row.cumulative>=0);
  const before=firstRecovered>0?rows[firstRecovered-1]:null,after=firstRecovered>0?rows[firstRecovered]:null;
  const exactPayback=before&&after?before.year+(-before.cumulative)/(after.cumulative-before.cumulative):null;
  const crossingX=exactPayback==null?null:x(0)+bw/2+exactPayback*step;
  const labelX=crossingX==null?null:Math.max(p.l+100,Math.min(W-p.r-100,crossingX));
  const detail=row=>`ปี ${row.year}\nเงินลงทุนเริ่มต้น: ${money(investment)}\nประหยัดค่าไฟปีนี้: ${money(row.saving)}\nรายได้ขายไฟ: ${money(row.exportRevenue||0)}\nบำรุงรักษา: ${money(row.maintenance)}\nเปลี่ยนอุปกรณ์: ${money(row.replacement||0)}\nสะสมก่อนค่าเปลี่ยนอุปกรณ์: ${money(savings[row.year].value)}\nสะสมสุทธิหลังค่าเปลี่ยนอุปกรณ์: ${money(row.accumulated)}\nสุทธิหลังหักเงินลงทุน: ${money(row.cumulative)}`;
  $('chartTooltip').hidden=true;
  $('chart').innerHTML=`<div class="chart-legend finance-legend"><span><i class="legend-before"></i>สะสมก่อนค่าเปลี่ยนอุปกรณ์</span><span><i class="legend-net"></i>สะสมสุทธิหลังค่าเปลี่ยนอุปกรณ์</span><span><i class="legend-invest"></i>เงินลงทุนเริ่มต้น</span></div>
    <p class="chart-explanation">แท่งกราฟ = ประหยัดสะสมหลังค่าดูแล ก่อนค่าเปลี่ยนอุปกรณ์<br>เส้นสีเข้ม = ยอดสุทธิที่ใช้คำนวณคืนทุน; อาจลดลงในปีที่เปลี่ยนอุปกรณ์</p>
    <svg viewBox="0 0 ${W} ${H}" class="svg-chart" role="group" aria-label="ยอดประหยัดสะสมก่อนและหลังค่าเปลี่ยนอุปกรณ์เทียบเงินลงทุน">
    <title>เงินประหยัดสะสมและจุดคุ้มทุนครั้งแรก</title>
    ${Array.from({length:5},(_,i)=>minY+(maxY-minY)*i/4).map(v=>`<line x1="${p.l}" y1="${y(v)}" x2="${W-p.r}" y2="${y(v)}" stroke="#dce8e3"/><text x="${p.l-8}" y="${y(v)+4}" text-anchor="end" class="tick">${shortMoney(v)}</text>`).join('')}
    ${savings.map((pt,i)=>`<rect class="chart-bar" data-year="${i}" tabindex="0" role="img" aria-label="${esc(detail(rows[i]))}" x="${x(i)}" y="${y(Math.max(0,pt.value))}" width="${bw}" height="${Math.max(2,Math.abs(y(0)-y(pt.value)))}" rx="3" fill="#39aabf"><title>${esc(detail(rows[i]))}</title></rect>${i%5===0?`<text x="${x(i)+bw/2}" y="${H-17}" text-anchor="middle" class="tick">ปี ${pt.year}</text>`:''}`).join('')}
    <polyline class="net-accumulated-line" points="${rows.map((row,i)=>(x(i)+bw/2)+','+y(row.accumulated)).join(' ')}" fill="none" stroke="#173c32" stroke-width="3" stroke-linejoin="round"/>
    ${rows.filter(row=>row.replacement>0).map(row=>`<circle cx="${x(row.year)+bw/2}" cy="${y(row.accumulated)}" r="5" fill="#c3743e"><title>ปี ${row.year} เปลี่ยนอุปกรณ์ ${money(row.replacement)}</title></circle>`).join('')}
    <line class="investment-line" x1="${p.l}" y1="${y(investment)}" x2="${W-p.r}" y2="${y(investment)}" stroke="#b58219" stroke-width="2.5" stroke-dasharray="7 4"/>
    <text x="${W-p.r-5}" y="${Math.max(p.t+12,y(investment)-9)}" text-anchor="end" class="investment-label">เงินลงทุน ${money(investment)}</text>
    ${crossingX==null?`<text x="${p.l}" y="30" class="no-payback-label">ยังไม่ถึงจุดคุ้มทุนภายใน 25 ปี</text>`:`<line class="payback-marker" x1="${crossingX}" y1="40" x2="${crossingX}" y2="${H-p.b}" stroke="#0b6b57" stroke-width="2" stroke-dasharray="4 4"/><circle cx="${crossingX}" cy="${y(investment)}" r="6" fill="#d7a63e" stroke="#fff" stroke-width="2"/><rect x="${labelX-100}" y="8" width="200" height="30" rx="10" fill="#0b6b57"/><text x="${labelX}" y="28" text-anchor="middle" class="payback-label">คุ้มทุนครั้งแรก ≈ ${payback} ปี</text>`}
    </svg><p class="hint">จุดคุ้มทุนอ้างอิงเส้นสุทธิ ไม่ใช่ยอดแท่งก่อนค่าเปลี่ยน • ชี้เมาส์หรือแตะแท่งเพื่อดูรายละเอียด</p>`;
  $('annualBody').innerHTML=rows.map(row=>`<tr class="${row.year===firstRecovered?'first-break-even':row.year>0&&row.cumulative>=0?'break-even':''}"><td>${row.year===0?'0 (ลงทุน)':row.year}${row.year===firstRecovered?'<small class="payback-badge">ปีแรกที่สะสมเกินทุน</small>':''}</td><td class="r">${money(row.saving)}</td><td class="r">${money(row.exportRevenue||0)}</td><td class="r">${money(row.maintenance)}</td><td class="r">${money(row.replacement||0)}</td><td class="r">${money(row.net)}</td><td class="r">${money(row.accumulated)}</td><td class="r">${money(row.cumulative)}</td></tr>`).join('');
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
      const active=item.active===false;const {error}=await supabase.from('equipment').update({active}).eq('id',toggle);
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
  if(c==='battery'&&/SUN\s*2000/i.test($('eqModel').value))return notify('SUN2000 เป็นอินเวอร์เตอร์ Huawei ไม่ใช่แบตเตอรี่ ตรวจชื่อรุ่นและประเภทอุปกรณ์ก่อนบันทึก');
  const rated=c==='panel'?n('eqPanelWp'):c==='inverter'?n('eqPowerKw'):n('eqCapacityKwh');if(['panel','inverter','battery'].includes(c)&&!(rated>0))return notify('กรอกกำลังหรือความจุอุปกรณ์เป็นค่ามากกว่า 0 ตาม datasheet');
  const payload = { category: c, brand: $('eqBrand').value, model: $('eqModel').value, panel_wp: c === 'panel' ? n('eqPanelWp') : null, power_kw: c === 'inverter' ? n('eqPowerKw') : null, capacity_kwh: c === 'battery' ? n('eqCapacityKwh') : null, system_type: c === 'panel' ? null : ($('eqSystemType').value || null), phase: c === 'inverter' ? ($('eqPhase').value || null) : null, cost: Number($('eqCost').value || 0), sell_price: Number($('eqSellPrice').value || 0), active: true, is_default: c === 'panel' && $('eqIsDefault').value === 'true' };
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
  const payload = { customer_name: $('customerName').value || 'ไม่ระบุชื่อ', phone: $('phone').value, site_name: $('siteName').value, system_type: r.systemType, calc_mode: r.calcMode, monthly_kwh: r.monthlyKwh || 0, monthly_bill: num('monthlyBill'), daytime_percent: r.dayPercent, panel_wp: Number(r.panel.panel_wp || 0), recommended_kwp: r.kwp, panel_count: r.panelQty, inverter_kw: Number(r.inverter?.power_kw || 0) * r.invQty, battery_kwh: r.battery ? Number(r.battery.capacity_kwh || 0) * r.batQty : 0, project_price: r.price.total, monthly_saving: r.saveMonth, annual_saving: r.saveYear, saving_percent: num('monthlyBill') > 0 ? Math.min(100, r.saveMonth / num('monthlyBill') * 100) : 0, payback_year: r.eco.payback, final_profit: r.eco.profit25, selected_panel: `${r.panel.brand} ${r.panel.model}`, selected_inverter: r.inverter ? `${r.inverter.brand} ${r.inverter.model}` : null, selected_battery: r.battery ? `${r.battery.brand} ${r.battery.model}` : null, line_items: { settings_snapshot: settings.snapshot(), pricing_snapshot: r.pricingSnapshot, design_inputs: { data_review:r.dataReview, energy_basis:r.energyBasis, building: $('buildingType').value, phase: r.phase, usage_period: radio('usagePeriod'), daytime_percent: r.dayPercent, night_daily_kwh: r.nightDaily, battery_target_kwh: r.backup.batteryKwh, battery_sizing_source:r.backup.source, financial_model_version:14, roi:r.eco.roi, irr:r.eco.irr, annual_cashflows:r.cashflowRows, raw_saving:r.rawSaving, model_reserve:r.modelReserve, remaining_bill:r.remainingBill, export_eligible:r.exportEligible, export_revenue_year1:r.exportRevenueYear1, roof:r.roof, backup_required_kwh:r.backupRequiredKwh, billing_month:$('billingMonth').value, service_charge:r.billBefore?.service??num('serviceCharge'), tariff_reference:{base:r.billBefore?OFFICIAL_RESIDENTIAL:null,ft:state.tariffReference||null}, bill_before:r.billBefore, bill_after:r.billAfter, comparison:r.comparison, billing_mode:r.billingMode, tariff_configured_mode:$('billingMode').value, ft:state.tariffReference?.value??null, bill_vat:7 }, panel: line(r.panel, r.panelQty), inverter: line(r.inverter, r.invQty), battery: line(r.battery, r.batQty), backup: r.backup.items.map(i => ({ appliance_id: i.id, name: i.name, qty: i.qty, watt: i.powerW })) }, notes: $('notes').value };
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
  tariffModule=tariffModule||await withTimeout(import(localModule('./tariffs.js')),5000,'ตัวอ่านอัตราค่าไฟ');
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
const {mountCatalog}=await import(localModule('./catalog.js'));
 catalog=mountCatalog({getClient:()=>supabase,getSettings:()=>settings,state,DEFAULTS,CAT,UNIT,esc,notify,calc,renderEquipment});
 const spec=x=>coreSpec(x)+(catalog?.summary(x)||'');
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
