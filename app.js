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
  if (bucket === "VERY_LOW") return { ivLow: true, ivHigh: false };
  if (bucket === "NORMAL")   return { ivLow: true, ivHigh: false };
  if (bucket === "ELEVATED") return { ivLow: false, ivHigh: false };
  if (bucket === "HIGH")     return { ivLow: false, ivHigh: true };
  if (bucket === "VERY_HIGH")return { ivLow: false, ivHigh: true };
  return { ivLow: false, ivHigh: false };
}

function getInputs() {
  const instrument = document.getElementById("instrument").value; // INDEX | STOCK
  const goal = document.getElementById("goal").value; // AUTO | DIRECTIONAL | INCOME | VOLATILITY | HEDGE
  const eventSentiment = document.getElementById("eventSentiment").value; // NEUTRAL | GOOD | BAD

  const price = Number(document.getElementById("price").value);
  const support = Number(document.getElementById("support").value);
  const resistance = Number(document.getElementById("resistance").value);
  const dte = Number(document.getElementById("dte").value);
  const vix = Number(document.getElementById("vix").value);

  return {
    instrument,
    goal,
    eventSentiment,
    price: Number.isFinite(price) && price > 0 ? price : null,
    support: Number.isFinite(support) && support > 0 ? support : null,
    resistance: Number.isFinite(resistance) && resistance > 0 ? resistance : null,
    dte,
    vix: Number.isFinite(vix) && vix > 0 ? vix : null
  };
}

function baseOtmDistance(dte) {
  if (dte <= 0) return 100;
  if (dte <= 2) return 150;
  if (dte <= 5) return 200;
  return 300;
}

function legsForStrategy(strategyKey, inputs, biasKey) {
  const atm = roundToStrike(inputs.price ?? 0);
  if (!atm) return "Enter price to generate example strikes.";

  const dist = baseOtmDistance(inputs.dte);
  const c1 = atm + dist;
  const c2 = c1 + 100;
  const p1 = atm - dist;
  const p2 = p1 - 100;

  const longCall = `Long Call: Buy ${atm} CE`;
  const longPut  = `Long Put: Buy ${atm} PE`;

  const bullCall = `Bull Call Spread (Debit): Buy ${atm} CE, Sell ${atm + dist} CE`;
  const bearPut  = `Bear Put Spread (Debit): Buy ${atm} PE, Sell ${atm - dist} PE`;
  const bullPut  = `Bull Put Spread (Credit): Sell ${p1} PE, Buy ${p2} PE`;
  const bearCall = `Bear Call Spread (Credit): Sell ${c1} CE, Buy ${c2} CE`;

  const ironCondor = `Iron Condor: Sell ${c1} CE + Buy ${c2} CE, Sell ${p1} PE + Buy ${p2} PE`;
  const ironFly    = `Iron Butterfly: Sell ${atm} CE + Sell ${atm} PE, Buy ${atm + dist} CE + Buy ${atm - dist} PE`;

  const calendar   = `Calendar: Sell near-expiry ${atm} option, Buy next-week/month ${atm} option (same strike)`;
  const straddle   = `Long Straddle: Buy ${atm} CE + Buy ${atm} PE`;
  const strangle   = `Long Strangle: Buy ${atm + dist} CE + Buy ${atm - dist} PE`;

  const butterflyCall = `Butterfly (Call): Buy ${atm} CE, Sell 2x ${atm + dist} CE, Buy ${atm + 2 * dist} CE`;
  const butterflyPut  = `Butterfly (Put): Buy ${atm} PE, Sell 2x ${atm - dist} PE, Buy ${atm - 2 * dist} PE`;
  const bwbCall       = `Broken Wing Butterfly (Call skew): Buy ${atm} CE, Sell 2x ${atm + dist} CE, Buy ${atm + 3 * dist} CE`;

  const ratio = biasKey === "BULL"
    ? `Ratio Spread (Bullish): Buy 1x ${atm} CE, Sell 2x ${atm + dist} CE (strict risk control)`
    : `Ratio Spread (Bearish): Buy 1x ${atm} PE, Sell 2x ${atm - dist} PE (strict risk control)`;

  const coveredCall = `Covered Call (Stock only): Hold shares + Sell OTM Call`;
  const marriedPut  = `Married Put (Stock only): Hold shares + Buy Put (protection)`;
  const csp         = `Cash-Secured Put (Stock only): Sell Put with cash reserved for assignment`;

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
    default: return "—";
  }
}

/**
 * Event sentiment "tilt":
 * - If chart signals are mixed (no strong bias), sentiment can gently push bias.
 * - It will NOT override strong bull/bear signals.
 */
function applyEventTilt(baseBias, scores, inputs) {
  const { bull, bear } = scores;
  const sentiment = inputs.eventSentiment;

  // Strong bias? do nothing
  if (baseBias === "BULL" || baseBias === "BEAR") return baseBias;

  // Mixed zone: allow a tilt if not strongly opposite
  if (sentiment === "GOOD" && bear < 3) return "BULL_TILT";
  if (sentiment === "BAD" && bull < 3) return "BEAR_TILT";
  return baseBias; // NONE
}

function decideStrategy(scores, inputs, ivHigh, ivLow) {
  const { bull, bear, range, breakout, breakdown, pressure } = scores;

  const bigMove = anyGroup("BIGMOVE");
  const pin = anyGroup("PIN");
  const eventDay = anyGroup("EVENT");

  const exp0 = inputs.dte === 0;
  const nearExpiry = inputs.dte <= 2;
  const hasBreakout = breakout >= 1;
  const hasBreakdown = breakdown >= 1;
  const stockOnlyAllowed = inputs.instrument === "STOCK";

  // base bias
  let bias = "NONE";
  if (bull >= 3 && bear < 3) bias = "BULL";
  if (bear >= 3 && bull < 3) bias = "BEAR";
  const isRange = range >= 2 && bias === "NONE";

  // apply event sentiment tilt if needed
  const tilted = applyEventTilt(bias, scores, inputs);

  // convert tilt into usable direction (soft)
  const softBull = tilted === "BULL_TILT";
  const softBear = tilted === "BEAR_TILT";

  const goal = inputs.goal;

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
      // pick side using strong bias or tilt
      const side = (bias === "BEAR" || softBear) ? "BEAR" : "BULL";
      key = side === "BEAR" ? "BEAR_CALL_CREDIT" : "BULL_PUT_CREDIT";
      title = "Hedge-like (Index) → Defined-risk Credit Spread";
      why = "Index has no shares. Use defined-risk spreads as hedge-style structures.";
    }
    return { key, title, why, bias: (bias !== "NONE" ? bias : (softBear ? "BEAR" : softBull ? "BULL" : "NONE")) };
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
      const side = (bias === "BEAR" || softBear) ? "BEAR" : "BULL";
      key = side === "BEAR" ? "BEAR_CALL_CREDIT" : "BULL_PUT_CREDIT";
      title = "Volatility note: IV High → Prefer defined-risk selling";
      why = "Buying straddle/strangle when IV high risks IV crush. Prefer spreads.";
    }
    return { key, title, why, bias: (bias !== "NONE" ? bias : (softBear ? "BEAR" : softBull ? "BULL" : "NONE")) };
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
      const side = (bias === "BEAR" || softBear) ? "BEAR" : (bias === "BULL" || softBull) ? "BULL" : "BULL";
      key = side === "BEAR" ? "BEAR_CALL_CREDIT" : "BULL_PUT_CREDIT";
      title = "Income → Credit Spread (defined risk)";
      why = "If not clean range, sell one side with hedge.";
    }
    return { key, title, why, bias: (bias !== "NONE" ? bias : (softBear ? "BEAR" : softBull ? "BULL" : "NONE")) };
  }

  // DIRECTIONAL goal
  if (goal === "DIRECTIONAL") {
    if ((bias === "BULL" || softBull) && ivLow && hasBreakout) {
      key = "BULL_CALL_DEBIT";
      title = "Directional Bullish → Bull Call Spread (Debit)";
      why = "Bull bias (or good-event tilt) + breakout + IV low = debit spread fits.";
    } else if ((bias === "BEAR" || softBear) && ivLow && hasBreakdown) {
      key = "BEAR_PUT_DEBIT";
      title = "Directional Bearish → Bear Put Spread (Debit)";
      why = "Bear bias (or bad-event tilt) + breakdown + IV low = debit spread fits.";
    } else if ((bias === "BULL" || softBull) && ivLow) {
      key = "LONG_CALL";
      title = "Directional Bullish → Long Call";
      why = "Bull bias (or good-event tilt) + IV low favors buying calls.";
    } else if ((bias === "BEAR" || softBear) && ivLow) {
      key = "LONG_PUT";
      title = "Directional Bearish → Long Put";
      why = "Bear bias (or bad-event tilt) + IV low favors buying puts.";
    } else if (ivHigh) {
      const side = (bias === "BEAR" || softBear) ? "BEAR" : "BULL";
      key = side === "BEAR" ? "BEAR_CALL_CREDIT" : "BULL_PUT_CREDIT";
      title = "Directional note: IV high → prefer Credit Spread";
      why = "When IV is high, buying options is expensive; defined-risk selling fits better.";
    }
    return { key, title, why, bias: (bias !== "NONE" ? bias : (softBear ? "BEAR" : softBull ? "BULL" : "NONE")) };
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
  else if ((bull >= 3 || softBull) && ivLow && hasBreakout) {
    key = "BULL_CALL_DEBIT";
    title = "AUTO → Bull Call Spread (Debit)";
    why = "Bull bias (or good-event tilt) + breakout + IV low favors debit spread.";
  }
  else if ((bear >= 3 || softBear) && ivLow && hasBreakdown) {
    key = "BEAR_PUT_DEBIT";
    title = "AUTO → Bear Put Spread (Debit)";
    why = "Bear bias (or bad-event tilt) + breakdown + IV low favors debit spread.";
  }
  else if ((bull >= 3 || softBull) && ivHigh) {
    key = "BULL_PUT_CREDIT";
    title = "AUTO → Bull Put Spread (Credit)";
    why = "IV High + bullish bias (or good-event tilt) = sell put spread (defined risk).";
  }
  else if ((bear >= 3 || softBear) && ivHigh) {
    key = "BEAR_CALL_CREDIT";
    title = "AUTO → Bear Call Spread (Credit)";
    why = "IV High + bearish bias (or bad-event tilt) = sell call spread (defined risk).";
  }
  else if (pin && ivLow && !bigMove) {
    key = "BUTTERFLY";
    title = "AUTO → Butterfly Spread (low vol / pinning)";
    why = "If you expect price to stick near a zone with low IV, butterflies can fit.";
  }
  else if (inputs.dte >= 7 && (ivLow || eventDay)) {
    key = "CALENDAR";
    title = "AUTO → Calendar Spread";
    why = "More time available; calendars fit slow near-term + later move/IV shift.";
  }
  else {
    key = "NONE";
    title = "AUTO → No Trade / Wait";
    why = "Signals not aligned enough.";
  }

  if (inputs.instrument === "STOCK" && key === "NONE") {
    key = "COVERED_CALL";
    title = "STOCK fallback → Covered Call";
    why = "If you hold stock and want income, covered calls are baseline.";
  }

  return { key, title, why, bias: (bias !== "NONE" ? bias : (softBear ? "BEAR" : softBull ? "BULL" : "NONE")) };
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

  // VIX -> IV state (auto if VIX entered)
  const vixInfo = vixBucket(inputs.vix);
  const vixIV = vixToIV(vixInfo.bucket);

  const ivHighManual = anyGroup("IV_HIGH");
  const ivLowManual  = anyGroup("IV_LOW");

  const ivHigh = inputs.vix ? vixIV.ivHigh : ivHighManual;
  const ivLow  = inputs.vix ? vixIV.ivLow  : ivLowManual;

  // Pills
  const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
  set("bullPill", `Bull: ${scores.bull}`);
  set("bearPill", `Bear: ${scores.bear}`);
  set("rangePill", `Range: ${scores.range}`);
  set("boPill", `Breakout: ${scores.breakout}`);
  set("bdPill", `Breakdown: ${scores.breakdown}`);
  set("ivPill", `IV: ${ivHigh ? "HIGH" : ivLow ? "LOW" : "-"}`);
  set("dtePill", `DTE: ${inputs.dte}`);

  const vixPill = document.getElementById("vixPill");
  if (vixPill) vixPill.textContent = `VIX: ${inputs.vix ? inputs.vix.toFixed(1) + " • " + vixInfo.label : "-"}`;

  const evtPill = document.getElementById("evtPill");
  if (evtPill) {
    const s = inputs.eventSentiment;
    evtPill.textContent = `Event: ${s === "GOOD" ? "GOOD" : s === "BAD" ? "BAD" : "NEUTRAL"}`;
  }

  const pick = decideStrategy(scores, inputs, ivHigh, ivLow);

  const strategyText = document.getElementById("strategyText");
  const detailText = document.getElementById("detailText");
  const legsText = document.getElementById("legsText");

  if (strategyText) strategyText.textContent = pick.title;

  let extra = [];
  if (anyGroup("EVENT")) extra.push("Event day ON → reduce size, defined risk preferred.");
  if (inputs.instrument === "INDEX") extra.push("Index mode: Covered Call / Married Put / CSP don’t apply.");
  if (!inputs.price) extra.push("Enter Price to generate strikes.");
  if (inputs.vix && vixInfo.bucket === "VERY_HIGH") extra.push("VIX very high → IV crush risk for option buying; prefer defined-risk selling.");
  if (inputs.vix && vixInfo.bucket === "VERY_LOW") extra.push("VIX very low → options cheap; volatility buys/debit spreads become more attractive.");
  if (inputs.eventSentiment === "GOOD") extra.push("Event sentiment = GOOD → bias tilt bullish if chart is mixed.");
  if (inputs.eventSentiment === "BAD") extra.push("Event sentiment = BAD → bias tilt bearish if chart is mixed.");

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

  ["instrument","goal","price","support","resistance","dte","vix","eventSentiment"].forEach(id => {
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
    document.getElementById("eventSentiment").value = "NEUTRAL";
    decide();
  });

  decide();
}

document.addEventListener("DOMContentLoaded", wireEvents);
