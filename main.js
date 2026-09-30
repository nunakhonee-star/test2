import './style.css'
import { supabase, isSupabaseConfigured } from './lib/supabase.js'
import { calculateSolar, chooseClosest } from './lib/calc.js'

const state = { equipment: [], editingId: null }

const app = document.querySelector('#app')
app.innerHTML = `
<div class="layout">
  <aside class="sidebar">
    <div class="logo"><span>☀</span><div><b>Solar Office</b><small>Calculator V1</small></div></div>
    <nav>
      <button data-page="calculator" class="nav active">⌁ <span>คำนวณระบบ</span></button>
      <button data-page="equipment" class="nav">▦ <span>จัดการอุปกรณ์</span></button>
      <button data-page="setup" class="nav">⚙ <span>สถานะระบบ</span></button>
    </nav>
  </aside>

  <main class="main">
    <section id="calculator" class="page active">
      <div class="topbar">
        <div><small class="eyebrow">SOLAR SYSTEM SIZING</small><h1>ประเมินระบบโซลาร์เบื้องต้น</h1></div>
        <span class="badge">Mobile + Desktop</span>
      </div>

      <div class="two-col">
        <div class="card">
          <h2>ข้อมูลลูกค้าและการใช้ไฟ</h2>
          <div class="form-grid">
            <label>ชื่อลูกค้า<input id="customerName" placeholder="เช่น คุณสมชาย / บริษัท ABC"></label>
            <label>ประเภทระบบ
              <select id="systemType"><option>On-Grid</option><option>Hybrid</option></select>
            </label>
            <label>หน่วยไฟเฉลี่ยต่อเดือน (kWh)<input id="monthlyKwh" type="number" value="1200"></label>
            <label>ใช้ไฟช่วงกลางวัน (%)<input id="daytimePercent" type="number" value="70" min="0" max="100"></label>
            <label>กำลังแผงที่ต้องการใช้ (Wp)<input id="panelWp" type="number" value="580"></label>
            <label>ผลผลิตสมมติ (kWh/kWp/เดือน)<input id="yieldPerKwpMonth" type="number" value="125"></label>
            <label>ค่าไฟเฉลี่ย (บาท/kWh)<input id="tariff" type="number" step="0.01" value="4.20"></label>
            <label>พลังงานสำรองที่โหลดต้องใช้ (kWh)<input id="requestedBackupKwh" type="number" step="0.1" value="0"></label>
          </div>
          <button id="calculateBtn" class="primary">คำนวณและแนะนำอุปกรณ์</button>
          <p class="note">V1 เป็นการประเมินเบื้องต้น ไม่ใช่แบบวิศวกรรมสำหรับติดตั้งจริง ต้องตรวจโหลด หน้างาน หลังคา เงาบัง String, Voc/Vmp/Current, MPPT, Protection และ Datasheet ก่อนเสนอแบบสุดท้าย</p>
        </div>

        <div class="card result-card">
          <div class="result-head"><h2>ผลประเมิน</h2><span id="resultStatus">พร้อมคำนวณ</span></div>
          <div class="big-result"><strong id="installedKwp">—</strong><span>kWp ติดตั้งโดยประมาณ</span></div>
          <div class="metrics">
            <div><b id="panelCount">—</b><span>จำนวนแผง</span></div>
            <div><b id="inverterTarget">—</b><span>Inverter target kW</span></div>
            <div><b id="batteryTarget">—</b><span>Battery nameplate kWh</span></div>
            <div><b id="monthlyGeneration">—</b><span>ผลิตไฟ kWh/เดือน</span></div>
            <div><b id="monthlySaving">—</b><span>ประหยัดประมาณ/เดือน</span></div>
            <div><b id="daytimeLoad">—</b><span>โหลดกลางวัน kWh/เดือน</span></div>
          </div>
          <div class="recommend">
            <h3>อุปกรณ์จากฐานข้อมูล</h3>
            <div id="recommendedEquipment" class="recommend-list">ยังไม่มีผลคำนวณ</div>
          </div>
        </div>
      </div>
    </section>

    <section id="equipment" class="page">
      <div class="topbar">
        <div><small class="eyebrow">ADMIN</small><h1>จัดการอุปกรณ์</h1></div>
        <button id="refreshBtn" class="secondary">รีเฟรชข้อมูล</button>
      </div>
      <div class="two-col admin-grid">
        <div class="card">
          <h2 id="formTitle">เพิ่มอุปกรณ์</h2>
          <form id="equipmentForm" class="form-grid">
            <label>ประเภท<select id="category" required><option value="panel">แผง Solar</option><option value="inverter">Inverter</option><option value="battery">Battery</option></select></label>
            <label>ยี่ห้อ<input id="brand" required></label>
            <label>รุ่น<input id="model" required></label>
            <label>กำลัง Inverter (kW)<input id="powerKw" type="number" step="0.01"></label>
            <label>กำลังแผง (Wp)<input id="equipmentPanelWp" type="number"></label>
            <label>ความจุ Battery (kWh)<input id="capacityKwh" type="number" step="0.01"></label>
            <label>เฟส<select id="phase"><option value="">ไม่ระบุ</option><option>1 Phase</option><option>3 Phase</option></select></label>
            <label>ประเภทระบบ<select id="equipmentSystemType"><option value="">ไม่ระบุ</option><option>On-Grid</option><option>Hybrid</option></select></label>
            <label>ต้นทุน (บาท)<input id="cost" type="number" step="0.01"></label>
            <label>ราคาขาย (บาท)<input id="sellPrice" type="number" step="0.01"></label>
            <label class="check"><input id="active" type="checkbox" checked> เปิดใช้งาน</label>
            <div class="actions"><button class="primary" type="submit">บันทึก</button><button id="cancelEdit" class="secondary" type="button">ล้างฟอร์ม</button></div>
          </form>
        </div>
        <div class="card">
          <h2>รายการอุปกรณ์</h2>
          <div id="equipmentList" class="equipment-list"></div>
        </div>
      </div>
    </section>

    <section id="setup" class="page">
      <div class="topbar"><div><small class="eyebrow">SYSTEM</small><h1>สถานะระบบ</h1></div></div>
      <div class="card status-card">
        <div><span>Supabase Environment</span><b class="${isSupabaseConfigured ? 'ok':'warn'}">${isSupabaseConfigured ? 'ตั้งค่าแล้ว' : 'ยังไม่ได้ตั้งค่า'}</b></div>
        <div><span>จำนวนอุปกรณ์ที่โหลด</span><b id="equipmentCount">0</b></div>
        <p>หากยังไม่ตั้งค่า Supabase ให้ทำตามไฟล์ INSTALL_GUIDE_TH.md ในแพ็กดาวน์โหลด</p>
      </div>
    </section>
  </main>
</div>
<div id="toast" class="toast"></div>
`

const $ = id => document.getElementById(id)
const toast = msg => { $('toast').textContent = msg; $('toast').classList.add('show'); setTimeout(()=> $('toast').classList.remove('show'), 2200) }
const money = n => new Intl.NumberFormat('th-TH', { style:'currency', currency:'THB', maximumFractionDigits:0 }).format(n || 0)

document.querySelectorAll('.nav').forEach(btn => btn.addEventListener('click', () => {
  document.querySelectorAll('.nav,.page').forEach(x => x.classList.remove('active'))
  btn.classList.add('active')
  $(btn.dataset.page).classList.add('active')
}))

async function loadEquipment(){
  if(!supabase){
    state.equipment = demoEquipment()
    renderEquipment()
    $('equipmentCount').textContent = state.equipment.length + ' (Demo)'
    return
  }
  const { data, error } = await supabase.from('equipment').select('*').order('category').order('brand')
  if(error){ toast('โหลดอุปกรณ์ไม่สำเร็จ: ' + error.message); return }
  state.equipment = data || []
  $('equipmentCount').textContent = state.equipment.length
  renderEquipment()
}

function demoEquipment(){
  return [
    {id:'demo-p1',category:'panel',brand:'Demo Solar',model:'580W',panel_wp:580,sell_price:3200,active:true},
    {id:'demo-i1',category:'inverter',brand:'Demo Inverter',model:'10K',power_kw:10,sell_price:45000,active:true,system_type:'Hybrid'},
    {id:'demo-b1',category:'battery',brand:'Demo Battery',model:'15kWh',capacity_kwh:15,sell_price:99000,active:true}
  ]
}

function renderEquipment(){
  const el = $('equipmentList')
  if(!state.equipment.length){ el.innerHTML = '<div class="empty">ยังไม่มีอุปกรณ์</div>'; return }
  el.innerHTML = state.equipment.map(x => `
    <article class="equipment-item">
      <div><small>${x.category.toUpperCase()}</small><b>${escapeHtml(x.brand)} ${escapeHtml(x.model)}</b>
      <span>${x.panel_wp ? x.panel_wp+' Wp' : ''}${x.power_kw ? x.power_kw+' kW' : ''}${x.capacity_kwh ? x.capacity_kwh+' kWh' : ''}</span></div>
      <div class="item-actions"><span>${money(x.sell_price)}</span>
      ${supabase ? `<button onclick="window.editEquipment('${x.id}')">แก้ไข</button><button class="danger" onclick="window.deleteEquipment('${x.id}')">ลบ</button>` : ''}</div>
    </article>`).join('')
}

function escapeHtml(v=''){ return String(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])) }

$('calculateBtn').addEventListener('click', () => {
  const r = calculateSolar({
    monthlyKwh: $('monthlyKwh').value,
    daytimePercent: $('daytimePercent').value,
    panelWp: $('panelWp').value,
    yieldPerKwpMonth: $('yieldPerKwpMonth').value,
    tariff: $('tariff').value,
    requestedBackupKwh: $('requestedBackupKwh').value,
    batteryDod: 0.9
  })
  $('installedKwp').textContent = r.installedKwp.toFixed(2)
  $('panelCount').textContent = r.panelCount
  $('inverterTarget').textContent = r.inverterKwTarget.toFixed(1)
  $('batteryTarget').textContent = r.batteryNameplateKwh.toFixed(1)
  $('monthlyGeneration').textContent = r.estimatedMonthlyGeneration.toFixed(0)
  $('monthlySaving').textContent = money(r.estimatedMonthlySaving)
  $('daytimeLoad').textContent = r.daytimeKwh.toFixed(0)
  $('resultStatus').textContent = 'ประเมินแล้ว'

  const panel = chooseClosest(state.equipment, 'panel_wp', Number($('panelWp').value), 'panel')
  const inv = chooseClosest(state.equipment, 'power_kw', r.inverterKwTarget, 'inverter')
  const bat = r.batteryNameplateKwh > 0 ? chooseClosest(state.equipment, 'capacity_kwh', r.batteryNameplateKwh, 'battery') : null

  $('recommendedEquipment').innerHTML = [
    panel ? `แผง: <b>${escapeHtml(panel.brand)} ${escapeHtml(panel.model)}</b> × ${r.panelCount}` : 'แผง: ยังไม่มีรุ่นที่ตรงในฐานข้อมูล',
    inv ? `Inverter ใกล้เคียง: <b>${escapeHtml(inv.brand)} ${escapeHtml(inv.model)}</b> (${inv.power_kw} kW)` : 'Inverter: ยังไม่มีรุ่นในฐานข้อมูล',
    r.batteryNameplateKwh > 0 ? (bat ? `Battery ใกล้เคียง: <b>${escapeHtml(bat.brand)} ${escapeHtml(bat.model)}</b> (${bat.capacity_kwh} kWh)` : 'Battery: ยังไม่มีรุ่นในฐานข้อมูล') : 'Battery: ไม่ได้ขอไฟสำรอง'
  ].map(x=>`<div>${x}</div>`).join('')
})

$('equipmentForm').addEventListener('submit', async e => {
  e.preventDefault()
  if(!supabase){ toast('โหมด Demo: ตั้งค่า Supabase ก่อนบันทึกจริง'); return }
  const payload = {
    category: $('category').value, brand: $('brand').value.trim(), model: $('model').value.trim(),
    power_kw: valOrNull($('powerKw').value), panel_wp: valOrNull($('equipmentPanelWp').value),
    capacity_kwh: valOrNull($('capacityKwh').value), phase: $('phase').value || null,
    system_type: $('equipmentSystemType').value || null, cost: Number($('cost').value)||0,
    sell_price: Number($('sellPrice').value)||0, active: $('active').checked
  }
  let res
  if(state.editingId) res = await supabase.from('equipment').update(payload).eq('id', state.editingId)
  else res = await supabase.from('equipment').insert(payload)
  if(res.error){ toast(res.error.message); return }
  resetForm(); await loadEquipment(); toast('บันทึกอุปกรณ์แล้ว')
})

function valOrNull(v){ return v === '' ? null : Number(v) }

window.editEquipment = id => {
  const x = state.equipment.find(i=>i.id===id); if(!x) return
  state.editingId=id; $('formTitle').textContent='แก้ไขอุปกรณ์'
  $('category').value=x.category; $('brand').value=x.brand; $('model').value=x.model
  $('powerKw').value=x.power_kw ?? ''; $('equipmentPanelWp').value=x.panel_wp ?? ''
  $('capacityKwh').value=x.capacity_kwh ?? ''; $('phase').value=x.phase ?? ''
  $('equipmentSystemType').value=x.system_type ?? ''; $('cost').value=x.cost ?? 0
  $('sellPrice').value=x.sell_price ?? 0; $('active').checked=x.active !== false
  document.querySelector('[data-page="equipment"]').click()
  window.scrollTo({top:0,behavior:'smooth'})
}

window.deleteEquipment = async id => {
  if(!supabase || !confirm('ยืนยันลบอุปกรณ์นี้?')) return
  const { error } = await supabase.from('equipment').delete().eq('id',id)
  if(error){ toast(error.message); return }
  await loadEquipment(); toast('ลบแล้ว')
}

function resetForm(){
  state.editingId=null; $('formTitle').textContent='เพิ่มอุปกรณ์'; $('equipmentForm').reset(); $('active').checked=true
}
$('cancelEdit').addEventListener('click',resetForm)
$('refreshBtn').addEventListener('click',loadEquipment)

loadEquipment()
