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

// ---- India VIX bands ----
function vixBucket(vix) {
  if (!Number.isFinite(vix)) return { label: "-", bucket: "UNKNOWN" };
  if (vix < 12)  return { label: "Very Low (<12)", bucket: "VERY_LOW" };
  if (vix < 15)  return { label: "Normal (12–15)", bucket: "NORMAL" };
  if (vix < 20)  return { label: "Elevated (15–20)", bucket: "ELEVATED" };
  if (vix < 25)  return { label: "High (20–25)", bucket: "HIGH" };
  return { label: "Very High (25+)", bucket: "VERY_HIGH" };
}

function vixToIV(bucket) {
  // converts VIX -> behavior flags used by strategy logic
  if (bucket === "VERY_LOW") return { ivLow: true, ivHigh: false };
  if (bucket === "NORMAL")   return { ivLow: true, ivHigh: false };
  if (bucket === "ELEVATED") return { ivLow: false, ivHigh: false }; // mixed zone
  if (bucket === "HIGH")     return { ivLow: false, ivHigh: true };
  if (bucket === "VERY_HIGH")return { ivLow: false, ivHigh: true };
  return { ivLow: false, ivHigh: false };
}

function getInputs() {
  const instrument = document.getElementById("instrument").value; // INDEX | STOCK
  const goal = document.getElementById("goal").value; // AUTO | DIRECTIONAL | INCOME | VOLATILITY | HEDGE

  const price = Number(document.getElementById("price").value);
  const support = Number(document.getElementById("support").value);
  const resistance = Number(document.getElementById("resistance").value);
  const dte = Number(document.getElementById("dte").value);
  const vix = Number(document.getElementById("vix").value);

  return {
    instrument,
    goal,
    price: Number.isFinite(price) && price > 0 ? price : null,
    support: Number.isFinite(support) && support > 0 ? support : null,
    resistance: Number.isFinite(resistance) && resistance > 0 ? resistance : null,
    dte,
    vix: Number.isFinite(vix) && vix > 0 ? vix : null
  };
}

function baseOtmDistance(dte) {
  // simple defaults for Nifty 50pt strikes
  if (dte <= 0) return 100;
  if (dte <= 2) return 150;
  if (dte <= 5) return 200;
  return 300;
}

/**
 * Builds readable option legs suggestions (examples).
 * NOTE: Templates only. Always use risk control.
 */
function legsForStrategy(strategyKey, inputs, biasKey) {
  const atm = roundToStrike(inputs.price ?? 0);
  if (!atm) return "Enter price to generate example strikes.";

  const dist = baseOtmDistance(inputs.dte);
  const c1 = atm + dist;       // short call strike
  const c2 = c1 + 100;         // hedge buy call strike
  const p1 = atm - dist;       // short put strike
  const p2 = p1 - 100;         // hedge buy put strike

  // Basic
  const longCall = `Long Call: Buy ${atm} CE`;
  const longPut  = `Long Put: Buy ${atm} PE`;

  // Vertical spreads
  const bullCall = `Bull Call Spread (Debit): Buy ${atm} CE, Sell ${atm + dist} CE`;
  const bearPut  = `Bear Put Spread (Debit): Buy ${atm} PE, Sell ${atm - dist} PE`;
  const bullPut  = `Bull Put Spread (Credit): Sell ${p1} PE, Buy ${p2} PE`;
  const bearCall = `Bear Call Spread (Credit): Sell ${c1} CE, Buy ${c2} CE`;

  // Income / Neutral
  const ironCondor = `Iron Condor: Sell ${c1} CE + Buy ${c2} CE, Sell ${p1} PE + Buy ${p2} PE`;
  const ironFly    = `Iron Butterfly: Sell ${atm} CE + Sell ${atm} PE, Buy ${atm + dist} CE + Buy ${atm - dist} PE`;
  const calendar   = `Calendar: Sell near-expiry ${atm} option, Buy next-week/month ${atm} option (same strike)`;

  // Volatility
  const straddle = `Long Straddle: Buy ${atm} CE + Buy ${atm} PE`;
  const strangle = `Long Strangle: Buy ${atm + dist} CE + Buy ${atm - dist} PE`;

  // Butterflies / advanced
  const butterflyCall = `Butterfly (Call): Buy ${atm} CE, Sell 2x ${atm + dist} CE, Buy ${atm + 2 * dist} CE`;
  const butterflyPut  = `Butterfly (Put): Buy ${atm} PE, Sell 2x ${atm - dist} PE, Buy ${atm - 2 * dist} PE`;
  const bwbCall       = `Broken Wing Butterfly (Call skew): Buy ${atm} CE, Sell 2x ${atm + dist} CE, Buy ${atm + 3 * dist} CE (uneven wings)`;

  const ratio = biasKey === "BULL"
    ? `Ratio Spread (Bullish): Buy 1x ${atm} CE, Sell 2x ${atm + dist} CE (strict risk control)`
    : `Ratio Spread (Bearish): Buy 1x ${atm} PE, Sell 2x ${atm - dist} PE (strict risk control)`;

  // Stock-only
  const coveredCall = `Covered Call (Stock only): Hold shares + Sell OTM Call`;
  const marriedPut  = `Married Put (Stock only): Hold shares + Buy Put (protection)`;
  const csp         = `Cash-Secured Put (Stock only): Sell Put while holding cash to buy shares if assigned`;

  switch (strategyKey) {
    case "LONG_CALL": return longCall;
    case "LONG_PUT":  return longPut;

    case "BULL_CALL_DEBIT": return bullCall;
    case "BEAR_PUT_DEBIT":  return bearPut;
    case "BULL_PUT_CREDIT": return bullPut;
    case "BEAR_CALL_CREDIT":return bearCall;

    case "IRON_CONDOR": return ironCondor;
    case "IRON_BUTTERFLY": return ironFly;
    case "CALENDAR": return calendar;

    case "STRADDLE": return straddle;
    case "STRANGLE": return strangle;

    case "BUTTERFLY": return biasKey === "BEAR" ? butterflyPut : butterflyCall;
    case "BWB": return bwbCall;
    case "RATIO": return ratio;

    case "COVERED_CALL": return coveredCall;
    case "MARRIED_PUT": return marriedPut;
    case "CASH_SECURED_PUT": return csp;

    default:
      return "—";
  }
}

function decideStrategy(scores, inputs, ivHigh, ivLow) {
  const { bull, bear, range, breakout, breakdown, pressure } = scores;

  const bigMove = anyGroup("BIGMOVE");
  const pin = anyGroup("PIN");
  const eventDay = anyGroup("EVENT");

  // Bias key
  let bias = "NONE";
  if (bull >= 3 && bear < 3) bias = "BULL";
  if (bear >= 3 && bull < 3) bias = "BEAR";
  const isRange = range >= 2 && bias === "NONE";

  // Goal override
  const goal = inputs.goal;

  const exp0 = inputs.dte === 0;
  const nearExpiry = inputs.dte <= 2;
  const hasBreakout = breakout >= 1;
  const hasBreakdown = breakdown >= 1;
  const stockOnlyAllowed = inputs.instrument === "STOCK";

  let key = "NONE";
  let title = "No clear edge → Wait / No trade";
  let why = "Need clearer bias OR range + high IV OR volatility setup.";

  // HEDGE goal
  if (goal === "HEDGE") {
    if (stockOnlyAllowed) {
      key = "MARRIED_PUT";
      title = "Hedge → Married Put (Protective Put)";
      why = "Stock protection: buy put to cap downside.";
    } else {
      key = bias === "BEAR" ? "BEAR_CALL_CREDIT" : "BULL_PUT_CREDIT";
      title = "Hedge-like (Index) → Defined-risk Credit Spread";
      why = "Index has no shares. Use defined-risk spreads as hedge-style structures.";
    }
    return { key, title, why, bias };
  }

  // VOLATILITY goal
  if (goal === "VOLATILITY") {
    if (ivLow && bigMove) {
      key = "STRADDLE";
      title = "Volatility → Long Straddle";
      why = "IV Low + expecting big move = volatility expansion.";
    } else if (ivLow && (eventDay || pressure)) {
      key = "STRANGLE";
      title = "Volatility → Long Strangle";
      why = "IV Low + possible breakout/event; cheaper than straddle.";
    } else if (ivHigh) {
      key = bias === "BEAR" ? "BEAR_CALL_CREDIT" : "BULL_PUT_CREDIT";
      title = "Volatility note: IV High → Prefer defined-risk selling";
      why = "Buying straddle/strangle when IV high risks IV crush. Prefer spreads.";
    }
    return { key, title, why, bias };
  }

  // INCOME goal
  if (goal === "INCOME") {
    if (isRange && ivHigh) {
      key = "IRON_CONDOR";
      title = "Income/Neutral → Iron Condor";
      why = "Range + IV High = classic theta-selling environment (defined risk).";
    } else if (pin && (nearExpiry || exp0) && ivHigh && !bigMove) {
      key = "IRON_BUTTERFLY";
      title = "Income/Neutral → Iron Butterfly";
      why = "Pinning + near expiry + expensive premiums = iron fly income setup.";
    } else {
      key = bias === "BEAR" ? "BEAR_CALL_CREDIT" : "BULL_PUT_CREDIT";
      title = "Income → Credit Spread (defined risk)";
      why = "If not clean range, sell one side with hedge.";
    }
    return { key, title, why, bias };
  }

  // DIRECTIONAL goal
  if (goal === "DIRECTIONAL") {
    if (bias === "BULL" && ivLow && hasBreakout) {
      key = "BULL_CALL_DEBIT";
      title = "Directional Bullish → Bull Call Spread (Debit)";
      why = "Bull bias + breakout + IV low = debit spread fits.";
    } else if (bias === "BEAR" && ivLow && hasBreakdown) {
      key = "BEAR_PUT_DEBIT";
      title = "Directional Bearish → Bear Put Spread (Debit)";
      why = "Bear bias + breakdown + IV low = debit spread fits.";
    } else if (bias === "BULL" && ivLow) {
      key = "LONG_CALL";
      title = "Directional Bullish → Long Call";
      why = "Bull bias + IV low favors buying calls (or debit spread).";
    } else if (bias === "BEAR" && ivLow) {
      key = "LONG_PUT";
      title = "Directional Bearish → Long Put";
      why = "Bear bias + IV low favors buying puts (or debit spread).";
    } else if (ivHigh) {
      key = bias === "BEAR" ? "BEAR_CALL_CREDIT" : "BULL_PUT_CREDIT";
      title = "Directional note: IV high → prefer Credit Spread";
      why = "When IV is high, buying options expensive; defined-risk selling fits better.";
    }
    return { key, title, why, bias };
  }

  // AUTO mode
  if (isRange && ivHigh) {
    key = "IRON_CONDOR";
    title = "AUTO → Iron Condor";
    why = "Range + IV High = income setup.";
  }
  else if (pin && (nearExpiry || exp0) && ivHigh && !bigMove) {
    key = "IRON_BUTTERFLY";
    title = "AUTO → Iron Butterfly";
    why = "Pinning + near expiry + IV High = iron fly income setup.";
  }
  else if (bigMove && ivLow) {
    key = "STRADDLE";
    title = "AUTO → Long Straddle";
    why = "IV Low + big move expected = volatility expansion.";
  }
  else if (bull >= 3 && ivLow && hasBreakout) {
    key = "BULL_CALL_DEBIT";
    title = "AUTO → Bull Call Spread (Debit)";
    why = "Bull bias + breakout + IV low favors debit spread.";
  }
  else if (bear >= 3 && ivLow && hasBreakdown) {
    key = "BEAR_PUT_DEBIT";
    title = "AUTO → Bear Put Spread (Debit)";
    why = "Bear bias + breakdown + IV low favors debit spread.";
  }
  else if (bull >= 3 && ivHigh) {
    key = "BULL_PUT_CREDIT";
    title = "AUTO → Bull Put Spread (Credit)";
    why = "IV High + bullish bias = sell put spread (defined risk).";
  }
  else if (bear >= 3 && ivHigh) {
    key = "BEAR_CALL_CREDIT";
    title = "AUTO → Bear Call Spread (Credit)";
    why = "IV High + bearish bias = sell call spread (defined risk).";
  }
  else if (pin && ivLow && !bigMove) {
    key = "BUTTERFLY";
    title = "AUTO → Butterfly Spread (low vol / pinning)";
    why = "If you expect price to stick near a zone with low IV, butterflies can fit.";
  }
  else if (inputs.dte >= 7 && (ivLow || eventDay)) {
    key = "CALENDAR";
    title = "AUTO → Calendar Spread";
    why = "More time available; calendars fit slower near-term + later movement/IV shift.";
  }
  else {
    key = "NONE";
    title = "AUTO → No Trade / Wait";
    why = "Signals not aligned enough.";
  }

  // Stock-only fallback (only if STOCK + no clear edge)
  if (inputs.instrument === "STOCK" && key === "NONE") {
    key = "COVERED_CALL";
    title = "STOCK fallback → Covered Call";
    why = "If you hold stock and want income, covered calls are baseline.";
  }

  return { key, title, why, bias };
}

function decide() {
  const inputs = getInputs();

  const scores = {
    bull: sumGroup("BULL"),
    bear: sumGroup("BEAR"),
    range: sumGroup("RANGE"),
    breakout: sumGroup("BREAKOUT"),
    breakdown: sumGroup("BREAKDOWN"),
    pressure: sumGroup("PRESSURE"),
  };

  // ---- VIX -> IV state (auto if VIX entered) ----
  const vixInfo = vixBucket(inputs.vix);
  const vixIV = vixToIV(vixInfo.bucket);

  const ivHighManual = anyGroup("IV_HIGH");
  const ivLowManual  = anyGroup("IV_LOW");

  const ivHigh = inputs.vix ? vixIV.ivHigh : ivHighManual;
  const ivLow  = inputs.vix ? vixIV.ivLow  : ivLowManual;

  // pills
  const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
  set("bullPill", `Bull: ${scores.bull}`);
  set("bearPill", `Bear: ${scores.bear}`);
  set("rangePill", `Range: ${scores.range}`);
  set("boPill", `Breakout: ${scores.breakout}`);
  set("bdPill", `Breakdown: ${scores.breakdown}`);
  set("ivPill", `IV: ${ivHigh ? "HIGH" : ivLow ? "LOW" : "-"}`);
  set("dtePill", `DTE: ${inputs.dte}`);

  const vixPill = document.getElementById("vixPill");
  if (vixPill) {
    vixPill.textContent = `VIX: ${inputs.vix ? inputs.vix.toFixed(1) + " • " + vixInfo.label : "-"}`;
  }

  const pick = decideStrategy(scores, inputs, ivHigh, ivLow);

  const strategyText = document.getElementById("strategyText");
  const detailText = document.getElementById("detailText");
  const legsText = document.getElementById("legsText");

  if (strategyText) strategyText.textContent = pick.title;

  let extra = [];
  if (anyGroup("EVENT")) extra.push("Event risk ON → keep size small, defined risk preferred.");
  if (inputs.instrument === "INDEX") extra.push("Index mode: stock-only strategies (Covered Call / Married Put / CSP) don’t apply.");
  if (!inputs.price) extra.push("Enter Price to generate strikes.");
  if (inputs.vix && vixInfo.bucket === "VERY_HIGH") extra.push("VIX very high → IV crush risk for option buying; prefer defined-risk selling.");
  if (inputs.vix && vixInfo.bucket === "VERY_LOW") extra.push("VIX very low → options cheap; volatility buys/debit spreads become more attractive.");

  if (detailText) {
    detailText.textContent =
      `Why: ${pick.why}\n` +
      (extra.length ? `Notes:\n• ${extra.join("\n• ")}` : "");
  }

  if (legsText) {
    const legs = pick.key === "NONE" ? "—" : legsForStrategy(pick.key, inputs, pick.bias);
    legsText.textContent = `Example legs:\n${legs}`;
  }
}

function wireEvents() {
  document.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.addEventListener("change", decide));

  ["instrument","goal","price","support","resistance","dte","vix"].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("input", decide);
    el.addEventListener("change", decide);
  });

  document.getElementById("resetBtn").addEventListener("click", () => {
    document.querySelectorAll('input[type="checkbox"]').forEach(cb => (cb.checked = false));
    document.getElementById("price").value = "";
    document.getElementById("support").value = "";
    document.getElementById("resistance").value = "";
    document.getElementById("vix").value = "";
    document.getElementById("dte").value = "4";
    document.getElementById("goal").value = "AUTO";
    document.getElementById("instrument").value = "INDEX";
    decide();
  });

  decide();
}

document.addEventListener("DOMContentLoaded", wireEvents);
