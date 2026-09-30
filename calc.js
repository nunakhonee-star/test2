export function calculateSolar(input) {
  const monthlyKwh = Math.max(0, Number(input.monthlyKwh) || 0);
  const daytimePercent = Math.min(100, Math.max(0, Number(input.daytimePercent) || 0));
  const panelWp = Math.max(1, Number(input.panelWp) || 580);
  const yieldPerKwpMonth = Math.max(1, Number(input.yieldPerKwpMonth) || 125);
  const requestedBackupKwh = Math.max(0, Number(input.requestedBackupKwh) || 0);
  const batteryDod = Math.min(1, Math.max(0.1, Number(input.batteryDod) || 0.9));
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

  return {
    daytimeKwh,
    panelCount,
    installedKwp,
    inverterKwTarget,
    batteryNameplateKwh,
    estimatedMonthlyGeneration,
    estimatedMonthlySaving
  };
}

export function chooseClosest(items, field, target, category) {
  const active = items.filter(x => x.category === category && x.active !== false && Number(x[field]) > 0);
  if (!active.length || !target) return null;
  return [...active].sort((a,b) =>
    Math.abs(Number(a[field])-target) - Math.abs(Number(b[field])-target)
  )[0];
}
