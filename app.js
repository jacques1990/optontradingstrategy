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
  const goal = document.getElementById("goal").value;
  const eventSentiment = document.getElementById("eventSentiment").value;

  const price = Number(document.getElementById("price").value);
  const support = Number(document.getElementById("support").value);
  const resistance = Number(document.getElementById("resistance").value);
  const dte = Number(document.getElementById("dte").value);
  const vix = Number(document.getElementById("vix").value);

  const prevClose = Number(document.getElementById("prevClose").value);
  const todayOpen = Number(document.getElementById("todayOpen").value);
  const gapBehavior = document.getElementById("gapBehavior").value;
  const vwapState = document.getElementById("vwapState").value;

  return {
    instrument,
    goal,
    eventSentiment,
    price: Number.isFinite(price) && price > 0 ? price : null,
    support: Number.isFinite(support) && support > 0 ? support : null,
    resistance: Number.isFinite(resistance) && resistance > 0 ? resistance : null,
    dte,
    vix: Number.isFinite(vix) && vix > 0 ? vix : null,

    prevClose: Number.isFinite(prevClose) && prevClose > 0 ? prevClose : null,
    todayOpen: Number.isFinite(todayOpen) && todayOpen > 0 ? todayOpen : null,
    gapBehavior,
    vwapState
  };
}

function baseOtmDistance(dte) {
  if (dte <= 0) return 100;
  if (dte <= 2) return 150;
  if (dte <= 5) return 200;
  return 300;
}

function computeGap(prevClose, todayOpen) {
  if (!Number.isFinite(prevClose) || !Number.isFinite(todayOpen)) return null;
  const pts = todayOpen - prevClose;
  const pct = (pts / prevClose) * 100;
  return { pts, pct };
}

function gapScenario(inputs, ivHigh, ivLow) {
  // This produces a readable scenario label based on the new inputs.
  const g = computeGap(inputs.prevClose, inputs.todayOpen);
  const beh = inputs.gapBehavior;

  if (!g) return { key: "NO_GAP_DATA", label: "No gap data" };

  const absPts = Math.abs(g.pts);
  const isBig = absPts >= 150; // tweakable threshold for Nifty
  const dir = g.pts < 0 ? "GAP_DOWN" : g.pts > 0 ? "GAP_UP" : "FLAT_OPEN";

  if (dir === "GAP_DOWN") {
    if (beh === "RECLAIM_VWAP" || beh === "REV_UP") return { key: "GAP_DOWN_REV", label: "Gap Down → Reversal/Reclaim" };
    if (beh === "CONT_DOWN") return { key: "GAP_DOWN_CONT", label: "Gap Down → Continuation Down" };
    if (beh === "CHOP_LOW" || beh === "REJECT_VWAP") return { key: "GAP_DOWN_CHOP", label: "Gap Down → Chop/Weak bounce" };
    if (beh === "WHIPSAW") return { key: "GAP_DOWN_WHIP", label: "Gap Down → Whipsaw" };
    if (beh === "RANGE_PIN") return { key: "GAP_DOWN_RANGE", label: "Gap Down → Range/Pin" };
    return { key: isBig ? "GAP_DOWN_BIG" : "GAP_DOWN", label: isBig ? "Gap Down (Big)" : "Gap Down" };
  }

  if (dir === "GAP_UP") {
    if (beh === "REJECT_VWAP" || beh === "CHOP_LOW") return { key: "GAP_UP_FADE", label: "Gap Up → Fade/Weakness" };
    if (beh === "CONT_DOWN") return { key: "GAP_UP_REV_DOWN", label: "Gap Up → Reverse Down" };
    if (beh === "RECLAIM_VWAP" || beh === "REV_UP") return { key: "GAP_UP_CONT", label: "Gap Up → Continuation Up" };
    if (beh === "RANGE_PIN") return { key: "GAP_UP_RANGE", label: "Gap Up → Range/Pin" };
    if (beh === "WHIPSAW") return { key: "GAP_UP_WHIP", label: "Gap Up → Whipsaw" };
    return { key: isBig ? "GAP_UP_BIG" : "GAP_UP", label: isBig ? "Gap Up (Big)" : "Gap Up" };
  }

  return { key: "FLAT_OPEN", label: "Flat open" };
}

function legsForStrategy(strategyKey, inputs, biasKey) {
  const atm = roundToStrike(inputs.price ?? inputs.todayOpen ?? 0);
  if (!atm) return "Enter Live Price (or Open) to generate example strikes.";

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

  const calendar = `Calendar: Sell near-expiry ${atm} option, Buy next-week/month ${atm} option (same strike)`;
  const straddle = `Long Straddle: Buy ${atm} CE + Buy ${atm} PE`;
  const strangle = `Long Strangle: Buy ${atm + dist} CE + Buy ${atm - dist} PE`;

  const butterflyCall = `Butterfly (Call): Buy ${atm} CE, Sell 2x ${atm + dist} CE, Buy ${atm + 2*dist} CE`;
  const butterflyPut  = `Butterfly (Put): Buy ${atm} PE, Sell 2x ${atm - dist} PE, Buy ${atm - 2*dist} PE`;

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
    default: return "—";
  }
}

function applyEventTilt(baseBias, scores, inputs) {
  const { bull, bear } = scores;
  const s = inputs.eventSentiment;

  if (baseBias === "BULL" || baseBias === "BEAR") return baseBias;
  if (s === "GOOD" && bear < 3) return "BULL_TILT";
  if (s === "BAD" && bull < 3) return "BEAR_TILT";
  return baseBias;
}

function decideStrategy(scores, inputs, ivHigh, ivLow, scenario) {
  const { bull, bear, range, breakout, breakdown } = scores;

  const bigMove = anyGroup("BIGMOVE");
  const pin = anyGroup("PIN");
  const eventDay = anyGroup("EVENT");

  // Base bias
  let bias = "NONE";
  if (bull >= 3 && bear < 3) bias = "BULL";
  if (bear >= 3 && bull < 3) bias = "BEAR";
  const isRange = range >= 2 && bias === "NONE";

  // Event tilt if mixed
  const tilted = applyEventTilt(bias, scores, inputs);
  const softBull = tilted === "BULL_TILT";
  const softBear = tilted === "BEAR_TILT";

  const goal = inputs.goal;
  const nearExpiry = inputs.dte <= 2;

  // ---- GAP SCENARIO PRIORITY (only when gap data exists) ----
  // These rules intentionally prefer defined-risk spreads on shock days.
  if (scenario.key.startsWith("GAP_DOWN")) {
    if (ivHigh && (inputs.gapBehavior === "CHOP_LOW" || inputs.gapBehavior === "REJECT_VWAP" || inputs.gapBehavior === "UNKNOWN")) {
      return {
        key: "BEAR_CALL_CREDIT",
        title: "GAP DOWN (chop/weak) → Bear Call Spread (Credit)",
        why: "Shock gap + IV high + weak bounce = sell call spread (defined risk).",
        bias: "BEAR"
      };
    }
    if (inputs.gapBehavior === "CONT_DOWN") {
      // If IV is extremely high, still prefer spread; if IV low (rare here), could buy puts.
      return {
        key: ivHigh ? "BEAR_CALL_CREDIT" : "BEAR_PUT_DEBIT",
        title: ivHigh ? "GAP DOWN continuation → Bear Call Spread (Credit)" : "GAP DOWN continuation → Bear Put Spread (Debit)",
        why: ivHigh ? "IV high favors selling spreads while trend stays down." : "IV low + continuation favors debit bear put spread.",
        bias: "BEAR"
      };
    }
    if (inputs.gapBehavior === "REV_UP" || inputs.gapBehavior === "RECLAIM_VWAP") {
      return {
        key: "BULL_PUT_CREDIT",
        title: "GAP DOWN reversal/reclaim → Bull Put Spread (Credit)",
        why: "Reversal + reclaim often causes IV to cool; selling put spread = defined risk.",
        bias: "BULL"
      };
    }
    if (inputs.gapBehavior === "RANGE_PIN" && ivHigh) {
      return {
        key: "IRON_CONDOR",
        title: "GAP DOWN then range + IV High → Iron Condor",
        why: "After shock, if price stabilizes into range and IV stays high, condor fits.",
        bias: "NONE"
      };
    }
    if (inputs.gapBehavior === "WHIPSAW") {
      return {
        key: "IRON_CONDOR",
        title: "GAP DOWN whipsaw → Stay defined risk (Condor only if clear range)",
        why: "Whipsaw days destroy option buyers; wait or use very conservative defined-risk setups.",
        bias: "NONE"
      };
    }
  }

  if (scenario.key.startsWith("GAP_UP")) {
    if (ivHigh && (inputs.gapBehavior === "GAP_UP_FADE" || inputs.gapBehavior === "REJECT_VWAP" || inputs.gapBehavior === "CHOP_LOW")) {
      return {
        key: "BULL_PUT_CREDIT",
        title: "GAP UP holding strength → Bull Put Spread (Credit)",
        why: "If market holds up and IV is high, selling put spread benefits from theta/IV cooling.",
        bias: "BULL"
      };
    }
    if (inputs.gapBehavior === "CONT_DOWN" || inputs.gapBehavior === "REJECT_VWAP") {
      return {
        key: "BEAR_CALL_CREDIT",
        title: "GAP UP fading → Bear Call Spread (Credit)",
        why: "Gap up fade + IV high often rewards call-side credit spread.",
        bias: "BEAR"
      };
    }
  }

  // ---- GOAL OVERRIDES (same as earlier logic) ----
  if (goal === "INCOME") {
    if (isRange && ivHigh) return { key:"IRON_CONDOR", title:"Income → Iron Condor", why:"Range + IV high = theta-selling environment.", bias:"NONE" };
    if (pin && nearExpiry && ivHigh) return { key:"IRON_BUTTERFLY", title:"Income → Iron Butterfly", why:"Pinning near expiry + IV high = iron fly setup.", bias:"NONE" };
    const side = (bias === "BEAR" || softBear) ? "BEAR" : "BULL";
    return { key: side==="BEAR" ? "BEAR_CALL_CREDIT":"BULL_PUT_CREDIT", title:"Income → Credit Spread (defined risk)", why:"Not clean range: sell one side with hedge.", bias: side };
  }

  if (goal === "VOLATILITY") {
    if (ivLow && bigMove) return { key:"STRADDLE", title:"Volatility → Long Straddle", why:"IV low + big move expected.", bias:"NONE" };
    if (ivLow) return { key:"STRANGLE", title:"Volatility → Long Strangle", why:"IV low + uncertainty, cheaper than straddle.", bias:"NONE" };
    // IV high -> avoid buying
    const side = (bias === "BEAR" || softBear) ? "BEAR" : "BULL";
    return { key: side==="BEAR" ? "BEAR_CALL_CREDIT":"BULL_PUT_CREDIT", title:"Volatility note → IV High, prefer spreads", why:"Avoid buying into high IV (crush risk).", bias: side };
  }

  if (goal === "DIRECTIONAL") {
    if ((bias === "BULL" || softBull) && ivLow && breakout >= 1) return { key:"BULL_CALL_DEBIT", title:"Directional Bull → Bull Call Spread (Debit)", why:"Bull + breakout + IV low.", bias:"BULL" };
    if ((bias === "BEAR" || softBear) && ivLow && breakdown >= 1) return { key:"BEAR_PUT_DEBIT", title:"Directional Bear → Bear Put Spread (Debit)", why:"Bear + breakdown + IV low.", bias:"BEAR" };
    if ((bias === "BULL" || softBull) && ivLow) return { key:"LONG_CALL", title:"Directional Bull → Long Call", why:"Bull + IV low.", bias:"BULL" };
    if ((bias === "BEAR" || softBear) && ivLow) return { key:"LONG_PUT", title:"Directional Bear → Long Put", why:"Bear + IV low.", bias:"BEAR" };
    const side = (bias === "BEAR" || softBear) ? "BEAR" : "BULL";
    return { key: side==="BEAR" ? "BEAR_CALL_CREDIT":"BULL_PUT_CREDIT", title:"Directional note → IV high, use credit spread", why:"Buying expensive options is risky.", bias: side };
  }

  // ---- AUTO fallback (non-gap days or no scenario selected) ----
  if (isRange && ivHigh) return { key:"IRON_CONDOR", title:"AUTO → Iron Condor", why:"Range + IV high.", bias:"NONE" };
  if (pin && nearExpiry && ivHigh && !bigMove) return { key:"IRON_BUTTERFLY", title:"AUTO → Iron Butterfly", why:"Pinning + near expiry + IV high.", bias:"NONE" };
  if (bigMove && ivLow) return { key:"STRADDLE", title:"AUTO → Long Straddle", why:"IV low + big move expected.", bias:"NONE" };

  if ((bull >= 3 || softBull) && ivHigh) return { key:"BULL_PUT_CREDIT", title:"AUTO → Bull Put Spread (Credit)", why:"IV high + bullish bias.", bias:"BULL" };
  if ((bear >= 3 || softBear) && ivHigh) return { key:"BEAR_CALL_CREDIT", title:"AUTO → Bear Call Spread (Credit)", why:"IV high + bearish bias.", bias:"BEAR" };

  if ((bull >= 3 || softBull) && ivLow) return { key:"BULL_CALL_DEBIT", title:"AUTO → Bull Call Spread (Debit)", why:"IV low + bullish bias.", bias:"BULL" };
  if ((bear >= 3 || softBear) && ivLow) return { key:"BEAR_PUT_DEBIT", title:"AUTO → Bear Put Spread (Debit)", why:"IV low + bearish bias.", bias:"BEAR" };

  if (inputs.dte >= 7 && (ivLow || eventDay)) return { key:"CALENDAR", title:"AUTO → Calendar Spread", why:"More time available + possible IV/slow move edge.", bias:"NONE" };

  return { key:"NONE", title:"AUTO → No Trade / Wait", why:"Signals not aligned enough.", bias:"NONE" };
}

function decide() {
  const inputs = getInputs();

  const scores = {
    bull: sumGroup("BULL"),
    bear: sumGroup("BEAR"),
    range: sumGroup("RANGE"),
    breakout: sumGroup("BREAKOUT"),
    breakdown: sumGroup("BREAKDOWN"),
    pressure: sumGroup("PRESSURE")
  };

  // VIX -> IV state (auto if VIX entered)
  const vixInfo = vixBucket(inputs.vix);
  const vixIV = vixToIV(vixInfo.bucket);

  const ivHighManual = anyGroup("IV_HIGH");
  const ivLowManual  = anyGroup("IV_LOW");

  const ivHigh = inputs.vix ? vixIV.ivHigh : ivHighManual;
  const ivLow  = inputs.vix ? vixIV.ivLow  : ivLowManual;

  // Gap calculation UI
  const gap = computeGap(inputs.prevClose, inputs.todayOpen);
  const gapPtsEl = document.getElementById("gapPillStatic");
  const gapPctEl = document.getElementById("gapPctStatic");
  if (gapPtsEl) gapPtsEl.value = gap ? `${gap.pts.toFixed(0)} pts` : "—";
  if (gapPctEl) gapPctEl.value = gap ? `${gap.pct.toFixed(2)} %` : "—";

  // Scenario
  const scen = gapScenario(inputs, ivHigh, ivLow);

  // Pills
  const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
  set("scenarioPill", `Scenario: ${scen.label}`);
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

  const pick = decideStrategy(scores, inputs, ivHigh, ivLow, scen);

  // Output
  const strategyText = document.getElementById("strategyText");
  const detailText = document.getElementById("detailText");
  const legsText = document.getElementById("legsText");

  if (strategyText) strategyText.textContent = pick.title;

  let notes = [];
  if (anyGroup("EVENT")) notes.push("Event day ON → reduce size; defined risk preferred.");
  if (inputs.vix && vixInfo.bucket === "VERY_HIGH") notes.push("VIX very high → avoid buying options (IV crush risk).");
  if (inputs.gapBehavior === "UNKNOWN") notes.push("Gap behavior = Unknown → wait first 15–30 minutes before committing.");
  if (!inputs.price && inputs.todayOpen) notes.push("Tip: Enter Live Price for better strike suggestions (Open will be used as fallback).");

  if (detailText) {
    detailText.textContent = `Why: ${pick.why}\n` + (notes.length ? `Notes:\n• ${notes.join("\n• ")}` : "");
  }

  if (legsText) {
    const legs = pick.key === "NONE" ? "—" : legsForStrategy(pick.key, inputs, pick.bias);
    legsText.textContent = `Example legs:\n${legs}`;
  }
}

function wireEvents() {
  document.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.addEventListener("change", decide));

  [
    "instrument","goal","eventSentiment",
    "price","support","resistance","dte","vix",
    "prevClose","todayOpen","gapBehavior","vwapState"
  ].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("input", decide);
    el.addEventListener("change", decide);
  });

  document.getElementById("resetBtn").addEventListener("click", () => {
    document.querySelectorAll('input[type="checkbox"]').forEach(cb => (cb.checked = false));
    ["price","support","resistance","vix","prevClose","todayOpen"].forEach(id => document.getElementById(id).value = "");
    document.getElementById("dte").value = "4";
    document.getElementById("goal").value = "AUTO";
    document.getElementById("instrument").value = "INDEX";
    document.getElementById("eventSentiment").value = "NEUTRAL";
    document.getElementById("gapBehavior").value = "UNKNOWN";
    document.getElementById("vwapState").value = "UNKNOWN";
    decide();
  });

  decide();
}

document.addEventListener("DOMContentLoaded", wireEvents);
