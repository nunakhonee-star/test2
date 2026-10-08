import {
  DEFAULT_PRICING,
  normalizePricing,
  backupFromAppliances,
  toCalcAppliance,
  designSystem
} from './calc.js';

import {
  SUPABASE_URL,
  SUPABASE_KEY
} from './config.js';


let supabase = null;

if (
  SUPABASE_URL &&
  SUPABASE_KEY
) {
  try {
    const module =
      await import(
        'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm'
      );

    supabase =
      module.createClient(
        SUPABASE_URL,
        SUPABASE_KEY
      );
  } catch (error) {
    console.warn(
      'Supabase โหลดไม่ได้',
      error
    );
  }
}


const state = {
  equipment: [],
  assessments: [],
  appliances: [],
  apQty: {},
  apNote: '',
  pricing: {
    ...DEFAULT_PRICING
  },
  editEq: null,
  editAp: null,
  last: null
};


const $ =
  id =>
    document.getElementById(id);


const num =
  id =>
    Number(
      $(id).value ||
      0
    );


const radio =
  name =>
    document.querySelector(
      `input[name="${name}"]:checked`
    )?.value;


const money =
  value =>
    new Intl.NumberFormat(
      'th-TH',
      {
        style: 'currency',
        currency: 'THB',
        maximumFractionDigits: 0
      }
    ).format(
      Number(
        value ||
        0
      )
    );


const esc =
  value =>
    String(
      value ??
      ''
    ).replace(
      /[&<>"']/g,
      char =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;'
        })[char]
    );


const seg =
  (
    name,
    options
  ) =>
    `
      <div class="seg">
        ${options.map(
          (
            [value, label],
            index
          ) =>
            `
              <label>
                <input
                  type="radio"
                  name="${name}"
                  value="${value}"
                  ${index ? '' : 'checked'}
                >
                <span>
                  ${label}
                </span>
              </label>
            `
        ).join('')}
      </div>
    `;


const CAT = {
  panel: 'แผงโซลาร์',
  inverter: 'Inverter',
  battery: 'แบตเตอรี่'
};


const UNIT = {
  panel: 'แผง',
  inverter: 'ตัว',
  battery: 'ลูก'
};


const spec =
  item =>
    item.panel_wp
      ? `${item.panel_wp} Wp`
      : item.power_kw
        ? `${item.power_kw} kW`
        : item.capacity_kwh
          ? `${item.capacity_kwh} kWh`
          : '';


/* ==========================================
   โครงหน้า
========================================== */

$('app').innerHTML = `
<header class="top">

  <div class="brand">
    <span class="mark">☀</span>
    <b>Solar Office Pro</b>
  </div>

  <nav class="nav">
    ${
      [
        [
          'calculator',
          'ประเมินระบบ'
        ],
        [
          'history',
          'ประวัติลูกค้า'
        ],
        [
          'equipment',
          'ฐานข้อมูลอุปกรณ์'
        ],
        [
          'appliances',
          'โหลดสำรอง'
        ],
        [
          'pricing',
          'ราคาติดตั้ง'
        ]
      ]
        .map(
          (
            [id, label],
            index
          ) =>
            `
              <button
                data-page="${id}"
                class="${index ? '' : 'active'}"
              >
                ${label}
              </button>
            `
        )
        .join('')
    }
  </nav>

  <span class="mode">
    ${
      supabase
        ? 'เชื่อมต่อ Supabase'
        : 'ยังไม่ได้เชื่อม Supabase'
    }
  </span>

</header>


<main>

<section
  id="calculator"
  class="page active"
>

<div class="calc">

<div
  class="inputs"
  id="inputs"
>

<section class="step">

  <h2>
    ลูกค้าและประเภทงาน
  </h2>

  <div class="grid3">

    <label>
      ชื่อลูกค้า

      <input
        id="customerName"
        placeholder="คุณสมชาย / บริษัท ABC"
      >
    </label>

    <label>
      เบอร์โทร

      <input
        id="phone"
        inputmode="tel"
      >
    </label>

    <label>
      สถานที่ / โครงการ

      <input
        id="siteName"
      >
    </label>

  </div>


  <div class="grid2">

    <div class="field">

      <span>
        ประเภทระบบ
      </span>

      ${
        seg(
          'systemType',
          [
            [
              'On-Grid',
              'On-Grid'
            ],
            [
              'Hybrid',
              'Hybrid (มีแบตเตอรี่)'
            ]
          ]
        )
      }

    </div>


    <div class="field">

      <span>
        ประเมินจาก
      </span>

      ${
        seg(
          'calcMode',
          [
            [
              'usage',
              'การใช้ไฟ'
            ],
            [
              'budget',
              'งบประมาณ'
            ]
          ]
        )
      }

    </div>

  </div>

</section>


<section class="step">

  <h2>
    การใช้ไฟและงบประมาณ
  </h2>

  <div
    id="budgetRow"
    class="grid2"
    hidden
  >

    <label>
      งบประมาณลูกค้า (บาท)

      <input
        id="budgetAmount"
        type="number"
        value="100000"
      >
    </label>

  </div>


  <div class="grid2">

    <label>
      หน่วยไฟต่อเดือน (kWh)

      <input
        id="monthlyKwh"
        type="number"
        value="1200"
      >

      <small>
        เว้นว่างได้
        ระบบจะประมาณจากค่าไฟ
      </small>
    </label>


    <label>
      ค่าไฟต่อเดือน (บาท)

      <input
        id="monthlyBill"
        type="number"
        value="5000"
      >
    </label>


    <label>
      ประเภทผู้ใช้ไฟ

      <select
        id="tariffType"
      >

        <option
          value="residential"
        >
          บ้านอยู่อาศัย
        </option>

        <option
          value="business"
        >
          ธุรกิจทั่วไป
        </option>

        <option
          value="industrial"
        >
          โรงงาน / อุตสาหกรรม
        </option>

      </select>
    </label>


    <label>
      ใช้ไฟช่วงกลางวัน (%)

      <input
        id="daytimePercent"
        type="number"
        min="0"
        max="100"
        value="70"
      >
    </label>

  </div>


  <p
    class="hint"
    id="usageNote"
  ></p>

</section>


<section
  class="step"
  id="backupStep"
  hidden
>

  <h2>
    โหลดสำรอง (Hybrid)
  </h2>


  <div class="row-between">

    <label class="inline">

      สำรองไฟนาน (ชั่วโมง)

      <input
        id="backupHours"
        type="number"
        step="0.5"
        min="0"
        value="5"
      >

    </label>


    <button
      type="button"
      class="link"
      data-go="appliances"
    >
      จัดการรายการโหลด
    </button>

  </div>


  <div
    id="applianceList"
    class="ap-list"
  ></div>


  <div class="figures">

    <div>
      <span>
        โหลดต่อเนื่อง
      </span>

      <b id="bkCont">
        —
      </b>
    </div>

    <div>
      <span>
        โหลดสูงสุด (Surge)
      </span>

      <b id="bkSurge">
        —
      </b>
    </div>

    <div>
      <span>
        แบตเตอรี่ที่ต้องใช้
      </span>

      <b id="bkBat">
        —
      </b>
    </div>

  </div>

</section>


<section class="step">

  <h2>
    อุปกรณ์ที่ติดตั้ง
  </h2>

  <p class="hint">
    เลือกรุ่นและกรอกจำนวนเองได้
    ถ้าเลือก “อัตโนมัติ”
    หรือเว้นจำนวนว่าง
    ระบบจะเลือกให้ตามข้อมูลด้านบน
  </p>

  ${
    Object
      .keys(CAT)
      .map(
        category =>
          `
            <div
              class="eq-row"
              id="row_${category}"
            >

              <span class="eq-name">
                ${CAT[category]}
              </span>

              <select
                id="sel_${category}"
                aria-label="${CAT[category]}"
              ></select>

              <label class="qty">

                <input
                  id="qty_${category}"
                  type="number"
                  min="0"
                  step="1"
                  placeholder="อัตโนมัติ"
                  aria-label="จำนวน${CAT[category]}"
                >

                <span>
                  ${UNIT[category]}
                </span>

              </label>

            </div>
          `
      )
      .join('')
  }

</section>


<section class="step">

  <h2>
    หมายเหตุ
  </h2>

  <textarea
    id="notes"
    placeholder="รายละเอียดเพิ่มเติม (ไม่บังคับ)"
  ></textarea>

  <div class="actions">

    <button
      class="btn primary"
      id="saveBtn"
    >
      บันทึกการประเมิน
    </button>

    <button
      class="btn"
      id="printBtn"
    >
      พิมพ์ / PDF
    </button>

  </div>

</section>

</div>


<aside
  class="result"
  id="result"
>

<div
  id="resultEmpty"
  class="empty"
  hidden
></div>


<div id="resultBody">

  <div class="headline">

    <span>
      ราคาโครงการรวม
      (รวม VAT)
    </span>

    <b id="rTotal">
      —
    </b>

    <small id="rSystem">
      —
    </small>

  </div>


  <div class="trio">

    <div>

      <span>
        ประหยัดค่าไฟ / เดือน
      </span>

      <b id="rSave">
        —
      </b>

    </div>


    <div>

      <span>
        คืนทุน
      </span>

      <b id="rPay">
        —
      </b>

    </div>


    <div>

      <span>
        กำไรสุทธิ 25 ปี
      </span>

      <b id="rProfit">
        —
      </b>

    </div>

  </div>


  <div id="rWarn"></div>


  <section class="panel">

    <h3>
      อุปกรณ์และค่าใช้จ่าย
    </h3>

    <div class="table-wrap">

      <table class="cost">

        <thead>

          <tr>

            <th>
              รายการ
            </th>

            <th class="r">
              จำนวน
            </th>

            <th class="r">
              จำนวนเงิน
            </th>

          </tr>

        </thead>

        <tbody
          id="rCost"
        ></tbody>

      </table>

    </div>

  </section>


  <section class="panel">

    <h3>
      การผลิตไฟฟ้า
    </h3>

    <dl
      class="specs"
      id="rGen"
    ></dl>

  </section>


  <section class="panel">

    <h3>
      ผลตอบแทน 25 ปี
    </h3>

    <dl
      class="specs"
      id="rEco"
    ></dl>

    <div
      class="chart-wrap"
      id="chart"
    ></div>

  </section>

</div>

</aside>

</div>

</section>


<section
  id="history"
  class="page"
>

  <div class="head">

    <h1>
      ประวัติการประเมิน
    </h1>

    <button
      class="btn"
      id="refreshHistoryBtn"
    >
      รีเฟรช
    </button>

  </div>


  <div
    class="figures big"
    id="histStats"
  ></div>


  <div class="panel">

    <div class="table-wrap">

      <table class="cost">

        <thead>

          <tr>

            <th>
              วันที่
            </th>

            <th>
              ลูกค้า
            </th>

            <th>
              ระบบ
            </th>

            <th class="r">
              kWp
            </th>

            <th class="r">
              ราคาโครงการ
            </th>

            <th class="r">
              คืนทุน
            </th>

            <th></th>

          </tr>

        </thead>

        <tbody
          id="historyBody"
        ></tbody>

      </table>

    </div>

  </div>

</section>


<section
  id="equipment"
  class="page"
>

  <div class="head">

    <h1>
      ฐานข้อมูลอุปกรณ์
    </h1>

    <button
      class="btn"
      id="refreshEquipmentBtn"
    >
      รีเฟรช
    </button>

  </div>


  <div class="admin">

    <form
      class="panel form"
      id="equipmentForm"
    >

      <h3
        id="equipmentFormTitle"
      >
        เพิ่มอุปกรณ์
      </h3>


      <label>
        ประเภท

        <select
          id="eqCategory"
        >

          <option
            value="panel"
          >
            แผงโซลาร์
          </option>

          <option
            value="inverter"
          >
            Inverter
          </option>

          <option
            value="battery"
          >
            แบตเตอรี่
          </option>

        </select>
      </label>


      <div class="grid2">

        <label>
          ยี่ห้อ

          <input
            id="eqBrand"
            required
          >
        </label>


        <label>
          รุ่น

          <input
            id="eqModel"
            required
          >
        </label>

      </div>


      <label class="f-panel">

        กำลังแผง (Wp)

        <input
          id="eqPanelWp"
          type="number"
        >

      </label>


      <label class="f-inverter">

        กำลัง Inverter (kW)

        <input
          id="eqPowerKw"
          type="number"
          step="0.1"
        >

      </label>


      <label class="f-battery">

        ความจุ (kWh)

        <input
          id="eqCapacityKwh"
          type="number"
          step="0.1"
        >

      </label>


      <label
        class="f-inverter f-battery"
      >

        ใช้ได้กับระบบ

        <select
          id="eqSystemType"
        >

          <option value="">
            ทุกระบบ
          </option>

          <option>
            On-Grid
          </option>

          <option>
            Hybrid
          </option>

        </select>

      </label>


      <div class="grid2">

        <label>

          ต้นทุน

          <input
            id="eqCost"
            type="number"
          >

        </label>


        <label>

          ราคาขาย

          <input
            id="eqSellPrice"
            type="number"
          >

        </label>

      </div>


      <label class="f-panel">

        ใช้เป็นแผงเริ่มต้น

        <select
          id="eqIsDefault"
        >

          <option
            value="false"
          >
            ไม่ใช่
          </option>

          <option
            value="true"
          >
            ใช่
          </option>

        </select>

      </label>


      <div class="actions">

        <button
          class="btn primary"
          type="submit"
        >
          บันทึก
        </button>

        <button
          class="btn"
          type="button"
          id="eqCancelBtn"
        >
          ล้างฟอร์ม
        </button>

      </div>

    </form>


    <div
      class="panel"
      id="equipmentList"
    ></div>

  </div>

</section>


<section
  id="appliances"
  class="page"
>

  <div class="head">

    <h1>
      โหลดสำรองสำหรับระบบ Hybrid
    </h1>

  </div>


  <p
    class="hint wide"
    id="apNote"
  ></p>


  <div class="admin">

    <form
      class="panel form"
      id="applianceForm"
    >

      <h3
        id="applianceFormTitle"
      >
        เพิ่มเครื่องใช้ไฟฟ้า
      </h3>


      <label>

        ชื่อเครื่องใช้ไฟฟ้า

        <input
          id="apName"
          required
          placeholder="เช่น แอร์ 9,000 BTU"
        >

      </label>


      <label>

        กำลังไฟขณะทำงาน (W)

        <input
          id="apPower"
          type="number"
          min="1"
          required
        >

      </label>


      <label class="check">

        <input
          id="apSurge"
          type="checkbox"
        >

        <span>
          มีไฟกระชากตอนสตาร์ท
          (Surge)
        </span>

      </label>


      <label
        id="apFactorRow"
        hidden
      >

        ตัวคูณ Surge (เท่า)

        <input
          id="apFactor"
          type="number"
          min="1"
          step="0.1"
          value="3"
        >

      </label>


      <div class="actions">

        <button
          class="btn primary"
          type="submit"
        >
          บันทึก
        </button>

        <button
          class="btn"
          type="button"
          id="apCancelBtn"
        >
          ล้างฟอร์ม
        </button>

      </div>

    </form>


    <div
      class="panel"
      id="applianceAdmin"
    ></div>

  </div>

</section>


<section
  id="pricing"
  class="page"
>

  <div class="head">

    <h1>
      ราคาติดตั้ง
    </h1>

    <button
      class="btn"
      id="loadPricingBtn"
    >
      รีเฟรช
    </button>

  </div>


  <form
    class="panel form narrow"
    id="pricingForm"
  >

    <p class="hint">
      ใช้คำนวณราคาโครงการ
      ทั้งโหมดการใช้ไฟ
      และโหมดงบประมาณ
    </p>


    <div class="grid2">

      <label>

        ค่าแรงติดตั้ง / kWp

        <input
          id="laborPerKwp"
          type="number"
        >

      </label>


      <label>

        โครงสร้างและราง / kWp

        <input
          id="structurePerKwp"
          type="number"
        >

      </label>


      <label>

        สายไฟและอุปกรณ์ / kWp

        <input
          id="wiringPerKwp"
          type="number"
        >

      </label>


      <label>

        ค่าขนส่ง / เดินทาง

        <input
          id="transportFlat"
          type="number"
        >

      </label>


      <label>

        ค่าดำเนินการ

        <input
          id="adminFlat"
          type="number"
        >

      </label>


      <label>

        Margin (%)

        <input
          id="marginPercent"
          type="number"
        >

      </label>


      <label>

        VAT (%)

        <input
          id="vatPercent"
          type="number"
        >

      </label>

    </div>


    <div class="actions">

      <button
        class="btn primary"
        type="submit"
      >
        บันทึกราคา
      </button>

    </div>

  </form>

</section>

</main>
`;


/* ==========================================
   นำทาง
========================================== */

function showPage(id) {

  document
    .querySelectorAll(
      '.nav button,.page'
    )
    .forEach(
      element =>
        element
          .classList
          .remove(
            'active'
          )
    );


  document
    .querySelector(
      `.nav button[data-page="${id}"]`
    )
    ?.classList
    .add(
      'active'
    );


  $(id)
    .classList
    .add(
      'active'
    );


  scrollTo(
    0,
    0
  );
}


document
  .querySelectorAll(
    '.nav button'
  )
  .forEach(
    button =>
      button.onclick =
        () =>
          showPage(
            button.dataset.page
          )
  );


document
  .querySelectorAll(
    '[data-go]'
  )
  .forEach(
    button =>
      button.onclick =
        () =>
          showPage(
            button.dataset.go
          )
  );


/* ==========================================
   โหลดข้อมูลอุปกรณ์
========================================== */

const demoEquipment =
  () => [
    {
      id: 'p1',
      category: 'panel',
      brand: 'Demo Solar',
      model: '580W Mono',
      panel_wp: 580,
      cost: 2500,
      sell_price: 3200,
      active: true,
      is_default: true
    },

    {
      id: 'i1',
      category: 'inverter',
      brand: 'Demo Inverter',
      model: '6K On Grid',
      power_kw: 6,
      cost: 22000,
      sell_price: 28000,
      active: true,
      system_type: 'On-Grid'
    },

    {
      id: 'i2',
      category: 'inverter',
      brand: 'Demo Inverter',
      model: '10K Hybrid',
      power_kw: 10,
      cost: 35000,
      sell_price: 45000,
      active: true,
      system_type: 'Hybrid'
    },

    {
      id: 'b1',
      category: 'battery',
      brand: 'Demo Battery',
      model: '10kWh LFP',
      capacity_kwh: 10,
      cost: 65000,
      sell_price: 82000,
      active: true,
      system_type: 'Hybrid'
    },

    {
      id: 'b2',
      category: 'battery',
      brand: 'Demo Battery',
      model: '15kWh LFP',
      capacity_kwh: 15,
      cost: 82000,
      sell_price: 99000,
      active: true,
      system_type: 'Hybrid'
    }
  ];


async function loadEquipment() {

  if (!supabase) {

    state.equipment =
      demoEquipment();

  } else {

    const {
      data,
      error
    } =
      await supabase
        .from(
          'equipment'
        )
        .select('*')
        .order(
          'category'
        )
        .order(
          'brand'
        );


    state.equipment =
      error
        ? demoEquipment()
        : (
            data ||
            []
          );
  }


  renderEquipment();

  lastSys = null;

  calc();
}


async function loadAssessments() {

  if (supabase) {

    const {
      data,
      error
    } =
      await supabase
        .from(
          'assessments'
        )
        .select('*')
        .order(
          'created_at',
          {
            ascending:
              false
          }
        );


    state.assessments =
      error
        ? []
        : (
            data ||
            []
          );
  }


  renderHistory();
}


async function loadPricing() {

  if (supabase) {

    const {
      data,
      error
    } =
      await supabase
        .from(
          'pricing_settings'
        )
        .select('*')
        .limit(1)
        .maybeSingle();


    state.pricing =
      normalizePricing(
        error
          ? DEFAULT_PRICING
          : (
              data ||
              DEFAULT_PRICING
            )
      );

  } else {

    state.pricing = {
      ...DEFAULT_PRICING
    };
  }


  const pricing =
    state.pricing;


  [
    [
      'laborPerKwp',
      'labor_per_kwp'
    ],
    [
      'structurePerKwp',
      'structure_per_kwp'
    ],
    [
      'wiringPerKwp',
      'wiring_per_kwp'
    ],
    [
      'transportFlat',
      'transport_flat'
    ],
    [
      'adminFlat',
      'admin_flat'
    ],
    [
      'marginPercent',
      'margin_percent'
    ],
    [
      'vatPercent',
      'vat_percent'
    ]
  ].forEach(
    (
      [id, key]
    ) =>
      $(id).value =
        pricing[key]
  );


  calc();
}


/* ==========================================
   โหลดข้อมูลโหลดสำรองจาก Supabase เท่านั้น
========================================== */

async function loadAppliances() {

  state.apNote = '';


  if (!supabase) {

    state.appliances =
      [];

    state.apNote =
      'ยังไม่ได้เชื่อมต่อ Supabase จึงไม่สามารถโหลดรายการโหลดสำรองได้';


    renderAppliances();

    calc();

    return;
  }


  const {
    data,
    error
  } =
    await supabase
      .from(
        'backup_appliances'
      )
      .select('*')
      .order(
        'sort_order',
        {
          ascending:
            true
        }
      )
      .order(
        'name',
        {
          ascending:
            true
        }
      );


  if (error) {

    console.error(
      'โหลด backup_appliances ไม่สำเร็จ',
      error
    );


    state.appliances =
      [];


    state.apNote =
      'โหลดฐานข้อมูล backup_appliances ไม่สำเร็จ กรุณารันไฟล์ SQL สำหรับสร้างตารางและข้อมูลเริ่มต้นใน Supabase';

  } else {

    state.appliances =
      data ||
      [];
  }


  renderAppliances();

  calc();
}


/* ==========================================
   ตัวเลือกอุปกรณ์ติดตั้ง
========================================== */

let lastSys = null;


function fillSelects() {

  const sys =
    radio(
      'systemType'
    );


  for (
    const category
    of Object.keys(CAT)
  ) {

    const element =
      $(
        'sel_' +
        category
      );


    const keep =
      element.value;


    const list =
      state.equipment.filter(
        item =>
          item.category ===
            category &&
          item.active !==
            false &&
          (
            category ===
              'panel' ||
            !item.system_type ||
            item.system_type ===
              sys
          )
      );


    element.innerHTML =
      '<option value="">อัตโนมัติ</option>' +
      list.map(
        item =>
          `
            <option value="${item.id}">
              ${esc(item.brand)}
              ${esc(item.model)}
              · ${spec(item)}
              · ${money(item.sell_price)}
            </option>
          `
      ).join('');


    element.value =
      list.some(
        item =>
          item.id === keep
      )
        ? keep
        : '';
  }
}


/* ==========================================
   คำนวณ
========================================== */

function calc() {

  const sys =
    radio(
      'systemType'
    );


  const mode =
    radio(
      'calcMode'
    );


  $('budgetRow').hidden =
    mode !==
    'budget';


  $('backupStep').hidden =
    sys !==
    'Hybrid';


  $('row_battery').hidden =
    sys !==
    'Hybrid';


  if (
    sys !==
    lastSys
  ) {

    lastSys =
      sys;

    fillSelects();
  }


  /*
    โหลดสำรองที่ใช้คำนวณ
    ต้องมาจาก Supabase
    และ active = true เท่านั้น
  */
  const backup =
    sys ===
    'Hybrid'
      ? backupFromAppliances(
          state.apQty,

          num(
            'backupHours'
          ),

          state.appliances
            .filter(
              appliance =>
                appliance.active !==
                false
            )
            .map(
              toCalcAppliance
            )
        )
      : {
          continuousKw: 0,
          surgeKw: 0,
          usableKwh: 0,
          batteryKwh: 0,
          items: []
        };


  $('bkCont').textContent =
    backup.continuousKw
      ? backup.continuousKw.toFixed(2) +
        ' kW'
      : '—';


  $('bkSurge').textContent =
    backup.surgeKw
      ? backup.surgeKw.toFixed(2) +
        ' kW'
      : '—';


  $('bkBat').textContent =
    backup.batteryKwh
      ? backup.batteryKwh.toFixed(1) +
        ' kWh'
      : '—';


  const usage = {

    monthlyKwh:
      $('monthlyKwh').value,

    monthlyBill:
      $('monthlyBill').value,

    tariffType:
      $('tariffType').value,

    daytimePercent:
      $('daytimePercent').value
  };


  const selected = {

    panelId:
      $('sel_panel').value,

    panelQty:
      num(
        'qty_panel'
      ),

    invId:
      $('sel_inverter').value,

    invQty:
      num(
        'qty_inverter'
      ),

    batId:
      $('sel_battery').value,

    batQty:
      num(
        'qty_battery'
      )
  };


  const result =
    designSystem({

      mode,

      systemType:
        sys,

      items:
        state.equipment,

      pricing:
        state.pricing,

      backup,

      sel:
        selected,

      budget:
        num(
          'budgetAmount'
        ),

      usage
    });


  if (
    result.error
  ) {

    state.last =
      null;


    $('resultBody').hidden =
      true;


    $('resultEmpty').hidden =
      false;


    $('resultEmpty').textContent =
      result.error;


    $('usageNote').textContent =
      '';


    return;
  }


  $('resultBody').hidden =
    false;


  $('resultEmpty').hidden =
    true;


  state.last = {
    ...result,
    systemType:
      sys,
    calcMode:
      mode,
    backup
  };


  render(
    result,
    sys
  );
}


/* ==========================================
   แสดงผล
========================================== */

function render(
  result,
  sys
) {

  const auto =
    result.auto;


  const equipmentName =
    item =>
      item
        ? `${item.brand} ${item.model}`
        : 'ไม่พบรุ่น';


  $('sel_panel')
    .options[0]
    .textContent =
      `อัตโนมัติ (${equipmentName(auto.panel)})`;


  $('sel_inverter')
    .options[0]
    .textContent =
      `อัตโนมัติ (${equipmentName(auto.inverter)})`;


  if (
    sys ===
    'Hybrid'
  ) {

    $('sel_battery')
      .options[0]
      .textContent =
        auto.battery
          ? `อัตโนมัติ (${equipmentName(auto.battery)})`
          : 'อัตโนมัติ';
  }


  $('qty_panel')
    .placeholder =
      `อัตโนมัติ ${auto.panelQty || ''}`;


  $('qty_inverter')
    .placeholder =
      `อัตโนมัติ ${auto.invQty}`;


  $('qty_battery')
    .placeholder =
      `อัตโนมัติ ${auto.batQty || ''}`;


  $('usageNote').textContent =
    result.usageSource ===
    'actual'
      ? 'ใช้หน่วยไฟจริงจากบิล'
      : result.usageSource ===
        'estimated'
        ? `ประมาณหน่วยไฟจากค่าไฟ ≈ ${result.monthlyKwh.toFixed(0)} kWh/เดือน`
        : 'ยังไม่มีข้อมูลหน่วยไฟ จึงสมมติใช้ไฟเองได้ 80% ของที่ผลิต';


  const payback =
    result.eco.payback
      ? `${result.eco.payback} ปี`
      : 'เกิน 25 ปี';


  const price =
    result.price;


  $('rTotal').textContent =
    money(
      price.total
    );


  $('rSystem').textContent =
    `${sys} · ${result.kwp.toFixed(2)} kWp${
      result.battery
        ? ` · แบตเตอรี่ ${
            (
              result.batQty *
              Number(
                result.battery.capacity_kwh ||
                0
              )
            ).toFixed(1)
          } kWh`
        : ''
    }`;


  $('rSave').textContent =
    money(
      result.saveMonth
    );


  $('rPay').textContent =
    payback;


  $('rProfit').textContent =
    money(
      result.eco.profit25
    );


  $('rWarn').innerHTML =
    result.warnings
      .map(
        warning =>
          `
            <p class="warn">
              ${esc(warning)}
            </p>
          `
      )
      .join('');


  const equipmentRow =
    (
      category,
      item,
      quantity,
      total
    ) =>
      item
        ? `
            <tr>

              <td>

                ${CAT[category]}:
                ${esc(item.brand)}
                ${esc(item.model)}

                <span
                  class="tag ${
                    result.manual[category]
                      ? 'on'
                      : ''
                  }"
                >

                  ${
                    result.manual[category]
                      ? 'เลือกเอง'
                      : 'อัตโนมัติ'
                  }

                </span>

                <small>
                  ${spec(item)}
                  ·
                  ${money(item.sell_price)}
                  /
                  ${UNIT[category]}
                </small>

              </td>

              <td class="r">
                ${quantity}
                ${UNIT[category]}
              </td>

              <td class="r">
                ${money(total)}
              </td>

            </tr>
          `
        : '';


  const priceRow =
    (
      label,
      total,
      className = ''
    ) =>
      `
        <tr class="${className}">

          <td>
            ${label}
          </td>

          <td></td>

          <td class="r">
            ${money(total)}
          </td>

        </tr>
      `;


  $('rCost').innerHTML =

    equipmentRow(
      'panel',
      result.panel,
      result.panelQty,
      price.panelTotal
    )

    +

    equipmentRow(
      'inverter',
      result.inverter,
      result.invQty,
      price.inverterTotal
    )

    +

    equipmentRow(
      'battery',
      result.battery,
      result.batQty,
      price.batteryTotal
    )

    +

    priceRow(
      'รวมค่าอุปกรณ์',
      price.equipment,
      'sub'
    )

    +

    priceRow(
      'ค่าแรงติดตั้ง',
      price.labor
    )

    +

    priceRow(
      'โครงสร้างและราง',
      price.structure
    )

    +

    priceRow(
      'สายไฟและอุปกรณ์ประกอบ',
      price.wiring
    )

    +

    priceRow(
      'ค่าขนส่ง',
      price.transport
    )

    +

    priceRow(
      'ค่าดำเนินการ',
      price.admin
    )

    +

    priceRow(
      'Margin',
      price.margin
    )

    +

    priceRow(
      'VAT',
      price.vat
    )

    +

    priceRow(
      'รวมทั้งสิ้น',
      price.total,
      'total'
    );


  const descriptionList =
    rows =>
      rows.map(
        (
          [label, value]
        ) =>
          `
            <div>

              <dt>
                ${label}
              </dt>

              <dd>
                ${value}
              </dd>

            </div>
          `
      ).join('');


  $('rGen').innerHTML =
    descriptionList(
      [
        [
          'ผลิตต่อวัน',
          `${result.genDay.toFixed(1)} kWh`
        ],
        [
          'ผลิตต่อเดือน',
          `${result.genMonth.toFixed(0)} kWh`
        ],
        [
          'ผลิตต่อปี (ปีแรก)',
          `${result.genYear.toFixed(0)} kWh`
        ],
        [
          'ใช้เองได้',
          `${(result.ratio * 100).toFixed(0)}% ของที่ผลิต`
        ]
      ]
    );


  $('rEco').innerHTML =
    descriptionList(
      [
        [
          'ประหยัดปีแรก',
          money(
            result.saveYear
          )
        ],
        [
          'IRR',
          result.eco.irr ==
          null
            ? '—'
            : result.eco.irr.toFixed(1) +
              '%'
        ],
        [
          'NPV 25 ปี',
          money(
            result.eco.npv
          )
        ],
        [
          'ลด CO₂',
          `${result.co2.toFixed(1)} ตัน/ปี`
        ]
      ]
    );


  renderBar(
    result.eco.points,
    result.eco.payback
  );
}


const shortMoney =
  value => {

    const absolute =
      Math.abs(
        value
      );


    const sign =
      value < 0
        ? '-'
        : '';


    return absolute >=
      1000000
      ? sign +
        (
          absolute /
          1000000
        ).toFixed(1) +
        'ล.'
      : absolute >=
        1000
        ? sign +
          Math.round(
            absolute /
            1000
          ) +
          'k'
        : sign +
          Math.round(
            absolute
          );
  };


function renderBar(
  points,
  payback
) {

  const width =
    640;

  const height =
    260;


  const padding = {
    t: 16,
    r: 10,
    b: 36,
    l: 52
  };


  const values =
    points.map(
      point =>
        point.cumulative
    );


  const minY =
    Math.min(
      ...values,
      0
    );


  const maxY =
    Math.max(
      ...values,
      0
    );


  const span =
    Math.max(
      1,
      maxY -
      minY
    );


  const chartWidth =
    width -
    padding.l -
    padding.r;


  const chartHeight =
    height -
    padding.t -
    padding.b;


  const step =
    chartWidth /
    points.length;


  const barWidth =
    Math.max(
      6,
      step -
      3
    );


  const x =
    index =>
      padding.l +
      index *
      step +
      1;


  const y =
    value =>
      padding.t +
      (
        maxY -
        value
      ) /
      span *
      chartHeight;


  const zero =
    y(0);


  const ticks =
    Array.from(
      {
        length: 5
      },

      (
        _,
        index
      ) =>
        minY +
        (
          maxY -
          minY
        ) *
        index /
        4
    );


  const paybackIndex =
    payback ==
    null
      ? null
      : Math.round(
          payback
        );


  $('chart').innerHTML =
    `
      <svg
        viewBox="0 0 ${width} ${height}"
        class="svg-chart"
        role="img"
        aria-label="กราฟกำไรสะสม"
      >

        ${
          ticks.map(
            value =>
              `
                <line
                  x1="${padding.l}"
                  y1="${y(value)}"
                  x2="${width - padding.r}"
                  y2="${y(value)}"
                  stroke="#e8eeec"
                />

                <text
                  x="${padding.l - 6}"
                  y="${y(value) + 4}"
                  text-anchor="end"
                  class="tick"
                >
                  ${shortMoney(value)}
                </text>
              `
          ).join('')
        }


        <line
          x1="${padding.l}"
          y1="${zero}"
          x2="${width - padding.r}"
          y2="${zero}"
          stroke="#7d8f89"
        />


        ${
          points.map(
            (
              point,
              index
            ) => {

              const top =
                Math.min(
                  zero,
                  y(
                    point.cumulative
                  )
                );


              const barHeight =
                Math.abs(
                  zero -
                  y(
                    point.cumulative
                  )
                );


              return `
                <rect
                  x="${x(index)}"
                  y="${top}"
                  width="${barWidth}"
                  height="${Math.max(1, barHeight)}"
                  rx="2"
                  fill="${
                    point.cumulative >=
                    0
                      ? '#0b7a5f'
                      : '#f0a500'
                  }"
                />

                ${
                  index %
                  5 ===
                  0
                    ? `
                        <text
                          x="${x(index) + barWidth / 2}"
                          y="${height - 14}"
                          text-anchor="middle"
                          class="tick"
                        >
                          ปี ${point.year}
                        </text>
                      `
                    : ''
                }
              `;
            }
          ).join('')
        }


        ${
          paybackIndex !==
            null &&
          points[
            paybackIndex
          ]
            ? `
                <line
                  x1="${x(paybackIndex) + barWidth / 2}"
                  y1="${padding.t}"
                  x2="${x(paybackIndex) + barWidth / 2}"
                  y2="${height - padding.b}"
                  stroke="#12231f"
                  stroke-dasharray="4 4"
                />

                <text
                  x="${x(paybackIndex) + barWidth / 2 + 4}"
                  y="${padding.t + 10}"
                  class="tick"
                >
                  คืนทุน
                </text>
              `
            : ''
        }

      </svg>
    `;
}


/* ==========================================
   โหลดสำรอง
========================================== */

const apDesc =
  appliance =>
    `${Number(appliance.power_w)} W${
      appliance.has_surge
        ? ` • Surge ×${Number(appliance.surge_factor)}`
        : ''
    }`;


function renderAppliances() {

  /*
    หน้าเครื่องคำนวณ
    แสดงเฉพาะรายการที่เปิดใช้งาน
  */
  const visible =
    state.appliances.filter(
      appliance =>
        appliance.active !==
        false
    );


  $('applianceList').innerHTML =
    visible.length
      ? visible.map(
          appliance =>
            `
              <label class="ap-row">

                <span>

                  <b>
                    ${esc(appliance.name)}
                  </b>

                  <small>
                    ${apDesc(appliance)}
                  </small>

                </span>

                <input
                  class="ap-qty"
                  data-ap="${appliance.id}"
                  type="number"
                  min="0"
                  value="${state.apQty[appliance.id] || 0}"
                  aria-label="จำนวน ${esc(appliance.name)}"
                >

              </label>
            `
        ).join('')
      : `
          <div class="empty">
            ยังไม่มีรายการโหลดสำรองที่เปิดใช้งาน
          </div>
        `;


  $('apNote').textContent =
    state.apNote;


  $('apNote').hidden =
    !state.apNote;


  /*
    หน้า Admin
    แสดงทั้งรายการเปิดและปิด
  */
  $('applianceAdmin').innerHTML =
    state.appliances.length
      ? `
          <div class="list">

            ${
              state.appliances.map(
                appliance =>
                  `
                    <div class="item">

                      <div>

                        <b>
                          ${esc(appliance.name)}
                        </b>

                        <span>
                          ${apDesc(appliance)}
                          ·
                          ${
                            appliance.active !==
                            false
                              ? 'เปิดใช้งาน'
                              : 'ปิดใช้งาน'
                          }
                        </span>

                      </div>


                      <div class="item-actions">

                        <button
                          class="btn small"
                          data-ap-toggle="${appliance.id}"
                        >
                          ${
                            appliance.active !==
                            false
                              ? 'ปิด'
                              : 'เปิด'
                          }
                        </button>

                        <button
                          class="btn small"
                          data-ap-edit="${appliance.id}"
                        >
                          แก้ไข
                        </button>

                        <button
                          class="btn danger small"
                          data-ap-del="${appliance.id}"
                        >
                          ลบ
                        </button>

                      </div>

                    </div>
                  `
              ).join('')
            }

          </div>
        `
      : `
          <div class="empty">
            ยังไม่มีรายการ
            กรอกฟอร์มด้านซ้ายเพื่อเพิ่ม
          </div>
        `;
}


$('applianceAdmin').onclick =
  async event => {

    if (!supabase) {
      return alert(
        'ต้องเชื่อมต่อ Supabase ก่อนจึงจะจัดการโหลดสำรองได้'
      );
    }


    const editId =
      event.target.dataset
        .apEdit;


    const deleteId =
      event.target.dataset
        .apDel;


    const toggleId =
      event.target.dataset
        .apToggle;


    /*
      เปิด / ปิด
    */
    if (toggleId) {

      const appliance =
        state.appliances.find(
          item =>
            item.id ===
            toggleId
        );


      if (!appliance) {
        return;
      }


      const {
        error
      } =
        await supabase
          .from(
            'backup_appliances'
          )
          .update({
            active:
              appliance.active ===
              false
          })
          .eq(
            'id',
            toggleId
          );


      if (error) {
        return alert(
          error.message
        );
      }


      if (
        appliance.active !==
        false
      ) {
        delete state.apQty[
          toggleId
        ];
      }


      await loadAppliances();

      return;
    }


    /*
      แก้ไข
    */
    if (editId) {

      const appliance =
        state.appliances.find(
          item =>
            item.id ===
            editId
        );


      if (!appliance) {
        return;
      }


      state.editAp =
        editId;


      $('applianceFormTitle')
        .textContent =
          'แก้ไขเครื่องใช้ไฟฟ้า';


      $('apName').value =
        appliance.name;


      $('apPower').value =
        appliance.power_w;


      $('apSurge').checked =
        !!appliance.has_surge;


      $('apFactor').value =
        appliance.surge_factor ||
        3;


      $('apFactorRow').hidden =
        !appliance.has_surge;


      $('apName').focus();
    }


    /*
      ลบ
    */
    if (
      deleteId &&
      confirm(
        'ลบรายการนี้?'
      )
    ) {

      const {
        error
      } =
        await supabase
          .from(
            'backup_appliances'
          )
          .delete()
          .eq(
            'id',
            deleteId
          );


      if (error) {
        return alert(
          error.message
        );
      }


      delete state.apQty[
        deleteId
      ];


      await loadAppliances();
    }
  };


$('apSurge').onchange =
  () =>
    $('apFactorRow').hidden =
      !$('apSurge').checked;


function resetAp() {

  state.editAp =
    null;


  $('applianceFormTitle')
    .textContent =
      'เพิ่มเครื่องใช้ไฟฟ้า';


  $('applianceForm')
    .reset();


  $('apFactorRow').hidden =
    true;
}


$('apCancelBtn').onclick =
  resetAp;


$('applianceForm').onsubmit =
  async event => {

    event.preventDefault();


    if (!supabase) {
      return alert(
        'ต้องเชื่อมต่อ Supabase ก่อนจึงจะบันทึกโหลดสำรองได้'
      );
    }


    const current =
      state.editAp
        ? state.appliances.find(
            appliance =>
              appliance.id ===
              state.editAp
          )
        : null;


    const row = {

      name:
        $('apName')
          .value
          .trim(),

      power_w:
        num(
          'apPower'
        ),

      has_surge:
        $('apSurge')
          .checked,

      surge_factor:
        $('apSurge')
          .checked
          ? Math.max(
              1,
              num(
                'apFactor'
              )
            )
          : 1,

      active:
        current
          ? current.active !==
            false
          : true
    };


    if (
      !row.name ||
      row.power_w <= 0
    ) {
      return alert(
        'กรุณากรอกชื่อและกำลังไฟให้ถูกต้อง'
      );
    }


    /*
      รายการใหม่
      จะต่อท้ายรายการเดิม
    */
    if (!state.editAp) {

      const maxOrder =
        state.appliances.reduce(
          (
            max,
            appliance
          ) =>
            Math.max(
              max,
              Number(
                appliance.sort_order ||
                0
              )
            ),
          0
        );


      row.sort_order =
        maxOrder +
        10;
    }


    const result =
      state.editAp
        ? await supabase
            .from(
              'backup_appliances'
            )
            .update(
              row
            )
            .eq(
              'id',
              state.editAp
            )
        : await supabase
            .from(
              'backup_appliances'
            )
            .insert(
              row
            );


    if (
      result.error
    ) {
      return alert(
        result.error.message
      );
    }


    resetAp();


    await loadAppliances();
  };


/* ==========================================
   ฐานข้อมูลอุปกรณ์
========================================== */

function renderEquipment() {

  $('equipmentList').innerHTML =

    Object
      .keys(CAT)
      .map(
        category => {

          const list =
            state.equipment
              .filter(
                item =>
                  item.category ===
                  category
              );


          return `
            <h3>
              ${CAT[category]}
            </h3>

            ${
              list.length
                ? `
                    <div class="list">

                      ${
                        list.map(
                          item =>
                            `
                              <div class="item">

                                <div>

                                  <b>
                                    ${esc(item.brand)}
                                    ${esc(item.model)}
                                  </b>

                                  <span>
                                    ${spec(item)}
                                    ·
                                    ขาย
                                    ${money(item.sell_price)}

                                    ${
                                      item.system_type
                                        ? ' · ' +
                                          item.system_type
                                        : ''
                                    }

                                    ${
                                      item.is_default
                                        ? ' · แผงเริ่มต้น'
                                        : ''
                                    }
                                  </span>

                                </div>


                                <div class="item-actions">

                                  ${
                                    supabase
                                      ? `
                                          <button
                                            class="btn small"
                                            data-eq-edit="${item.id}"
                                          >
                                            แก้ไข
                                          </button>

                                          <button
                                            class="btn danger small"
                                            data-eq-del="${item.id}"
                                          >
                                            ลบ
                                          </button>
                                        `
                                      : ''
                                  }

                                </div>

                              </div>
                            `
                        ).join('')
                      }

                    </div>
                  `
                : `
                    <div class="empty">
                      ยังไม่มีรายการ
                    </div>
                  `
            }
          `;
        }
      )
      .join('');
}


function eqToggle() {

  const category =
    $('eqCategory').value;


  document
    .querySelectorAll(
      '#equipmentForm [class*="f-"]'
    )
    .forEach(
      element =>
        element.hidden =
          !element
            .classList
            .contains(
              'f-' +
              category
            )
    );
}


$('eqCategory').onchange =
  eqToggle;


function resetEq() {

  state.editEq =
    null;


  $('equipmentFormTitle')
    .textContent =
      'เพิ่มอุปกรณ์';


  $('equipmentForm')
    .reset();


  eqToggle();
}


$('eqCancelBtn').onclick =
  resetEq;


$('equipmentList').onclick =
  async event => {

    const editId =
      event.target.dataset
        .eqEdit;


    const deleteId =
      event.target.dataset
        .eqDel;


    if (editId) {

      const item =
        state.equipment.find(
          equipment =>
            equipment.id ===
            editId
        );


      state.editEq =
        editId;


      $('equipmentFormTitle')
        .textContent =
          'แก้ไขอุปกรณ์';


      $('eqCategory').value =
        item.category;


      eqToggle();


      $('eqBrand').value =
        item.brand;


      $('eqModel').value =
        item.model;


      $('eqPanelWp').value =
        item.panel_wp ||
        '';


      $('eqPowerKw').value =
        item.power_kw ||
        '';


      $('eqCapacityKwh').value =
        item.capacity_kwh ||
        '';


      $('eqSystemType').value =
        item.system_type ||
        '';


      $('eqCost').value =
        item.cost ||
        0;


      $('eqSellPrice').value =
        item.sell_price ||
        0;


      $('eqIsDefault').value =
        item.is_default
          ? 'true'
          : 'false';
    }


    if (
      deleteId &&
      confirm(
        'ลบอุปกรณ์นี้?'
      )
    ) {

      const {
        error
      } =
        await supabase
          .from(
            'equipment'
          )
          .delete()
          .eq(
            'id',
            deleteId
          );


      if (error) {

        alert(
          error.message
        );

      } else {

        loadEquipment();
      }
    }
  };


$('equipmentForm').onsubmit =
  async event => {

    event.preventDefault();


    if (!supabase) {

      return alert(
        'โหมดทดลองไม่สามารถบันทึกอุปกรณ์ได้ ต้องเชื่อม Supabase ก่อน'
      );
    }


    const category =
      $('eqCategory')
        .value;


    const optionalNumber =
      id =>
        $(id).value
          ? Number(
              $(id).value
            )
          : null;


    const payload = {

      category,

      brand:
        $('eqBrand').value,

      model:
        $('eqModel').value,

      panel_wp:
        category ===
        'panel'
          ? optionalNumber(
              'eqPanelWp'
            )
          : null,

      power_kw:
        category ===
        'inverter'
          ? optionalNumber(
              'eqPowerKw'
            )
          : null,

      capacity_kwh:
        category ===
        'battery'
          ? optionalNumber(
              'eqCapacityKwh'
            )
          : null,

      system_type:
        category ===
        'panel'
          ? null
          : (
              $('eqSystemType')
                .value ||
              null
            ),

      cost:
        Number(
          $('eqCost').value ||
          0
        ),

      sell_price:
        Number(
          $('eqSellPrice').value ||
          0
        ),

      active:
        true,

      is_default:
        category ===
        'panel' &&
        $('eqIsDefault')
          .value ===
        'true'
    };


    if (
      payload.is_default
    ) {

      await supabase
        .from(
          'equipment'
        )
        .update({
          is_default:
            false
        })
        .eq(
          'category',
          'panel'
        );
    }


    const result =
      state.editEq
        ? await supabase
            .from(
              'equipment'
            )
            .update(
              payload
            )
            .eq(
              'id',
              state.editEq
            )
        : await supabase
            .from(
              'equipment'
            )
            .insert(
              payload
            );


    if (
      result.error
    ) {

      alert(
        result.error.message
      );

    } else {

      resetEq();

      loadEquipment();
    }
  };


/* ==========================================
   ราคาติดตั้ง
========================================== */

$('pricingForm').onsubmit =
  async event => {

    event.preventDefault();


    const payload = {

      id: 1,

      labor_per_kwp:
        num(
          'laborPerKwp'
        ),

      structure_per_kwp:
        num(
          'structurePerKwp'
        ),

      wiring_per_kwp:
        num(
          'wiringPerKwp'
        ),

      transport_flat:
        num(
          'transportFlat'
        ),

      admin_flat:
        num(
          'adminFlat'
        ),

      margin_percent:
        num(
          'marginPercent'
        ),

      vat_percent:
        num(
          'vatPercent'
        )
    };


    state.pricing =
      normalizePricing(
        payload
      );


    if (!supabase) {

      alert(
        'ใช้ราคานี้ชั่วคราวในโหมดทดลอง'
      );

      return calc();
    }


    const {
      error
    } =
      await supabase
        .from(
          'pricing_settings'
        )
        .upsert(
          payload
        );


    if (error) {

      alert(
        error.message
      );

    } else {

      alert(
        'บันทึกราคาแล้ว'
      );

      loadPricing();
    }
  };


/* ==========================================
   ประวัติ
========================================== */

function renderHistory() {

  const list =
    state.assessments;


  const sum =
    key =>
      list.reduce(
        (
          total,
          assessment
        ) =>
          total +
          Number(
            assessment[key] ||
            0
          ),
        0
      );


  $('histStats').innerHTML =
    `
      <div>
        <span>
          จำนวนการประเมิน
        </span>
        <b>
          ${list.length}
        </b>
      </div>

      <div>
        <span>
          มูลค่าโครงการรวม
        </span>
        <b>
          ${money(
            sum(
              'project_price'
            )
          )}
        </b>
      </div>

      <div>
        <span>
          ประหยัดต่อเดือนรวม
        </span>
        <b>
          ${money(
            sum(
              'monthly_saving'
            )
          )}
        </b>
      </div>
    `;


  $('historyBody').innerHTML =
    list.length
      ? list.map(
          assessment =>
            `
              <tr>

                <td>
                  ${
                    new Date(
                      assessment.created_at
                    )
                      .toLocaleDateString(
                        'th-TH'
                      )
                  }
                </td>

                <td>

                  ${esc(
                    assessment.customer_name
                  )}

                  <small>
                    ${esc(
                      assessment.site_name ||
                      ''
                    )}
                  </small>

                </td>

                <td>
                  ${esc(
                    assessment.system_type ||
                    '-'
                  )}
                </td>

                <td class="r">
                  ${
                    Number(
                      assessment.recommended_kwp ||
                      0
                    ).toFixed(2)
                  }
                </td>

                <td class="r">
                  ${money(
                    assessment.project_price
                  )}
                </td>

                <td class="r">
                  ${
                    assessment.payback_year
                      ? assessment.payback_year +
                        ' ปี'
                      : '-'
                  }
                </td>

                <td class="r">

                  <button
                    class="btn danger small"
                    data-del="${assessment.id}"
                  >
                    ลบ
                  </button>

                </td>

              </tr>
            `
        ).join('')
      : `
          <tr>

            <td colspan="7">

              <div class="empty">
                ยังไม่มีประวัติการประเมิน
              </div>

            </td>

          </tr>
        `;
}


$('historyBody').onclick =
  async event => {

    const id =
      event.target.dataset
        .del;


    if (
      !id ||
      !supabase ||
      !confirm(
        'ลบรายการนี้?'
      )
    ) {
      return;
    }


    const {
      error
    } =
      await supabase
        .from(
          'assessments'
        )
        .delete()
        .eq(
          'id',
          id
        );


    if (error) {

      alert(
        error.message
      );

    } else {

      loadAssessments();
    }
  };


/* ==========================================
   บันทึกผลประเมิน
========================================== */

$('saveBtn').onclick =
  async () => {

    const result =
      state.last;


    if (!result) {

      return alert(
        'ยังไม่มีผลประเมินให้บันทึก'
      );
    }


    if (!supabase) {

      return alert(
        'ต้องเชื่อม Supabase ก่อนจึงจะบันทึกได้'
      );
    }


    const line =
      (
        item,
        quantity
      ) =>
        item
          ? {
              id:
                item.id,

              name:
                `${item.brand} ${item.model}`,

              qty:
                quantity,

              unit_price:
                Number(
                  item.sell_price ||
                  0
                )
            }
          : null;


    const payload = {

      customer_name:
        $('customerName')
          .value ||
        'ไม่ระบุชื่อ',

      phone:
        $('phone').value,

      site_name:
        $('siteName').value,

      system_type:
        result.systemType,

      calc_mode:
        result.calcMode,

      monthly_kwh:
        result.monthlyKwh ||
        0,

      daytime_percent:
        num(
          'daytimePercent'
        ),

      panel_wp:
        Number(
          result.panel.panel_wp ||
          0
        ),

      recommended_kwp:
        result.kwp,

      panel_count:
        result.panelQty,

      inverter_kw:
        Number(
          result.inverter?.power_kw ||
          0
        ) *
        result.invQty,

      battery_kwh:
        result.battery
          ? Number(
              result.battery.capacity_kwh ||
              0
            ) *
            result.batQty
          : 0,

      project_price:
        result.price.total,

      monthly_saving:
        result.saveMonth,

      payback_year:
        result.eco.payback,

      final_profit:
        result.eco.profit25,

      selected_panel:
        `${result.panel.brand} ${result.panel.model}`,

      selected_inverter:
        result.inverter
          ? `${result.inverter.brand} ${result.inverter.model}`
          : null,

      selected_battery:
        result.battery
          ? `${result.battery.brand} ${result.battery.model}`
          : null,

      line_items: {

        panel:
          line(
            result.panel,
            result.panelQty
          ),

        inverter:
          line(
            result.inverter,
            result.invQty
          ),

        battery:
          line(
            result.battery,
            result.batQty
          ),

        backup:
          result.backup.items
            .map(
              item => ({
                id:
                  item.id,

                name:
                  item.name,

                qty:
                  item.qty,

                watt:
                  item.powerW,

                surge:
                  item.hasSurge,

                surge_factor:
                  item.surge
              })
            )
      },

      notes:
        $('notes').value
    };


    const {
      error
    } =
      await supabase
        .from(
          'assessments'
        )
        .insert(
          payload
        );


    if (error) {

      alert(
        'บันทึกไม่สำเร็จ: ' +
        error.message
      );

    } else {

      alert(
        'บันทึกการประเมินแล้ว'
      );

      loadAssessments();
    }
  };


$('printBtn').onclick =
  () =>
    print();


$('refreshHistoryBtn').onclick =
  loadAssessments;


$('refreshEquipmentBtn').onclick =
  loadEquipment;


$('loadPricingBtn').onclick =
  loadPricing;


/* ==========================================
   Auto Calculate
========================================== */

$('inputs')
  .addEventListener(
    'input',
    event => {

      if (
        event.target.dataset
          .ap
      ) {

        state.apQty[
          event.target.dataset.ap
        ] =
          Number(
            event.target.value ||
            0
          );
      }


      calc();
    }
  );


eqToggle();

resetAp();


await Promise.all([
  loadEquipment(),
  loadAppliances(),
  loadAssessments(),
  loadPricing()
]);
