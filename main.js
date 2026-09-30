import { calculateSolar, chooseClosest } from './calc.js';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

let supabase = null;
let configured = Boolean(SUPABASE_URL && SUPABASE_KEY);

if (configured) {
  const mod = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
  supabase = mod.createClient(SUPABASE_URL, SUPABASE_KEY);
}

const state = { equipment: [] };
const app = document.getElementById('app');

app.innerHTML = `
<div class="wrap">
  <header>
    <div>
      <div class="eyebrow">SOLAR OFFICE CALCULATOR</div>
      <h1>ประเมินระบบโซลาร์เบื้องต้น</h1>
      <p>ใช้งานได้ทั้งมือถือและคอมพิวเตอร์</p>
    </div>
    <div class="status ${configured ? 'ok':'demo'}">${configured ? 'Supabase พร้อมใช้งาน' : 'Demo Mode'}</div>
  </header>

  <div class="grid">
    <section class="card">
      <h2>ข้อมูลการใช้ไฟ</h2>
      <label>ค่าไฟเฉลี่ยต่อเดือน (kWh)<input id="monthlyKwh" type="number" value="1200"></label>
      <label>ใช้ไฟช่วงกลางวัน (%)<input id="daytimePercent" type="number" value="70"></label>
      <label>กำลังแผง (Wp)<input id="panelWp" type="number" value="580"></label>
      <label>ผลผลิตสมมติ (kWh/kWp/เดือน)<input id="yieldPerKwpMonth" type="number" value="125"></label>
      <label>ค่าไฟเฉลี่ย (บาท/kWh)<input id="tariff" type="number" step="0.01" value="4.20"></label>
      <label>พลังงานสำรองที่ต้องการ (kWh)<input id="requestedBackupKwh" type="number" step="0.1" value="0"></label>
      <button id="calcBtn">คำนวณ</button>
    </section>

    <section class="card">
      <h2>ผลประเมิน</h2>
      <div class="hero"><b id="installedKwp">—</b><span>kWp</span></div>
      <div class="stats">
        <div><b id="panelCount">—</b><span>จำนวนแผง</span></div>
        <div><b id="invTarget">—</b><span>Inverter target kW</span></div>
        <div><b id="batTarget">—</b><span>Battery kWh</span></div>
        <div><b id="generation">—</b><span>ผลิตไฟ/เดือน</span></div>
        <div><b id="saving">—</b><span>ประหยัด/เดือน</span></div>
      </div>
      <div id="recommend" class="recommend"></div>
    </section>
  </div>

  <section class="card admin">
    <div class="admin-head">
      <h2>จัดการอุปกรณ์</h2>
      <small>${configured ? 'ข้อมูลบันทึกลง Supabase' : 'ตอนนี้เป็นข้อมูลตัวอย่าง'}</small>
    </div>

    <div class="admin-grid">
      <form id="equipmentForm">
        <label>ประเภท
          <select id="category">
            <option value="panel">แผง Solar</option>
            <option value="inverter">Inverter</option>
            <option value="battery">Battery</option>
          </select>
        </label>
        <label>ยี่ห้อ<input id="brand" required></label>
        <label>รุ่น<input id="model" required></label>
        <label>กำลังแผง Wp<input id="eqPanelWp" type="number"></label>
        <label>กำลัง Inverter kW<input id="powerKw" type="number" step="0.1"></label>
        <label>Battery kWh<input id="capacityKwh" type="number" step="0.1"></label>
        <label>ราคาขาย<input id="sellPrice" type="number" step="0.01"></label>
        <button type="submit">เพิ่มอุปกรณ์</button>
      </form>
      <div id="equipmentList"></div>
    </div>
  </section>

  <p class="warning">ผลลัพธ์เป็นการประเมินเบื้องต้น ต้องตรวจหน้างาน โหลดจริง String, MPPT, Voc/Vmp/Current, Protection และ Datasheet ก่อนติดตั้งจริง</p>
</div>
`;

const $ = id => document.getElementById(id);
const money = n => new Intl.NumberFormat('th-TH', {style:'currency', currency:'THB', maximumFractionDigits:0}).format(n || 0);

function demoEquipment(){
  return [
    {id:'p1', category:'panel', brand:'Demo Solar', model:'580W', panel_wp:580, sell_price:3200, active:true},
    {id:'i1', category:'inverter', brand:'Demo Inverter', model:'10K', power_kw:10, sell_price:45000, active:true},
    {id:'b1', category:'battery', brand:'Demo Battery', model:'15kWh', capacity_kwh:15, sell_price:99000, active:true}
  ];
}

async function loadEquipment(){
  if(!supabase){
    state.equipment = demoEquipment();
  } else {
    const { data, error } = await supabase.from('equipment').select('*').order('category').order('brand');
    if(error){
      alert('โหลดข้อมูล Supabase ไม่สำเร็จ: ' + error.message);
      state.equipment = demoEquipment();
    } else {
      state.equipment = data || [];
    }
  }
  renderEquipment();
}

function renderEquipment(){
  $('equipmentList').innerHTML = state.equipment.length
    ? state.equipment.map(x => `
      <div class="item">
        <div><b>${x.brand} ${x.model}</b><small>${x.category}</small></div>
        <span>${money(x.sell_price)}</span>
      </div>`).join('')
    : '<p>ยังไม่มีอุปกรณ์</p>';
}

$('calcBtn').addEventListener('click', () => {
  const r = calculateSolar({
    monthlyKwh: $('monthlyKwh').value,
    daytimePercent: $('daytimePercent').value,
    panelWp: $('panelWp').value,
    yieldPerKwpMonth: $('yieldPerKwpMonth').value,
    tariff: $('tariff').value,
    requestedBackupKwh: $('requestedBackupKwh').value,
    batteryDod: 0.9
  });

  $('installedKwp').textContent = r.installedKwp.toFixed(2);
  $('panelCount').textContent = r.panelCount;
  $('invTarget').textContent = r.inverterKwTarget.toFixed(1);
  $('batTarget').textContent = r.batteryNameplateKwh.toFixed(1);
  $('generation').textContent = r.estimatedMonthlyGeneration.toFixed(0) + ' kWh';
  $('saving').textContent = money(r.estimatedMonthlySaving);

  const panel = chooseClosest(state.equipment, 'panel_wp', Number($('panelWp').value), 'panel');
  const inv = chooseClosest(state.equipment, 'power_kw', r.inverterKwTarget, 'inverter');
  const bat = r.batteryNameplateKwh > 0 ? chooseClosest(state.equipment, 'capacity_kwh', r.batteryNameplateKwh, 'battery') : null;

  $('recommend').innerHTML = `
    <h3>อุปกรณ์ใกล้เคียง</h3>
    <p>แผง: ${panel ? `<b>${panel.brand} ${panel.model}</b>` : 'ยังไม่มี'}</p>
    <p>Inverter: ${inv ? `<b>${inv.brand} ${inv.model}</b>` : 'ยังไม่มี'}</p>
    <p>Battery: ${r.batteryNameplateKwh > 0 ? (bat ? `<b>${bat.brand} ${bat.model}</b>` : 'ยังไม่มี') : 'ไม่ใช้แบต'}</p>
  `;
});

$('equipmentForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  if(!supabase){
    alert('ตอนนี้เป็น Demo Mode ถ้าต้องการบันทึกจริง ให้ใส่ค่า Supabase ในไฟล์ config.js ก่อน');
    return;
  }

  const payload = {
    category: $('category').value,
    brand: $('brand').value.trim(),
    model: $('model').value.trim(),
    panel_wp: $('eqPanelWp').value ? Number($('eqPanelWp').value) : null,
    power_kw: $('powerKw').value ? Number($('powerKw').value) : null,
    capacity_kwh: $('capacityKwh').value ? Number($('capacityKwh').value) : null,
    sell_price: Number($('sellPrice').value || 0),
    active: true
  };

  const { error } = await supabase.from('equipment').insert(payload);
  if(error) alert('บันทึกไม่สำเร็จ: ' + error.message);
  else {
    $('equipmentForm').reset();
    await loadEquipment();
    alert('เพิ่มอุปกรณ์แล้ว');
  }
});

loadEquipment();
$('calcBtn').click();


