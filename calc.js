
export function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

export const SYSTEM_DEFAULTS = {
  yieldPerKwpMonth: 125,
  batteryDod: 0.90,
  batteryEfficiency: 0.95,
  batteryReserve: 1.10,
  bosAndInstallPercent: 0.25
};

export function calculateSolar(input) {
  const monthlyKwh = Math.max(0, Number(input.monthlyKwh) || 0);
  const monthlyBill = Math.max(0, Number(input.monthlyBill) || 0);
  const daytimePercent = clamp(Number(input.daytimePercent) || 0, 0, 100);
  const panelWp = Math.max(1, Number(input.panelWp) || 580);

  const yieldPerKwpMonth = SYSTEM_DEFAULTS.yieldPerKwpMonth;
  const daytimeKwh = monthlyKwh * (daytimePercent / 100);

  const recommendedKwpRaw = daytimeKwh / yieldPerKwpMonth;
  const panelCount = monthlyKwh > 0
    ? Math.max(1, Math.ceil((recommendedKwpRaw * 1000) / panelWp))
    : 0;

  const installedKwp = panelCount * panelWp / 1000;
  const inverterKwTarget = installedKwp > 0 ? installedKwp / 1.15 : 0;

  // ใช้ยอดบิลจริงเพื่อประเมินเงินประหยัดภายใน โดยไม่แสดงค่าเฉลี่ยบาท/kWh บน UI
  const effectiveTariff = monthlyKwh > 0 && monthlyBill > 0
    ? monthlyBill / monthlyKwh
    : 0;

  const estimatedMonthlyGeneration = installedKwp * yieldPerKwpMonth;
  const estimatedSelfUsedKwh = Math.min(daytimeKwh, estimatedMonthlyGeneration);
  const estimatedMonthlySaving = estimatedSelfUsedKwh * effectiveTariff;
  const estimatedAnnualSaving = estimatedMonthlySaving * 12;

  return {
    monthlyKwh,
    monthlyBill,
    daytimeKwh,
    panelCount,
    installedKwp,
    inverterKwTarget,
    estimatedMonthlyGeneration,
    estimatedSelfUsedKwh,
    estimatedMonthlySaving,
    estimatedAnnualSaving
  };
}

export function calculateBattery({
  mode,
  backupLoadKw,
  backupHours
}) {
  if (mode !== 'quick') {
    return {
      usableKwh: 0,
      recommendedNameplateKwh: 0
    };
  }

  const loadKw = Math.max(0, Number(backupLoadKw) || 0);
  const hours = Math.max(0, Number(backupHours) || 0);
  const usableKwh = loadKw * hours;

  const recommendedNameplateKwh =
    usableKwh /
    (SYSTEM_DEFAULTS.batteryDod * SYSTEM_DEFAULTS.batteryEfficiency) *
    SYSTEM_DEFAULTS.batteryReserve;

  return {
    usableKwh,
    recommendedNameplateKwh
  };
}

export function chooseClosest(items, field, target, category) {
  const active = items.filter(
    x => x.category === category &&
         x.active !== false &&
         Number(x[field]) > 0
  );

  if (!active.length || !target) return null;

  return [...active].sort(
    (a, b) =>
      Math.abs(Number(a[field]) - target) -
      Math.abs(Number(b[field]) - target)
  )[0];
}

export function chooseDefaultPanel(items) {
  const panels = items.filter(
    x => x.category === 'panel' &&
         x.active !== false &&
         Number(x.panel_wp) > 0
  );

  if (!panels.length) return null;

  const explicitDefault = panels.find(x => x.is_default === true);
  return explicitDefault || panels[0];
}

export function estimateProjectPrice({
  panel,
  panelCount,
  inverter,
  battery,
  batteryCount
}) {
  const panelTotal = panel ? Number(panel.sell_price || 0) * panelCount : 0;
  const inverterTotal = inverter ? Number(inverter.sell_price || 0) : 0;
  const batteryTotal = battery
    ? Number(battery.sell_price || 0) * Math.max(1, batteryCount || 1)
    : 0;

  const equipmentSubtotal = panelTotal + inverterTotal + batteryTotal;
  const bosAndInstall =
    equipmentSubtotal * SYSTEM_DEFAULTS.bosAndInstallPercent;

  return {
    panelTotal,
    inverterTotal,
    batteryTotal,
    equipmentSubtotal,
    bosAndInstall,
    estimatedProjectPrice: equipmentSubtotal + bosAndInstall
  };
}

export function evaluateSimpleEconomics({
  estimatedProjectPrice,
  annualSaving,
  analysisYears = 25
}) {
  const investment = Math.max(0, Number(estimatedProjectPrice) || 0);
  const yearlySaving = Math.max(0, Number(annualSaving) || 0);
  const years = Math.max(1, Number(analysisYears) || 25);

  const points = [{ year: 0, cumulative: -investment }];
  let cumulative = -investment;
  let paybackYear = null;

  for (let year = 1; year <= years; year++) {
    cumulative += yearlySaving;
    if (paybackYear === null && cumulative >= 0) {
      paybackYear = year;
    }
    points.push({ year, cumulative });
  }

  const byYear = y => points.find(p => p.year === y)?.cumulative ?? null;

  return {
    points,
    paybackYear,
    finalProfit: points.at(-1)?.cumulative ?? 0,
    profitYear10: byYear(10),
    profitYear15: byYear(15),
    profitYear20: byYear(20)
  };
}
