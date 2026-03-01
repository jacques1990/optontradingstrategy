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
  const instrument = document.getElementById("instrument").value; // INDEX | STOCK
  const goal = document.getElementById("goal").value; // AUTO | DIRECTIONAL | INCOME | VOLATILITY | HEDGE
  const price = Number(document.getElementById("price").value);
  const support = Number(document.getElementById("support").value);
  const resistance = Number(document.getElementById("resistance").value);
  const dte = Number(document.getElementById("dte").value);

  return {
    instrument,
    goal,
    price: Number.isFinite(price) && price > 0 ? price : null,
    support: Number.isFinite(support) && support > 0 ? support : null,
    resistance: Number.isFinite(resistance) && resistance > 0 ? resistance : null,
    dte
  };
}

function baseOtmDistance(dte) {
  // simple defaults for Nifty-like 50pt strikes
  if (dte <= 0) return 100;
  if (dte <= 2) return 150;
  if (dte <= 5) return 200;
  return 300;
}

/**
 * Builds readable option legs suggestions (examples).
 * NOTE: These are templates, not guaranteed profitable. Use risk control.
 */
function legsForStrategy(strategyKey, inputs, biasKey) {
  const atm = roundToStrike(inputs.price ?? 0);
  if (!atm) return "Enter price to generate example strikes.";

  const dist = baseOtmDistance(inputs.dte);
  const c1 = atm + dist;       // short call strike
  const c2 = c1 + 100;         // hedge buy call strike
  const p1 = atm - dist;       // short put strike
  const p2 = p1 - 100;         // hedge buy put strike

  // Debit spreads
  const bullCall = `Bull Call Spread (Debit): Buy ${atm} CE, Sell ${atm + dist} CE`;
  const bearPut  = `Bear Put Spread (Debit): Buy ${atm} PE, Sell ${atm - dist} PE`;

  // Credit spreads
  const bullPut  = `Bull Put Spread (Credit): Sell ${p1} PE, Buy ${p2} PE`;
  const bearCall = `Bear Call Spread (Credit): Sell ${c1} CE, Buy ${c2} CE`;

  // Neutral income
  const ironCondor = `Iron Condor: Sell ${c1} CE + Buy ${c2} CE, Sell ${p1} PE + Buy ${p2} PE`;
  const ironFly    = `Iron Butterfly: Sell ${atm} CE + Sell ${atm} PE, Buy ${atm + dist} CE + Buy ${atm - dist} PE`;

  // Volatility buys
  const straddle = `Long Straddle: Buy ${atm} CE + Buy ${atm} PE`;
  const strangle = `Long Strangle: Buy ${atm + dist} CE + Buy ${atm - dist} PE`;

  // Butterflies (low vol / pinning)
  const butterflyCall = `Butterfly (Call): Buy ${atm} CE, Sell 2x ${atm + dist} CE, Buy ${atm + 2 * dist} CE`;
  const butterflyPut  = `Butterfly (Put): Buy ${atm} PE, Sell 2x ${atm - dist} PE, Buy ${atm - 2 * dist} PE`;

  const bwbCall = `Broken Wing Butterfly (Call skew): Buy ${atm} CE, Sell 2x ${atm + dist} CE, Buy ${atm + 3 * dist} CE (wings uneven)`;

  const ratio = biasKey === "BULL"
    ? `Ratio Spread (Bullish example): Buy 1x ${atm} CE, Sell 2x ${atm + dist} CE (needs strict risk control)`
    : `Ratio Spread (Bearish example): Buy 1x ${atm} PE, Sell 2x ${atm - dist} PE (needs strict risk control)`;

  // Calendar (needs time)
  const calendar = `Calendar: Sell near-expiry ${atm} option, Buy next-week/month ${atm} option (same strike)`;

  // Stock-only
  const coveredCall = `Covered Call (Stock only): Hold shares + Sell OTM Call`;
  const marriedPut  = `Married Put (Stock only): Hold shares + Buy Put (protection)`;
  const csp         = `Cash-Secured Put (Stock only): Sell Put while holding cash to buy shares if assigned`;

  switch (strategyKey) {
    case "LONG_CALL": return `Long Call: Buy ${atm} CE`;
    case "LONG_PUT":  return `Long Put: Buy ${atm} PE`;
    case "BULL_CALL_DEBIT": return bullCall;
    case "BEAR_PUT_DEBIT":  return bearPut;
    case "BULL_PUT_CREDIT": return bullPut;
    case "BEAR_CALL_CREDIT":return bearCall;
    case "IRON_CONDOR": return ironCondor;
    case "IRON_BUTTERFLY": return ironFly;
    case "STRADDLE": return straddle;
    case "STRANGLE": return strangle;
    case "BUTTERFLY": return biasKey === "BEAR" ? butterflyPut : butterflyCall;
    case "BWB": return bwbCall;
    case "RATIO": return ratio;
    case "CALENDAR": return calendar;
    case "COVERED_CALL": return coveredCall;
    case "MARRIED_PUT": return marriedPut;
    case "CASH_SECURED_PUT": return csp;
    default:
      return "—";
  }
}

function decideStrategy(scores, inputs) {
  const { bull, bear, range, breakout, breakdown, pressure } = scores;

  const ivHigh = anyGroup("IV_HIGH");
  const ivLow  = anyGroup("IV_LOW");
  const bigMove = anyGroup("BIGMOVE");
  const pin = anyGroup("PIN");
  const eventDay = anyGroup("EVENT");

  const exp0 = inputs.dte === 0;

  // Bias key
  let bias = "NONE";
  if (bull >= 3 && bear < 3) bias = "BULL";
  if (bear >= 3 && bull < 3) bias = "BEAR";
  const isRange = range >= 2 && bias === "NONE";

  // Goal override
  const goal = inputs.goal;

  // Rule helpers
  const nearExpiry = inputs.dte <= 2;
  const hasBreakout = breakout >= 1;
  const hasBreakdown = breakdown >= 1;

  // STOCK-only strategies gating
  const stockOnlyAllowed = inputs.instrument === "STOCK";

  // Default
  let key = "NONE";
  let title = "No clear edge → Wait / No trade";
  let why = "Need clearer bias (bull/bear) OR range + high IV OR volatility setup.";
  let notes = [];

  // HEDGE goal
  if (goal === "HEDGE") {
    if (stockOnlyAllowed) {
      key = "MARRIED_PUT";
      title = "Hedge → Married Put (Protective Put)";
      why = "You want protection on stock. Buy put to cap downside.";
      return { key, title, why, bias };
    } else {
      // For Nifty index options: hedging = defined-risk spreads
      key = bias === "BEAR" ? "BEAR_CALL_CREDIT" : "BULL_PUT_CREDIT";
      title = "Hedge-like (Index) → Defined-risk Credit Spread";
      why = "Index has no shares. Best hedge-style structure is defined-risk spread.";
      return { key, title, why, bias };
    }
  }

  // VOLATILITY goal
  if (goal === "VOLATILITY") {
    if (ivLow && bigMove) {
      key = "STRADDLE";
      title = "Volatility → Long Straddle";
      why = "Low IV + expecting big move = volatility expansion setup.";
    } else if (ivLow && (eventDay || pressure)) {
      key = "STRANGLE";
      title = "Volatility → Long Strangle";
      why = "Low IV + possible breakout/big move, cheaper than straddle.";
    } else if (ivHigh) {
      title = "Volatility note: IV already high";
      why = "Buying straddle/strangle when IV is high can get crushed if IV drops. Prefer defined-risk spreads.";
      key = bias === "BEAR" ? "BEAR_CALL_CREDIT" : "BULL_PUT_CREDIT";
    }
    return { key, title, why, bias };
  }

  // INCOME goal
  if (goal === "INCOME") {
    if (isRange && ivHigh) {
      key = "IRON_CONDOR";
      title = "Income/Neutral → Iron Condor";
      why = "Range + High IV = best theta-selling environment (defined risk).";
    } else if (pin && (nearExpiry || exp0) && ivHigh) {
      key = "IRON_BUTTERFLY";
      title = "Income/Neutral → Iron Butterfly";
      why = "Pinning near strike + high premiums near expiry = iron fly income setup.";
    } else {
      key = bias === "BEAR" ? "BEAR_CALL_CREDIT" : "BULL_PUT_CREDIT";
      title = "Income → Credit Spread (defined risk)";
      why = "If not clean range, safer to sell one side with a hedge.";
    }
    return { key, title, why, bias };
  }

  // DIRECTIONAL goal
  if (goal === "DIRECTIONAL") {
    if (bias === "BULL" && ivLow && hasBreakout) {
      key = "BULL_CALL_DEBIT";
      title = "Directional Bullish → Bull Call Spread (Debit)";
      why = "Bull bias + low IV + breakout confirmation = debit spread fits.";
    } else if (bias === "BEAR" && ivLow && hasBreakdown) {
      key = "BEAR_PUT_DEBIT";
      title = "Directional Bearish → Bear Put Spread (Debit)";
      why = "Bear bias + low IV + breakdown confirmation = debit spread fits.";
    } else if (bias === "BULL" && ivLow) {
      key = "LONG_CALL";
      title = "Directional Bullish → Long Call";
      why = "Bull bias + low IV favors buying (or use bull call debit for defined risk).";
    } else if (bias === "BEAR" && ivLow) {
      key = "LONG_PUT";
      title = "Directional Bearish → Long Put";
      why = "Bear bias + low IV favors buying (or use bear put debit).";
    } else if (ivHigh) {
      key = bias === "BEAR" ? "BEAR_CALL_CREDIT" : "BULL_PUT_CREDIT";
      title = "Directional note: IV high → prefer Credit Spread";
      why = "When IV is high, buying options is expensive; defined-risk selling fits better.";
    }
    return { key, title, why, bias };
  }

  // AUTO mode (best fit)
  // 1) Range + High IV
  if (isRange && ivHigh) {
    key = "IRON_CONDOR";
    title = "AUTO → Iron Condor";
    why = "Range + High IV = classic income setup.";
  }
  // 2) Pinning near expiry
  else if (pin && (nearExpiry || exp0) && ivHigh && !bigMove) {
    key = "IRON_BUTTERFLY";
    title = "AUTO → Iron Butterfly";
    why = "Pinning/slow grind + near expiry + high IV favors iron fly income.";
  }
  // 3) Big move + low IV
  else if (bigMove && ivLow) {
    key = "STRADDLE";
    title = "AUTO → Long Straddle";
    why = "Low IV + expecting big move = volatility expansion.";
  }
  // 4) Bull breakout + low IV
  else if (bull >= 3 && ivLow && hasBreakout) {
    key = "BULL_CALL_DEBIT";
    title = "AUTO → Bull Call Spread (Debit)";
    why = "Bull bias + breakout + low IV favors debit spread.";
  }
  // 5) Bear breakdown + low IV
  else if (bear >= 3 && ivLow && hasBreakdown) {
    key = "BEAR_PUT_DEBIT";
    title = "AUTO → Bear Put Spread (Debit)";
    why = "Bear bias + breakdown + low IV favors debit spread.";
  }
  // 6) Bull bias + high IV -> bull put credit
  else if (bull >= 3 && ivHigh) {
    key = "BULL_PUT_CREDIT";
    title = "AUTO → Bull Put Spread (Credit)";
    why = "High IV + bullish bias = sell put spread (defined risk).";
  }
  // 7) Bear bias + high IV -> bear call credit
  else if (bear >= 3 && ivHigh) {
    key = "BEAR_CALL_CREDIT";
    title = "AUTO → Bear Call Spread (Credit)";
    why = "High IV + bearish bias = sell call spread (defined risk).";
  }
  // 8) Low vol / pinning + low IV -> butterfly (debit)
  else if (pin && ivLow && !bigMove) {
    key = "BUTTERFLY";
    title = "AUTO → Butterfly Spread (low vol / pinning)";
    why = "If you expect price to stick near a zone with low IV, butterflies can fit.";
  }
  // 9) Calendar (needs time)
  else if (inputs.dte >= 7 && (ivLow || eventDay)) {
    key = "CALENDAR";
    title = "AUTO → Calendar Spread";
    why = "More time available. Calendar fits when you expect near-term slow + later move/IV change.";
  }
  // 10) fallback
  else {
    key = "NONE";
    title = "AUTO → No Trade / Wait";
    why = "Signals not aligned enough. Wait for confirmation or clearer IV condition.";
  }

  // Stock-only suggestions (only if STOCK selected & goal not overriding)
  if (inputs.instrument === "STOCK" && key === "NONE") {
    // optional fallback
    key = "COVERED_CALL";
    title = "STOCK fallback → Covered Call";
    why = "If you hold stock and want income, covered calls are a baseline strategy.";
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

  // pills
  const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
  set("bullPill", `Bull: ${scores.bull}`);
  set("bearPill", `Bear: ${scores.bear}`);
  set("rangePill", `Range: ${scores.range}`);
  set("boPill", `Breakout: ${scores.breakout}`);
  set("bdPill", `Breakdown: ${scores.breakdown}`);
  set("ivPill", `IV: ${anyGroup("IV_HIGH") ? "HIGH" : anyGroup("IV_LOW") ? "LOW" : "-"}`);
  set("dtePill", `DTE: ${inputs.dte}`);

  const pick = decideStrategy(scores, inputs);

  const strategyText = document.getElementById("strategyText");
  const detailText = document.getElementById("detailText");
  const legsText = document.getElementById("legsText");

  if (strategyText) strategyText.textContent = pick.title;

  let extra = [];
  if (anyGroup("EVENT")) extra.push("Event risk ON → keep size small, defined risk preferred.");
  if (inputs.instrument === "INDEX") extra.push("Index mode: Stock-only strategies (covered call, married put, CSP) are not applicable.");
  if (!inputs.price) extra.push("Tip: enter Price to generate strikes.");

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

  ["instrument","goal","price","support","resistance","dte"].forEach(id => {
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
    document.getElementById("dte").value = "4";
    document.getElementById("goal").value = "AUTO";
    document.getElementById("instrument").value = "INDEX";
    decide();
  });

  decide();
}

document.addEventListener("DOMContentLoaded", wireEvents);
