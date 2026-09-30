
import { calculateSolar, chooseClosest, evaluateEconomics } from './calc.js';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

let supabase = null;
const configured = Boolean(SUPABASE_URL && SUPABASE_KEY);
if (configured) {
  const mod = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
  supabase = mod.createClient(SUPABASE_URL, SUPABASE_KEY);
}

const state = { equipment: [], assessments: [], editingEquipmentId: null, lastResult: null };
const app = document.getElementById('app');

app.innerHTML = `
<div class="app">
  <aside class="sidebar">
    <div class="brand">
      <div class="brand-mark">☀</div>
      <div><b>Solar Office Pro</b><small>Sales & Sizing Suite</small></div>
    </div>
    <nav class="nav">
      <button class="active" data-page="dashboard">ภาพรวม</button>
      <button data-page="calculator">คำนวณระบบ</button>
      <button data-page="history">ประวัติลูกค้า</button>
      <button data-page="equipment">อุปกรณ์</button>
      <button data-page="help">คู่มือ</button>
    </nav>
    <div class="side-status">
      <b>${configured ? 'Supabase เชื่อมต่อแล้ว' : 'Demo Mode'}</b><br>
      เวอร์ชันนี้ไม่มีระบบล็อกอินตามที่กำหนด จึงไม่ควรใช้เก็บข้อมูลลับมาก
    </div>
  </aside>

  <main class="main">
    <section id="dashboard" class="page active">
      <div class="topbar">
        <div><div class="eyebrow">DASHBOARD</div><h1>ภาพรวมงานโซลาร์</h1></div>
        <span class="status-pill">${configured ? '● Online' : '● Demo'}</span>
      </div>
      <div class="grid4">
        <div class="metric"><small>จำนวนการประเมิน</small><b id="dashAssessments">0</b><span>รายการทั้งหมด</span></div>
        <div class="metric"><small>อุปกรณ์ในระบบ</small><b id="dashEquipment">0</b><span>แผง / อินเวอร์เตอร์ / แบต</span></div>
        <div class="metric"><small>มูลค่าโครงการรวม</small><b id="dashProjectValue">฿0</b><span>จากประวัติที่บันทึก</span></div>
        <div class="metric"><small>ประหยัดต่อเดือนรวม</small><b id="dashSaving">฿0</b><span>ประมาณการจากโครงการ</span></div>
      </div>
      <div class="two-col">
        <div class="card">
          <div class="section-head"><div><div class="eyebrow">RECENT</div><h2>งานประเมินล่าสุด</h2></div></div>
          <div id="recentList"></div>
        </div>
        <div class="card">
          <div class="section-head"><div><div class="eyebrow">QUICK START</div><h2>เริ่มงานใหม่</h2></div></div>
          <p class="muted">เริ่มจากค่าไฟและพฤติกรรมการใช้ไฟ ระบบจะคำนวณขนาด Solar, Battery, จุดคุ้มทุน และกำไรสะสมให้</p>
          <div class="actions"><button class="btn primary" id="goCalcBtn">สร้างการประเมินใหม่</button></div>
        </div>
      </div>
    </section>

    <section id="calculator" class="page">
      <div class="topbar">
        <div><div class="eyebrow">SOLAR CALCULATOR</div><h1>ประเมินระบบและความคุ้มค่า</h1></div>
        <span class="status-pill">Pre-Sale Sizing</span>
      </div>

      <div class="grid4">
        <div class="metric"><small>ขนาดติดตั้ง</small><b id="cardKwp">—</b><span>kWp</span></div>
        <div class="metric"><small>ประหยัด / เดือน</small><b id="cardSaving">—</b><span>ประมาณการ</span></div>
        <div class="metric"><small>จุดคุ้มทุน</small><b id="cardPayback">—</b><span>ปีโดยประมาณ</span></div>
        <div class="metric"><small>กำไรปลายงวด</small><b id="cardProfit">—</b><span>หลังหักเงินลงทุน</span></div>
      </div>

      <div class="two-col">
        <div class="stack">
          <div class="card">
            <div class="section-head"><div><div class="eyebrow">CUSTOMER</div><h2>ข้อมูลลูกค้า</h2></div></div>
            <div class="form-grid">
              <label>ชื่อลูกค้า<input id="customerName" placeholder="เช่น คุณสมชาย / บริษัท ABC"></label>
              <label>เบอร์โทร<input id="phone" placeholder="08x-xxx-xxxx"></label>
              <label>ชื่อสถานที่ / โครงการ<input id="siteName" placeholder="บ้าน / โรงงาน / ฟาร์ม"></label>
              <label>ประเภทระบบ<select id="systemType"><option>On-Grid</option><option>Hybrid</option></select></label>
            </div>
          </div>

          <div class="card">
            <div class="section-head"><div><div class="eyebrow">LOAD</div><h2>ข้อมูลการใช้ไฟ</h2></div></div>
            <div class="form-grid">
              <label>หน่วยไฟเฉลี่ยต่อเดือน (kWh)<input id="monthlyKwh" type="number" value="1200"></label>
              <label>ใช้ไฟช่วงกลางวัน (%)<input id="daytimePercent" type="number" value="70"></label>
              <label>กำลังแผงที่ต้องการใช้ (Wp)<input id="panelWp" type="number" value="580"></label>
              <label>ผลผลิตสมมติ (kWh/kWp/เดือน)<input id="yieldPerKwpMonth" type="number" value="125"></label>
              <label>ค่าไฟที่ลูกค้าจ่ายจากบิล (บาท/เดือน)<input id="monthlyBill" type="number" step="1" value="5000"></label>
              <label>พลังงานสำรองที่ต้องการ (kWh)<input id="requestedBackupKwh" type="number" step="0.1" value="0"></label>
            </div>
          </div>

          <div class="card">
            <div class="section-head"><div><div class="eyebrow">ECONOMICS</div><h2>สมมติฐานความคุ้มค่า</h2></div></div>
            <div class="form-grid">
              <label>มูลค่าโครงการ / ราคาติดตั้งรวม (บาท)<input id="projectPrice" type="number" value="350000"></label>
              <label>ค่าบำรุงรักษาต่อปี (บาท)<input id="annualMaintenance" type="number" value="5000"></label>
              <label>ระยะวิเคราะห์ (ปี)<input id="analysisYears" type="number" value="25"></label>
              <label>ค่าไฟเพิ่มต่อปี (%)<input id="tariffGrowth" type="number" step="0.1" value="2.0"></label>
              <label>ประสิทธิภาพแผงลดลงต่อปี (%)<input id="degradationRate" type="number" step="0.1" value="0.5"></label>
              <label>หมายเหตุ<textarea id="notes" placeholder="รายละเอียดหน้างาน หรือข้อสังเกต"></textarea></label>
            </div>
            <div class="actions">
              <button class="btn primary" id="calcBtn">คำนวณทั้งหมด</button>
              <button class="btn secondary" id="saveBtn">บันทึกการประเมิน</button>
              <button class="btn secondary" id="printBtn">พิมพ์ / บันทึกเป็น PDF</button>
            </div>
          </div>
        </div>

        <div class="stack">
          <div class="card">
            <div class="section-head"><div><div class="eyebrow">RESULT</div><h2>ผลประเมินระบบ</h2></div><span id="resultState" class="status-pill">พร้อมคำนวณ</span></div>
            <div class="hero-result"><b id="installedKwp">—</b><span>kWp ติดตั้งโดยประมาณ</span></div>
            <div class="stat-grid">
              <div class="stat"><small>จำนวนแผง</small><b id="panelCount">—</b></div>
              <div class="stat"><small>Inverter Target</small><b id="invTarget">—</b></div>
              <div class="stat"><small>Battery</small><b id="batTarget">—</b></div>
              <div class="stat"><small>ผลิตไฟ / เดือน</small><b id="generation">—</b></div>
              <div class="stat"><small>โหลดกลางวัน</small><b id="daytimeLoad">—</b></div>
              <div class="stat"><small>ประหยัด / เดือน</small><b id="saving">—</b></div>
            </div>
            <div class="recommend"><h3>อุปกรณ์ที่ระบบแนะนำ</h3><div id="recommendList">ยังไม่มีผลคำนวณ</div></div>
            <div class="summary-list">
              <div><span>กำไรสะสมปีที่ 10</span><b id="profit10">—</b></div>
              <div><span>กำไรสะสมปีที่ 15</span><b id="profit15">—</b></div>
              <div><span>กำไรสะสมปีที่ 20</span><b id="profit20">—</b></div>
            </div>
          </div>

          <div class="card">
            <div class="section-head"><div><div class="eyebrow">PAYBACK CHART</div><h2>กราฟจุดคุ้มทุนและกำไร</h2></div></div>
            <div id="chartMeta" class="muted">กดคำนวณเพื่อดูกราฟ</div>
            <div id="chartWrap" class="chart-wrap"></div>
          </div>
        </div>
      </div>
    </section>

    <section id="history" class="page">
      <div class="topbar"><div><div class="eyebrow">HISTORY</div><h1>ประวัติการประเมินลูกค้า</h1></div><button class="btn secondary no-print" id="refreshHistoryBtn">รีเฟรช</button></div>
      <div class="card">
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>วันที่</th><th>ลูกค้า</th><th>ระบบ</th><th>kWp</th><th>ราคาโครงการ</th><th>คุ้มทุน</th><th>ประหยัด/เดือน</th><th></th></tr></thead>
            <tbody id="historyBody"></tbody>
          </table>
        </div>
      </div>
    </section>

    <section id="equipment" class="page">
      <div class="topbar"><div><div class="eyebrow">EQUIPMENT ADMIN</div><h1>จัดการอุปกรณ์</h1></div><button class="btn secondary no-print" id="refreshEquipmentBtn">รีเฟรช</button></div>
      <div class="admin-grid">
        <div class="card">
          <div class="section-head"><div><h2 id="equipmentFormTitle">เพิ่มอุปกรณ์</h2></div></div>
          <form id="equipmentForm" class="form-grid">
            <label>ประเภท<select id="eqCategory"><option value="panel">แผง Solar</option><option value="inverter">Inverter</option><option value="battery">Battery</option></select></label>
            <label>ยี่ห้อ<input id="eqBrand" required></label>
            <label>รุ่น<input id="eqModel" required></label>
            <label>กำลังแผง Wp<input id="eqPanelWp" type="number"></label>
            <label>กำลัง Inverter kW<input id="eqPowerKw" type="number" step="0.1"></label>
            <label>Battery kWh<input id="eqCapacityKwh" type="number" step="0.1"></label>
            <label>เฟส<select id="eqPhase"><option value="">ไม่ระบุ</option><option>1 Phase</option><option>3 Phase</option></select></label>
            <label>ระบบ<select id="eqSystemType"><option value="">ไม่ระบุ</option><option>On-Grid</option><option>Hybrid</option></select></label>
            <label>ต้นทุน<input id="eqCost" type="number" step="0.01"></label>
            <label>ราคาขาย<input id="eqSellPrice" type="number" step="0.01"></label>
            <div class="actions" style="grid-column:1/-1"><button class="btn primary" type="submit">บันทึก</button><button class="btn secondary" type="button" id="eqCancelBtn">ล้างฟอร์ม</button></div>
          </form>
        </div>
        <div class="card">
          <div id="equipmentList" class="list"></div>
        </div>
      </div>
    </section>

    <section id="help" class="page">
      <div class="topbar"><div><div class="eyebrow">GUIDE</div><h1>คู่มือใช้งาน</h1></div></div>
      <div class="card">
        <h2>ลำดับใช้งานที่แนะนำ</h2>
        <ol>
          <li>ไปหน้า <b>อุปกรณ์</b> เพิ่มแผง, Inverter และ Battery ที่บริษัทขายจริง</li>
          <li>ไปหน้า <b>คำนวณระบบ</b> กรอกค่าไฟเฉลี่ยและสัดส่วนใช้ไฟกลางวัน</li>
          <li>กรอกราคาติดตั้งรวม แล้วกด <b>คำนวณทั้งหมด</b></li>
          <li>ตรวจผล kWp, จำนวนแผง, Inverter, Battery และกราฟคืนทุน</li>
          <li>กด <b>บันทึกการประเมิน</b> เพื่อเก็บประวัติ</li>
          <li>กด <b>พิมพ์ / บันทึกเป็น PDF</b> เพื่อออกเอกสารเบื้องต้น</li>
        </ol>
        <div class="notice">ผลคำนวณนี้เป็น Pre-Sale Sizing เท่านั้น ก่อนติดตั้งจริงต้องตรวจหน้างาน, โหลด, พื้นที่หลังคา, โครงสร้าง, String, Voc/Vmp/Current, MPPT, Protection และ Datasheet ของอุปกรณ์จริง</div>
      </div>
    </section>

    <div class="footer">Solar Office Pro • GitHub Pages + Supabase • ระบบนี้ไม่มีล็อกอินตาม requirement ปัจจุบัน</div>
  </main>
</div>
`;

const $ = id => document.getElementById(id);
const money = n => new Intl.NumberFormat('th-TH',{style:'currency',currency:'THB',maximumFractionDigits:0}).format(Number(n||0));
const esc = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

document.querySelectorAll('.nav button').forEach(btn=>btn.addEventListener('click',()=>showPage(btn.dataset.page)));
function showPage(id){
  document.querySelectorAll('.nav button,.page').forEach(x=>x.classList.remove('active'));
  document.querySelector(`.nav button[data-page="${id}"]`)?.classList.add('active');
  $(id)?.classList.add('active');
  if(id==='dashboard') renderDashboard();
}
$('goCalcBtn').addEventListener('click',()=>showPage('calculator'));

function demoEquipment(){ return [
  {id:'p1',category:'panel',brand:'Demo Solar',model:'580W Mono',panel_wp:580,cost:2500,sell_price:3200,active:true},
  {id:'i1',category:'inverter',brand:'Demo Inverter',model:'10K Hybrid',power_kw:10,cost:35000,sell_price:45000,active:true},
  {id:'b1',category:'battery',brand:'Demo Battery',model:'15kWh LFP',capacity_kwh:15,cost:80000,sell_price:99000,active:true}
]}

async function loadEquipment(){
  if(!supabase){ state.equipment=demoEquipment(); renderEquipment(); renderDashboard(); return; }
  const {data,error}=await supabase.from('equipment').select('*').order('category').order('brand');
  if(error){ console.error(error); state.equipment=demoEquipment(); }
  else state.equipment=data||[];
  renderEquipment(); renderDashboard();
}
async function loadAssessments(){
  if(!supabase){ state.assessments=[]; renderHistory(); renderDashboard(); return; }
  const {data,error}=await supabase.from('assessments').select('*').order('created_at',{ascending:false});
  if(error){ console.error(error); state.assessments=[]; } else state.assessments=data||[];
  renderHistory(); renderDashboard();
}

function runCalculation(){
  const solar=calculateSolar({
    monthlyKwh:$('monthlyKwh').value, daytimePercent:$('daytimePercent').value,
    panelWp:$('panelWp').value, yieldPerKwpMonth:$('yieldPerKwpMonth').value,
    monthlyBill:$('monthlyBill').value, requestedBackupKwh:$('requestedBackupKwh').value, batteryDod:.9
  });
  const eco=evaluateEconomics({
    totalProjectPrice:$('projectPrice').value, annualSaving:solar.estimatedAnnualSaving,
    annualMaintenance:$('annualMaintenance').value, analysisYears:$('analysisYears').value,
    tariffGrowth:$('tariffGrowth').value, degradationRate:$('degradationRate').value
  });
  const panel=chooseClosest(state.equipment,'panel_wp',Number($('panelWp').value),'panel');
  const inv=chooseClosest(state.equipment,'power_kw',solar.inverterKwTarget,'inverter');
  const bat=solar.batteryNameplateKwh>0?chooseClosest(state.equipment,'capacity_kwh',solar.batteryNameplateKwh,'battery'):null;

  state.lastResult={solar,eco,panel,inv,bat};

  $('resultState').textContent='คำนวณแล้ว'; $('installedKwp').textContent=solar.installedKwp.toFixed(2);
  $('panelCount').textContent=solar.panelCount; $('invTarget').textContent=solar.inverterKwTarget.toFixed(1)+' kW';
  $('batTarget').textContent=solar.batteryNameplateKwh.toFixed(1)+' kWh'; $('generation').textContent=solar.estimatedMonthlyGeneration.toFixed(0)+' kWh';
  $('daytimeLoad').textContent=solar.daytimeKwh.toFixed(0)+' kWh'; $('saving').textContent=money(solar.estimatedMonthlySaving);
  $('cardKwp').textContent=solar.installedKwp.toFixed(2); $('cardSaving').textContent=money(solar.estimatedMonthlySaving);
  $('cardPayback').textContent=eco.paybackYear?eco.paybackYear+' ปี':'เกินช่วงวิเคราะห์'; $('cardProfit').textContent=money(eco.finalProfit);
  $('profit10').textContent=eco.profitYear10===null?'-':money(eco.profitYear10);
  $('profit15').textContent=eco.profitYear15===null?'-':money(eco.profitYear15);
  $('profit20').textContent=eco.profitYear20===null?'-':money(eco.profitYear20);

  $('recommendList').innerHTML=[
    panel?`<div>แผง: <b>${esc(panel.brand)} ${esc(panel.model)}</b> × ${solar.panelCount}</div>`:'<div>แผง: ยังไม่มีรุ่นในฐานข้อมูล</div>',
    inv?`<div>Inverter: <b>${esc(inv.brand)} ${esc(inv.model)}</b> (${inv.power_kw} kW)</div>`:'<div>Inverter: ยังไม่มีรุ่นในฐานข้อมูล</div>',
    solar.batteryNameplateKwh>0?(bat?`<div>Battery: <b>${esc(bat.brand)} ${esc(bat.model)}</b> (${bat.capacity_kwh} kWh)</div>`:'<div>Battery: ยังไม่มีรุ่นในฐานข้อมูล</div>'):'<div>Battery: ไม่ใช้แบตเตอรี่</div>'
  ].join('');

  $('chartMeta').innerHTML=`<b>จุดคุ้มทุน:</b> ${eco.paybackYear?eco.paybackYear+' ปี':'ยังไม่ถึงในช่วงวิเคราะห์'} • <b>กำไรสะสมปลายงวด:</b> ${money(eco.finalProfit)}`;
  renderChart(eco.points,eco.paybackYear);
}

function renderChart(points,paybackYear){
  const W=760,H=340,p={t:24,r:20,b:40,l:68};
  const ys=points.map(x=>x.cumulative), minY=Math.min(...ys,0), maxY=Math.max(...ys,0), span=Math.max(1,maxY-minY);
  const cw=W-p.l-p.r,ch=H-p.t-p.b;
  const xs=y=>p.l+(y/(points.length-1))*cw, yscl=v=>p.t+((maxY-v)/span)*ch;
  const path=points.map((pt,i)=>`${i?'L':'M'} ${xs(pt.year)} ${yscl(pt.cumulative)}`).join(' ');
  const ticks=Array.from({length:6},(_,i)=>minY+((maxY-minY)*i/5));
  const xp=points.filter((pt,i)=>i===0||i===points.length-1||pt.year%5===0);
  const pb=paybackYear?points.find(x=>x.year===paybackYear):null;
  $('chartWrap').innerHTML=`<svg viewBox="0 0 ${W} ${H}" class="svg-chart">
  ${ticks.map(v=>`<line x1="${p.l}" y1="${yscl(v)}" x2="${W-p.r}" y2="${yscl(v)}" stroke="#e4eee8" stroke-dasharray="4 4"/><text x="${p.l-8}" y="${yscl(v)+4}" text-anchor="end" class="tick">${shortMoney(v)}</text>`).join('')}
  <line x1="${p.l}" y1="${yscl(0)}" x2="${W-p.r}" y2="${yscl(0)}" stroke="#0d5b4f" stroke-width="1.4"/>
  <path d="${path}" fill="none" stroke="#18b86f" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
  ${points.map(pt=>`<circle cx="${xs(pt.year)}" cy="${yscl(pt.cumulative)}" r="3.5" fill="${pt.cumulative>=0?'#18b86f':'#ff9d2e'}"/>`).join('')}
  ${xp.map(pt=>`<text x="${xs(pt.year)}" y="${H-15}" text-anchor="middle" class="tick">ปี ${pt.year}</text>`).join('')}
  ${pb?`<circle cx="${xs(pb.year)}" cy="${yscl(pb.cumulative)}" r="7" fill="#0d5b4f" stroke="#fff" stroke-width="3"/><rect x="${Math.max(90,xs(pb.year)-55)}" y="${Math.max(8,yscl(pb.cumulative)-42)}" width="120" height="30" rx="9" fill="#0d5b4f"/><text x="${Math.max(150,xs(pb.year)+5)}" y="${Math.max(28,yscl(pb.cumulative)-22)}" text-anchor="middle" class="label">คุ้มทุนปีที่ ${pb.year}</text>`:''}
  <text x="${W/2}" y="${H-2}" text-anchor="middle" class="axis">ระยะเวลา (ปี)</text>
  <text x="16" y="${H/2}" transform="rotate(-90 16 ${H/2})" text-anchor="middle" class="axis">กำไรสะสม (บาท)</text>
  </svg>`;
}
function shortMoney(v){const a=Math.abs(v),s=v<0?'-':'';return a>=1e6?s+(a/1e6).toFixed(1)+'ล.':a>=1e3?s+Math.round(a/1e3)+'k':s+Math.round(a)}

async function saveAssessment(){
  if(!state.lastResult) runCalculation();
  if(!supabase){ alert('ยังไม่ได้เชื่อม Supabase'); return; }
  const {solar,eco,panel,inv,bat}=state.lastResult;
  const payload={
    customer_name:$('customerName').value.trim()||'ไม่ระบุชื่อ',
    phone:$('phone').value.trim(), site_name:$('siteName').value.trim(), system_type:$('systemType').value,
    monthly_kwh:solar.monthlyKwh, daytime_percent:Number($('daytimePercent').value)||0, panel_wp:Number($('panelWp').value)||0,
    recommended_kwp:solar.installedKwp, panel_count:solar.panelCount, inverter_kw:solar.inverterKwTarget,
    battery_kwh:solar.batteryNameplateKwh, project_price:Number($('projectPrice').value)||0,
    monthly_saving:solar.estimatedMonthlySaving, payback_year:eco.paybackYear, final_profit:eco.finalProfit,
    selected_panel:panel?`${panel.brand} ${panel.model}`:null, selected_inverter:inv?`${inv.brand} ${inv.model}`:null,
    selected_battery:bat?`${bat.brand} ${bat.model}`:null, notes:$('notes').value.trim()
  };
  const {error}=await supabase.from('assessments').insert(payload);
  if(error) alert('บันทึกไม่สำเร็จ: '+error.message); else { alert('บันทึกการประเมินแล้ว'); await loadAssessments(); }
}

function renderHistory(){
  const body=$('historyBody');
  if(!state.assessments.length){ body.innerHTML='<tr><td colspan="8"><div class="empty">ยังไม่มีประวัติการประเมิน</div></td></tr>'; return; }
  body.innerHTML=state.assessments.map(a=>`<tr>
    <td>${new Date(a.created_at).toLocaleDateString('th-TH')}</td><td>${esc(a.customer_name)}</td><td><span class="tag">${esc(a.system_type||'-')}</span></td>
    <td>${Number(a.recommended_kwp||0).toFixed(2)}</td><td>${money(a.project_price)}</td><td>${a.payback_year?a.payback_year+' ปี':'-'}</td>
    <td>${money(a.monthly_saving)}</td><td><button class="btn danger small" onclick="window.deleteAssessment('${a.id}')">ลบ</button></td>
  </tr>`).join('');
}
window.deleteAssessment=async id=>{
  if(!supabase||!confirm('ยืนยันลบรายการนี้?'))return;
  const {error}=await supabase.from('assessments').delete().eq('id',id);
  if(error)alert(error.message);else await loadAssessments();
};

function renderDashboard(){
  $('dashAssessments').textContent=state.assessments.length;
  $('dashEquipment').textContent=state.equipment.length;
  $('dashProjectValue').textContent=money(state.assessments.reduce((s,a)=>s+Number(a.project_price||0),0));
  $('dashSaving').textContent=money(state.assessments.reduce((s,a)=>s+Number(a.monthly_saving||0),0));
  $('recentList').innerHTML=state.assessments.length?state.assessments.slice(0,5).map(a=>`<div class="item"><div><b>${esc(a.customer_name)}</b><span>${Number(a.recommended_kwp||0).toFixed(2)} kWp • ${money(a.project_price)}</span></div><span class="tag">${a.payback_year?a.payback_year+' ปี':'-'}</span></div>`).join(''):'<div class="empty">ยังไม่มีงานประเมิน</div>';
}

function renderEquipment(){
  const el=$('equipmentList');
  if(!state.equipment.length){el.innerHTML='<div class="empty">ยังไม่มีอุปกรณ์</div>';return}
  el.innerHTML=state.equipment.map(x=>`<div class="item">
    <div><small>${x.category}</small><b>${esc(x.brand)} ${esc(x.model)}</b><span>${x.panel_wp?x.panel_wp+' Wp':x.power_kw?x.power_kw+' kW':x.capacity_kwh?x.capacity_kwh+' kWh':'-'} • ${money(x.sell_price)}</span></div>
    <div class="item-actions">${supabase?`<button class="btn secondary small" onclick="window.editEquipment('${x.id}')">แก้ไข</button><button class="btn danger small" onclick="window.deleteEquipment('${x.id}')">ลบ</button>`:''}</div>
  </div>`).join('');
}
$('equipmentForm').addEventListener('submit',async e=>{
  e.preventDefault(); if(!supabase){alert('ยังไม่ได้เชื่อม Supabase');return}
  const payload={category:$('eqCategory').value,brand:$('eqBrand').value.trim(),model:$('eqModel').value.trim(),
    panel_wp:$('eqPanelWp').value?Number($('eqPanelWp').value):null,power_kw:$('eqPowerKw').value?Number($('eqPowerKw').value):null,
    capacity_kwh:$('eqCapacityKwh').value?Number($('eqCapacityKwh').value):null,phase:$('eqPhase').value||null,system_type:$('eqSystemType').value||null,
    cost:Number($('eqCost').value)||0,sell_price:Number($('eqSellPrice').value)||0,active:true};
  let res=state.editingEquipmentId?await supabase.from('equipment').update(payload).eq('id',state.editingEquipmentId):await supabase.from('equipment').insert(payload);
  if(res.error)alert(res.error.message);else{resetEquipmentForm();await loadEquipment()}
});
window.editEquipment=id=>{
  const x=state.equipment.find(i=>i.id===id); if(!x)return; state.editingEquipmentId=id; $('equipmentFormTitle').textContent='แก้ไขอุปกรณ์';
  $('eqCategory').value=x.category;$('eqBrand').value=x.brand;$('eqModel').value=x.model;$('eqPanelWp').value=x.panel_wp??'';$('eqPowerKw').value=x.power_kw??'';
  $('eqCapacityKwh').value=x.capacity_kwh??'';$('eqPhase').value=x.phase??'';$('eqSystemType').value=x.system_type??'';$('eqCost').value=x.cost??0;$('eqSellPrice').value=x.sell_price??0;
};
window.deleteEquipment=async id=>{if(!supabase||!confirm('ยืนยันลบอุปกรณ์?'))return;const{error}=await supabase.from('equipment').delete().eq('id',id);if(error)alert(error.message);else await loadEquipment()};
function resetEquipmentForm(){state.editingEquipmentId=null;$('equipmentFormTitle').textContent='เพิ่มอุปกรณ์';$('equipmentForm').reset()}
$('eqCancelBtn').addEventListener('click',resetEquipmentForm);

$('calcBtn').addEventListener('click',runCalculation);
$('saveBtn').addEventListener('click',saveAssessment);
$('printBtn').addEventListener('click',()=>{runCalculation();window.print()});
$('refreshEquipmentBtn').addEventListener('click',loadEquipment);
$('refreshHistoryBtn').addEventListener('click',loadAssessments);

await loadEquipment();
await loadAssessments();
runCalculation();
