// Finding recurring charges and fees in a list of transactions. Pure and deterministic:
// all money maths happens here, in JavaScript, never in a language model.

import { KNOWN, FEES, TRANSFER } from './known.js';

const DAY = 86400000;
const toDay = (iso) => Math.round(Date.parse(iso + 'T00:00:00Z') / DAY);
const fromDay = (d) => new Date(d * DAY).toISOString().slice(0, 10);
export const round2 = (x) => Math.round(x * 100) / 100;
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** '2026-11-18' -> 'Nov 18, 2026' */
export const fmtDate = (iso) => { const [y, m, d] = String(iso).split('-').map(Number); return `${MON[m - 1]} ${d}, ${y}`; };

const NOISE_PREFIX = /^(POS|DEBIT|DBT|CARD|PURCHASE|RECURRING|RECUR|ACH|ONLINE|PMT|PAYMENT TO|CHECKCARD|CHECK CARD|VISA|DDA|PREAUTHORIZED|PRE-AUTH|AUTOPAY|ELECTRONIC|WITHDRAWAL|BILL PAY|SQ|TST|SP|PAYPAL|PP|IN|WWW)\b\s*\*?\s*/;
const NOISE_TOKEN = new Set(['USA', 'US', 'INC', 'LLC', 'LTD', 'CORP', 'CO', 'COM', 'NET', 'ORG', 'WWW', 'HTTPS', 'HTTP', 'BILL', 'HELP', 'PAYMENT', 'PMT', 'THE', 'AND',
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY', 'DC']);

/** Match a descriptor against well-known merchants. */
export function knownMerchant(description) {
  const d = String(description).toUpperCase();
  return KNOWN.find((k) => k.re.test(d)) || null;
}

/** Match a descriptor against fee patterns. */
export function feeType(description) {
  const d = String(description).toUpperCase();
  return FEES.find((f) => f.re.test(d)) || null;
}

/**
 * Turn a raw bank descriptor into a stable grouping key: known merchants map to their name;
 * otherwise prefixes, reference numbers, digits, domains and state codes are removed and the
 * first two meaningful words are kept. "SQ *BLUE BOTTLE 8573 OAKLAND CA" -> "BLUE BOTTLE".
 */
export function merchantKey(description) {
  const known = knownMerchant(description);
  if (known) return known.name.toUpperCase();
  let s = String(description).toUpperCase();
  for (let i = 0; i < 4; i++) s = s.replace(NOISE_PREFIX, '');
  s = s.replace(/\*.*$/, (m) => (m.length > 1 ? ' ' + m.slice(1) : ''))
    .replace(/\.(COM|NET|ORG|CO|IO)\b/g, ' ')
    .replace(/[^A-Z0-9& ]/g, ' ');
  const tokens = s.split(/\s+/).filter((t) => t && !/\d/.test(t) && !NOISE_TOKEN.has(t) && t.length > 1);
  return tokens.slice(0, 2).join(' ') || String(description).toUpperCase().slice(0, 16).trim();
}

/** Cloud-safe version of a descriptor: letters and spaces only, no digits or symbols. */
export function scrubDescriptor(description) {
  return String(description).toUpperCase().replace(/[^A-Z&\s]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
}

const median = (xs) => {
  const v = [...xs].sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};

const CADENCES = [
  { id: 'weekly', label: 'Weekly', min: 5, max: 9, perMonth: 52 / 12, days: 7 },
  { id: 'biweekly', label: 'Every 2 weeks', min: 12, max: 16, perMonth: 26 / 12, days: 14 },
  { id: 'monthly', label: 'Monthly', min: 26, max: 35, perMonth: 1, days: 30.4 },
  { id: 'quarterly', label: 'Quarterly', min: 80, max: 100, perMonth: 1 / 3, days: 91 },
  { id: 'yearly', label: 'Yearly', min: 350, max: 380, perMonth: 1 / 12, days: 365 },
];

function cadenceFor(intervalDays) {
  return CADENCES.find((c) => intervalDays >= c.min && intervalDays <= c.max) || null;
}

/**
 * Analyse transactions. `hints` is optional per-key info from the language model:
 * { [key]: { name, category, kind } } where kind is 'subscription' | 'bill' | 'one-off' | ...
 * Returns the full report used by the UI.
 */
export function analyse(transactions, hints = {}) {
  const tx = transactions.filter((t) => t && t.date && Number.isFinite(t.amount));
  if (!tx.length) return emptyReport();
  const start = tx[0].date;
  const end = tx[tx.length - 1].date;
  const endDay = toDay(end);

  const fees = [];
  const groups = new Map();
  for (const t of tx) {
    // Zero-amount rows are kept: a $0.00 line is often the start of a free trial.
    if (t.amount > 0) continue;
    const fee = feeType(t.description);
    if (fee) { fees.push({ date: t.date, description: t.description, amount: round2(-t.amount), type: fee.type, tip: fee.tip }); continue; }
    const key = merchantKey(t.description);
    if (!groups.has(key)) groups.set(key, { key, descriptors: new Set(), charges: [] });
    const g = groups.get(key);
    g.descriptors.add(t.description);
    g.charges.push({ date: t.date, amount: round2(-t.amount) });
  }

  const subs = [];
  const merchants = [];
  for (const g of groups.values()) {
    const sample = [...g.descriptors][0];
    const known = knownMerchant(sample);
    const hint = hints[g.key] || {};
    const name = known?.name || hint.name || titleCase(g.key);
    const category = known?.category || hint.category || 'Other';
    const total = round2(g.charges.reduce((s, c) => s + c.amount, 0));
    merchants.push({ key: g.key, name, category, count: g.charges.length, total, descriptor: sample });

    const sub = recurringFrom(g, { known, hint, endDay, name, category, sample });
    if (sub) subs.push(sub);
  }

  flagOverlaps(subs);
  for (const s of subs) finalise(s);

  subs.sort((a, b) => Number(b.worthALook) - Number(a.worthALook) || b.yearly - a.yearly);
  merchants.sort((a, b) => b.total - a.total);
  fees.sort((a, b) => (a.date < b.date ? -1 : 1));

  const active = subs.filter((s) => s.active);
  const moneyOut = round2(tx.filter((t) => t.amount < 0).reduce((s, t) => s - t.amount, 0));
  const moneyIn = round2(tx.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0));
  return {
    range: { start, end, days: endDay - toDay(start) + 1 },
    count: tx.length,
    subscriptions: subs,
    fees,
    merchants,
    totals: {
      recurringMonthly: round2(active.reduce((s, x) => s + x.monthly, 0)),
      recurringYearly: round2(active.reduce((s, x) => s + x.yearly, 0)),
      worthALookYearly: round2(active.filter((x) => x.worthALook).reduce((s, x) => s + x.yearly, 0)),
      worthALookCount: active.filter((x) => x.worthALook).length,
      feesTotal: round2(fees.reduce((s, f) => s + f.amount, 0)),
      moneyOut,
      moneyIn,
    },
  };
}

function emptyReport() {
  return { range: null, count: 0, subscriptions: [], fees: [], merchants: [], totals: { recurringMonthly: 0, recurringYearly: 0, worthALookYearly: 0, worthALookCount: 0, feesTotal: 0, moneyOut: 0, moneyIn: 0 } };
}

function recurringFrom(g, { known, hint, endDay, name, category, sample }) {
  const charges = [...g.charges].sort((a, b) => (a.date < b.date ? -1 : 1));
  const days = charges.map((c) => toDay(c.date));
  const amounts = charges.map((c) => c.amount);
  const looksSub = Boolean(known) || hint.kind === 'subscription';
  if (!known && TRANSFER.test(String(sample).toUpperCase())) return null;
  const latest = amounts[amounts.length - 1];

  // Double billing: the same amount twice within 3 days.
  let doubleBilled = null;
  for (let i = 1; i < charges.length; i++) {
    if (days[i] - days[i - 1] <= 3 && Math.abs(amounts[i] - amounts[i - 1]) < 0.01) {
      doubleBilled = { date: charges[i].date, amount: amounts[i] };
    }
  }
  // Intervals ignore same-week duplicates so a double charge does not break the cadence.
  const intervals = [];
  for (let i = 1; i < days.length; i++) if (days[i] - days[i - 1] > 3) intervals.push(days[i] - days[i - 1]);

  let cadence = null;
  if (intervals.length) cadence = cadenceFor(median(intervals));
  const med = median(amounts);
  const stable = amounts.every((a) => Math.abs(a - med) <= Math.max(1, med * 0.25));

  // Same coffee every Monday is a habit, not a subscription: weekly patterns need a known merchant
  // or the model's "subscription" verdict.
  if (cadence && ['weekly', 'biweekly'].includes(cadence.id) && !looksSub) return null;

  let kind;
  if (cadence && (stable || looksSub)) kind = 'recurring';
  else if (charges.length === 1 && looksSub) kind = 'seen-once';
  else return null;
  if (hint.kind && !['subscription', 'bill'].includes(hint.kind) && !known) return null;

  if (kind === 'seen-once') {
    // One charge of a known subscription: assume yearly for larger amounts, monthly otherwise.
    cadence = latest >= 40 ? CADENCES.find((c) => c.id === 'yearly') : CADENCES.find((c) => c.id === 'monthly');
  }
  const lastDay = days[days.length - 1];
  const nextDay = nextChargeDay(charges[charges.length - 1].date, cadence);
  const active = kind === 'seen-once' ? true : endDay - lastDay <= cadence.days + 7;

  // Price change: compare the latest charge with the earliest one.
  let priceUp = null;
  const first = amounts[0];
  if (amounts.length >= 2 && latest - first >= 0.5 && latest / first >= 1.03) priceUp = { from: first, to: latest };

  // Trial that turned paid: an early charge of $0-1.99 followed by a full-price one.
  let trialConverted = null;
  if (amounts.length >= 2 && amounts[0] <= 1.99 && latest >= 4.99) trialConverted = { trial: amounts[0], now: latest, since: charges.find((c) => c.amount >= 4.99).date };
  if (trialConverted) priceUp = null;

  return {
    key: g.key,
    name,
    category,
    overlap: known?.overlap || null,
    descriptor: sample,
    known: Boolean(known),
    kind,
    cadence: cadence.id,
    cadenceLabel: kind === 'seen-once' ? `Probably ${cadence.label.toLowerCase()}` : cadence.label,
    charges,
    amount: latest,
    monthly: round2(latest * cadence.perMonth),
    yearly: round2(latest * cadence.perMonth * 12),
    lastDate: fromDay(lastDay),
    nextDate: active ? fromDay(nextDay) : null,
    daysToNext: active ? nextDay - endDay : null,
    active,
    flags: { priceUp, trialConverted, doubleBilled, overlapWith: [], renewsSoon: false, small: false, seenOnce: kind === 'seen-once' },
  };
}

/** Next expected charge: same day next month/quarter/year for calendar cadences. */
function nextChargeDay(lastIso, cadence) {
  const [y, m, d] = lastIso.split('-').map(Number);
  const months = { monthly: 1, quarterly: 3, yearly: 12 }[cadence.id];
  if (!months) return toDay(lastIso) + cadence.days;
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastOfMonth = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastOfMonth));
  return Math.round(target.getTime() / DAY);
}

function flagOverlaps(subs) {
  const byGroup = new Map();
  for (const s of subs) {
    if (!s.active || !s.overlap) continue;
    if (!byGroup.has(s.overlap)) byGroup.set(s.overlap, []);
    byGroup.get(s.overlap).push(s);
  }
  for (const list of byGroup.values()) {
    if (list.length < 2) continue;
    for (const s of list) s.flags.overlapWith = list.filter((o) => o !== s).map((o) => o.name);
  }
}

const OVERLAP_WORD = { video: 'streaming services', music: 'music services', storage: 'cloud storage plans', gym: 'gym memberships', meditation: 'meditation apps', delivery: 'delivery memberships', dating: 'dating apps' };

function finalise(s) {
  const f = s.flags;
  f.renewsSoon = s.cadence === 'yearly' && s.daysToNext != null && s.daysToNext <= 30;
  f.small = ['weekly', 'biweekly', 'monthly'].includes(s.cadence) && s.monthly > 0 && s.monthly <= 12;
  const reasons = [];
  if (f.doubleBilled) reasons.push(`Charged twice: $${f.doubleBilled.amount.toFixed(2)} again on ${fmtDate(f.doubleBilled.date)}`);
  if (f.trialConverted) reasons.push(f.trialConverted.trial === 0
    ? `Free trial turned into $${f.trialConverted.now.toFixed(2)} on ${fmtDate(f.trialConverted.since)}`
    : `$${f.trialConverted.trial.toFixed(2)} trial turned into $${f.trialConverted.now.toFixed(2)} on ${fmtDate(f.trialConverted.since)}`);
  if (f.priceUp) reasons.push(`Price went up from $${f.priceUp.from.toFixed(2)} to $${f.priceUp.to.toFixed(2)}`);
  if (f.overlapWith.length) reasons.push(`You also pay for ${f.overlapWith.join(', ')}: ${f.overlapWith.length + 1} ${OVERLAP_WORD[s.overlap] || 'similar services'}`);
  if (f.renewsSoon) reasons.push(`Yearly renewal of $${s.amount.toFixed(2)} expected around ${fmtDate(s.nextDate)}`);
  s.reasons = reasons;
  s.worthALook = s.active && reasons.length > 0;
  if (f.small && s.active) s.reasons.push(`Small enough to forget: $${s.monthly.toFixed(2)} a month`);
}

function titleCase(key) {
  return String(key).toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
}
