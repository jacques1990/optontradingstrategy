function sumGroup(groupName) {
  const boxes = [...document.querySelectorAll(`input[data-group="${groupName}"]`)];
  return boxes.reduce((acc, b) => acc + (b.checked ? Number(b.dataset.w || 1) : 0), 0);
}

function anyGroup(groupName) {
  return [...document.querySelectorAll(`input[data-group="${groupName}"]`)].some(b => b.checked);
}

function roundToStrike(x, step = 50) {
  if (!Number.isFinite(x)) return null;
  return Math.round(x / step) * step;
}

function getInputs() {
  const price = Number(document.getElementById("price").value);
  const support = Number(document.getElementById("support").value);
  const resistance = Number(document.getElementById("resistance").value);
  const dte = Number(document.getElementById("dte").value);
  return {
    price: Number.isFinite(price) && price > 0 ? price : null,
    support: Number.isFinite(support) && support > 0 ? support : null,
    resistance: Number.isFinite(resistance) && resistance > 0 ? resistance : null,
    dte
  };
}

function suggestStrikes({ price, support, resistance, dte }, bias, ivHigh, ivLow, rangeMode) {
  const atm = roundToStrike(price ?? 0);
  if (!atm) return "Enter Nifty price to get strike suggestions.";

  // basic OTM distances (simple defaults)
  // closer for 0DTE / near expiry, wider for more days
  const base = dte <= 0 ? 100 : dte <= 2 ? 150 : dte <= 5 ? 200 : 300;

  const callSell = atm + base;
  const callBuy = callSell + 100;

  const putSell = atm - base;
  const putBuy = putSell - 100;

  // If support/resistance given, align strikes a bit
  const rs = resistance ? roundToStrike(resistance) : null;
  const sp = support ? roundToStrike(support) : null;

  let txt = "";

  if (rangeMode && ivHigh) {
    txt += `Range + High IV idea (Hedged):\n`;
    txt += `• Iron Condor example: Sell ${callSell} CE + Buy ${callBuy} CE, Sell ${putSell} PE + Buy ${putBuy} PE.\n`;
    if (rs) txt += `• Resistance ref ≈ ${rs}. Keep call-side short strike above that if possible.\n`;
    if (sp) txt += `• Support ref ≈ ${sp}. Keep put-side short strike below that if possible.\n`;
    return txt.trim();
  }

  if (bias === "BULL" && ivLow) {
    txt += `Bullish + Low IV idea:\n`;
    txt += `• Bull Call Spread: Buy ${atm} CE, Sell ${atm + base} CE.\n`;
    if (rs) txt += `• If breakout above ≈ ${rs}, prefer strikes around that zone.\n`;
    return txt.trim();
  }

  if (bias === "BEAR" && ivLow) {
    txt += `Bearish + Low IV idea:\n`;
    txt += `• Bear Put Spread: Buy ${atm} PE, Sell ${atm - base} PE.\n`;
    if (sp) txt += `• If breakdown below ≈ ${sp}, prefer strikes around that zone.\n`;
    return txt.trim();
  }

  if (bias === "BULL" && ivHigh) {
    txt += `Bullish + High IV idea (Defined risk):\n`;
    txt += `• Bull Put Spread: Sell ${putSell} PE, Buy ${putBuy} PE.\n`;
    return txt.trim();
  }

  if (bias === "BEAR" && ivHigh) {
    txt += `Bearish + High IV idea (Defined risk):\n`;
    txt += `• Bear Call Spread: Sell ${callSell} CE, Buy ${callBuy} CE.\n`;
    return txt.trim();
  }

  return `Default (Defined risk):\n• Use a credit spread on the side of your bias around ATM ${atm} with ~${base} pts OTM short strike.`;
}

function decide() {
  const bull = sumGroup("BULL");
  const bear = sumGroup("BEAR");
  const range = sumGroup("RANGE");
  const breakout = sumGroup("BREAKOUT");
  const breakdown = sumGroup("BREAKDOWN");

  const ivHigh = anyGroup("IV_HIGH");
  const ivLow = anyGroup("IV_LOW");
  const bigMove = anyGroup("BIGMOVE");
  const smallMove = anyGroup("SMALLMOVE");
  const eventDay = anyGroup("EVENT");

  const inputs = getInputs();
  const exp0 = inputs.dte === 0;

  // UI pills
  document.getElementById("bullPill").textContent = `Bull: ${bull}`;
  document.getElementById("bearPill").textContent = `Bear: ${bear}`;
  document.getElementById("rangePill").textContent = `Range: ${range}`;
  document.getElementById("boPill").textContent = `Breakout: ${breakout}`;
  document.getElementById("bdPill").textContent = `Breakdown: ${breakdown}`;
  document.getElementById("ivPill").textContent = `IV: ${ivHigh ? "HIGH" : ivLow ? "LOW" : "-"}`;
  document.getElementById("dtePill").textContent = `DTE: ${inputs.dte}`;

  // Determine bias
  let bias = "NONE";
  if (bull >= 3 && bear < 3) bias = "BULL";
  if (bear >= 3 && bull < 3) bias = "BEAR";
  const rangeMode = range >= 2 && bull < 3 && bear < 3;

  // Strategy logic
  let strat = "NO CLEAR EDGE → No Trade / Wait for confirmation";
  let details = "If bull & bear signals both strong, it’s usually chop → wait.";

  if (eventDay && ivHigh) {
    details = "Event + High IV: avoid chasing premiums. Prefer defined-risk spreads, quick exits.";
  }

  if (rangeMode && ivHigh) {
    strat = "RANGE + HIGH IV → Iron Condor / Short Strangle (HEDGED)";
    details = "You’re selling theta. Keep risk defined and respect support/resistance.";
  } else if (bigMove && ivLow) {
    strat = "LOW IV + BIG MOVE → Long Straddle / Long Strangle";
    details = "Cheap options. Cut loss if move doesn’t come quickly (theta).";
  } else if (bias === "BULL" && ivLow && breakout >= 1) {
    strat = "BULLISH + LOW IV + BREAKOUT → Buy Call / Bull Call Spread";
    details = "Prefer candle close + retest to avoid false breakout.";
  } else if (bias === "BEAR" && ivLow && breakdown >= 1) {
    strat = "BEARISH + LOW IV + BREAKDOWN → Buy Put / Bear Put Spread";
    details = "Prefer candle close + retest to avoid fake breakdown.";
  } else if (bias === "BULL" && ivHigh && (exp0 || smallMove)) {
    strat = "BULLISH + HIGH IV → Bull Put Spread (Defined risk)";
    details = "High IV favors selling. Don’t sell naked unless you can manage margin + SL.";
  } else if (bias === "BEAR" && ivHigh && (exp0 || smallMove)) {
    strat = "BEARISH + HIGH IV → Bear Call Spread (Defined risk)";
    details = "High IV favors selling. Keep SL above resistance zone.";
  } else if (smallMove && ivHigh && (bull >= 2 || bear >= 2)) {
    strat = "SMALL MOVE + HIGH IV → Credit Spread in direction of bias";
    details = "Pick direction using trend. Sell OTM spread beyond structure levels.";
  }

  const strikes = suggestStrikes(inputs, bias, ivHigh, ivLow, rangeMode);

  document.getElementById("strategyText").textContent = strat;
  document.getElementById("detailText").textContent = details;
  document.getElementById("strikesText").textContent = strikes;
}

function wireEvents() {
  // checkboxes
  document.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener("change", decide);
  });

  // inputs
  ["price", "support", "resistance", "dte"].forEach(id => {
    document.getElementById(id).addEventListener("input", decide);
    document.getElementById(id).addEventListener("change", decide);
  });

  document.getElementById("resetBtn").addEventListener("click", () => {
    document.querySelectorAll('input[type="checkbox"]').forEach(cb => (cb.checked = false));
    document.getElementById("price").value = "";
    document.getElementById("support").value = "";
    document.getElementById("resistance").value = "";
    document.getElementById("dte").value = "3";
    decide();
  });

  decide();
}

document.addEventListener("DOMContentLoaded", wireEvents);
