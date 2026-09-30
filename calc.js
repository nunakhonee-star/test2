
export function clamp(n, min, max){ return Math.min(max, Math.max(min, n)); }

export function calculateSolar(input) {
  const monthlyKwh = Math.max(0, Number(input.monthlyKwh) || 0);
  const daytimePercent = clamp(Number(input.daytimePercent) || 0, 0, 100);
  const panelWp = Math.max(1, Number(input.panelWp) || 580);
  const yieldPerKwpMonth = Math.max(1, Number(input.yieldPerKwpMonth) || 125);
  const requestedBackupKwh = Math.max(0, Number(input.requestedBackupKwh) || 0);
  const batteryDod = clamp(Number(input.batteryDod) || 0.9, 0.1, 1);
  const tariff = Math.max(0, Number(input.tariff) || 4.2);

  const daytimeKwh = monthlyKwh * (daytimePercent / 100);
  const recommendedKwpRaw = daytimeKwh / yieldPerKwpMonth;
  const panelCount = monthlyKwh > 0 ? Math.max(1, Math.ceil((recommendedKwpRaw * 1000) / panelWp)) : 0;
  const installedKwp = panelCount * panelWp / 1000;
  const inverterKwTarget = installedKwp > 0 ? installedKwp / 1.15 : 0;
  const batteryNameplateKwh = requestedBackupKwh > 0 ? requestedBackupKwh / batteryDod : 0;
  const estimatedMonthlyGeneration = installedKwp * yieldPerKwpMonth;
  const estimatedSelfUsedKwh = Math.min(daytimeKwh, estimatedMonthlyGeneration);
  const estimatedMonthlySaving = estimatedSelfUsedKwh * tariff;
  const estimatedAnnualSaving = estimatedMonthlySaving * 12;

  return {
    monthlyKwh, daytimeKwh, recommendedKwpRaw, panelCount, installedKwp,
    inverterKwTarget, batteryNameplateKwh, estimatedMonthlyGeneration,
    estimatedSelfUsedKwh, estimatedMonthlySaving, estimatedAnnualSaving
  };
}

export function chooseClosest(items, field, target, category) {
  const active = items.filter(x => x.category === category && x.active !== false && Number(x[field]) > 0);
  if (!active.length || !target) return null;
  return [...active].sort((a,b) =>
    Math.abs(Number(a[field])-target) - Math.abs(Number(b[field])-target)
  )[0];
}

export function evaluateEconomics({
  totalProjectPrice, annualSaving, annualMaintenance, analysisYears,
  tariffGrowth, degradationRate
}) {
  const projectPrice = Math.max(0, Number(totalProjectPrice) || 0);
  const baseAnnualSaving = Math.max(0, Number(annualSaving) || 0);
  const maintenance = Math.max(0, Number(annualMaintenance) || 0);
  const years = Math.max(1, Number(analysisYears) || 25);
  const growth = Math.max(0, Number(tariffGrowth) || 0) / 100;
  const deg = Math.max(0, Number(degradationRate) || 0) / 100;

  const points = [{ year: 0, annualGross: 0, annualNet: -projectPrice, cumulative: -projectPrice }];
  let cumulative = -projectPrice;
  let paybackYear = null;

  for (let year = 1; year <= years; year++) {
    const annualGross = baseAnnualSaving * Math.pow(1 + growth, year - 1) * Math.pow(1 - deg, year - 1);
    const annualNet = annualGross - maintenance;
    cumulative += annualNet;
    if (paybackYear === null && cumulative >= 0) paybackYear = year;
    points.push({ year, annualGross, annualNet, cumulative });
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
