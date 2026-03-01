function sumGroup(groupName) {
  const boxes = [...document.querySelectorAll(`input[data-group="${groupName}"]`)];
  return boxes.reduce((acc, b) => acc + (b.checked ? Number(b.dataset.w || 1) : 0), 0);
}

function anyGroup(groupName) {
  return [...document.querySelectorAll(`input[data-group="${groupName}"]`)].some(b => b.checked);
}

function decide() {
  const bull = sumGroup("BULL");
  const bear = sumGroup("BEAR");
  const range = sumGroup("RANGE");
  const breakout = sumGroup("BREAKOUT");
  const breakdown = sumGroup("BREAKDOWN");

  const ivHigh = anyGroup("IV_HIGH");
  const ivLow = anyGroup("IV_LOW");
  const exp0 = anyGroup("EXP_0DTE");
  const bigMove = anyGroup("BIGMOVE");
  const smallMove = anyGroup("SMALLMOVE");
  const eventDay = anyGroup("EVENT");

  // Update pills
  document.getElementById("bullPill").textContent = `Bull: ${bull}`;
  document.getElementById("bearPill").textContent = `Bear: ${bear}`;
  document.getElementById("rangePill").textContent = `Range: ${range}`;
  document.getElementById("boPill").textContent = `Breakout: ${breakout}`;
  document.getElementById("bdPill").textContent = `Breakdown: ${breakdown}`;
  document.getElementById("ivPill").textContent = `IV: ${ivHigh ? "HIGH" : ivLow ? "LOW" : "-"}`;
  document.getElementById("expPill").textContent = `Expiry: ${exp0 ? "0DTE" : "-"}`;

  // Decision logic
  let strat = "NO CLEAR EDGE → No Trade / Wait for confirmation";
  let details = "";

  if (eventDay && ivHigh) {
    details = "Event + High IV: prefer defined-risk selling; avoid chasing premiums.";
  }

  if (bull >= 3 && ivHigh && exp0) {
    strat = "BULLISH + HIGH IV + 0DTE → Bull Put Spread / Hedged Call Selling";
    details ||= "High IV favors selling. Keep SL above resistance; use defined risk.";
  } else if (bear >= 3 && ivHigh && exp0) {
    strat = "BEARISH + HIGH IV + 0DTE → Bear Call Spread / Hedged Call Selling";
    details ||= "High IV favors selling. Keep SL above resistance; defined risk preferred.";
  } else if (range >= 2 && ivHigh) {
    strat = "RANGE + HIGH IV → Iron Condor / Short Strangle (Hedged)";
    details ||= "Sell time decay when price is boxed between support/resistance.";
  } else if (bigMove && ivLow) {
    strat = "LOW IV + BIG MOVE → Long Straddle / Long Strangle";
    details ||= "Cheap options: you’re paying for movement. Cut loss if move doesn’t come.";
  } else if (bull >= 3 && ivLow && breakout >= 1) {
    strat = "BULLISH + LOW IV + BREAKOUT → Buy Call / Bull Call Spread";
    details ||= "Wait for candle close + retest to avoid false breakout.";
  } else if (bear >= 3 && ivLow && breakdown >= 1) {
    strat = "BEARISH + LOW IV + BREAKDOWN → Buy Put / Bear Put Spread";
    details ||= "Confirmation matters: close below support + follow-through.";
  } else if (smallMove && ivHigh && (bull >= 2 || bear >= 2)) {
    strat = "SMALL MOVE + HIGH IV → Credit Spread in direction of bias";
    details ||= "Pick a side using trend; sell OTM spread beyond structure levels.";
  }

  document.getElementById("strategyText").textContent = strat;
  document.getElementById("detailText").textContent =
    details || "If signals conflict (bull & bear both high), treat it as chop and protect capital.";
}

function wireEvents() {
  document.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener("change", decide);
  });

  document.getElementById("resetBtn").addEventListener("click", () => {
    document.querySelectorAll('input[type="checkbox"]').forEach(cb => (cb.checked = false));
    decide();
  });

  decide();
}

// Start after DOM is loaded
document.addEventListener("DOMContentLoaded", wireEvents);
