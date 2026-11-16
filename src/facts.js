// "Ask your statement": every number is worked out here, in plain JavaScript, before Gemini Nano sees
// anything. The statement becomes a sheet of short, finished sentences; for each question only the few
// that matter are picked, and the model only has to phrase the answer. Small on-device models are bad
// at arithmetic and at picking the right rows out of a long list, so neither job is left to them.
// Pure module, unit-tested.

import { fmtDate, round2 } from './detect.js';
import { TRANSFER } from './known.js';

const usd = (n) => `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const usd0 = (n) => `$${Math.round(Number(n)).toLocaleString('en-US')}`;
const list = (xs) => (xs.length <= 2 ? xs.join(' and ') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

// Everyday words people use for each category, so "how much on coffee" finds Coffee.
const CATEGORY_WORDS = {
  'Streaming video': 'streaming stream tv video movies shows',
  Music: 'music songs',
  Audiobooks: 'audiobooks audiobook books',
  'Cloud storage': 'storage cloud backup photos',
  Software: 'software apps app tools',
  News: 'news newspaper newspapers',
  Learning: 'learning courses language',
  Fitness: 'gym gyms fitness workout exercise',
  Wellbeing: 'wellbeing meditation wellness mental',
  Membership: 'membership memberships',
  'Delivery membership': 'delivery membership memberships',
  Gaming: 'gaming games',
  Dating: 'dating',
  Creators: 'creators patreon',
  'Phone & internet': 'phone internet mobile wifi cell',
  Utilities: 'utilities utility electric electricity power water gas heating',
  Insurance: 'insurance',
  'Rent & housing': 'rent housing mortgage home',
  'Loans & credit': 'loan loans credit debt',
  Groceries: 'groceries grocery supermarket food',
  Dining: 'dining restaurants restaurant eating lunch dinner food',
  Coffee: 'coffee cafe cafes',
  'Food delivery': 'delivery takeout takeaway',
  Transport: 'transport rides ride taxi uber lyft transit',
  Fuel: 'fuel gas petrol',
  Shopping: 'shopping clothes stores online',
  Travel: 'travel flights hotels trips',
  Health: 'health pharmacy doctor medical',
  'Personal care': 'haircut beauty salon',
  Entertainment: 'entertainment concerts tickets events fun',
  Education: 'education tuition school',
  Charity: 'charity donations',
  Transfers: 'transfers transfer zelle venmo sent',
  Cash: 'cash atm withdrawals',
};
const NAME_STOP = new Set(['the', 'and', 'new', 'one', 'plus', 'pay', 'payment', 'club', 'store', 'inc', 'com', 'membership']);
const COUNT_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const countWord = (n) => COUNT_WORDS[n] || String(n);
const sumOf = (items) => round2(items.reduce((t, f) => t + f.amount, 0));
const lowerFirst = (s) => s.charAt(0).toLowerCase() + s.slice(1);
const PER = { weekly: 'a week', biweekly: 'every two weeks', monthly: 'a month', quarterly: 'a quarter', yearly: 'a year' };

const stem = (w) => (w.length > 4 && w.endsWith('ies') ? `${w.slice(0, -3)}y` : w.length > 3 && /[^suiw]s$/.test(w) ? w.slice(0, -1) : w);
/** Lower-case word stems of a piece of text. */
export const words = (text) => String(text).toLowerCase().split(/[^a-z]+/).filter(Boolean).map(stem);
const nameWords = (name) => words(name).filter((w) => w.length > 2 && !NAME_STOP.has(w));

/**
 * Turn a report into short sentences, each with the words that should bring it up.
 * strong: words that point straight at this fact; weak: words that only hint at it.
 * general: facts used when the question matches nothing in particular.
 */
export function factSheet(report, { isSubscription = (s) => s.known } = {}) {
  const r = report;
  const months = r.range ? Math.max(1, Math.round(r.range.days / 30.44)) : 1;
  const facts = [];
  const add = (text, strong = [], weak = [], general = false) => facts.push({ text, strong: new Set(strong.flatMap(words)), weak: new Set(weak.flatMap(words)), general });

  const period = r.range
    ? `This statement runs from ${fmtDate(r.range.start)} to ${fmtDate(r.range.end)}, about ${months} ${months === 1 ? 'month' : 'months'}.`
    : 'This statement has no dated transactions.';

  add(`Over this statement, ${usd(r.totals.moneyOut)} went out of the account and ${usd(r.totals.moneyIn)} came in.`,
    ['total', 'overall', 'altogether', 'income', 'earn', 'earned', 'salary', 'paycheck', 'deposits', 'came'], ['spend', 'spent', 'money', 'out'], true);

  // Repeating charges, grouped by category, with "a month" and "a year" already worked out.
  const active = r.subscriptions.filter((s) => s.active);
  const byCat = new Map();
  for (const s of active) byCat.set(s.category, [...(byCat.get(s.category) || []), s]);
  for (const [cat, items] of byCat) {
    const monthly = round2(items.reduce((t, s) => t + s.monthly, 0));
    const yearly = round2(items.reduce((t, s) => t + s.yearly, 0));
    const paid = round2(items.reduce((t, s) => t + s.charges.reduce((u, c) => u + c.amount, 0), 0));
    const each = items.map((s) => `${s.name} ${usd(s.amount)} ${PER[s.cadence] || 'each time'}`);
    const sum = items.length > 1 ? 'Together that is' : 'That is';
    add(`${cat} you pay for regularly: ${list(each)}. ${sum} ${usd(monthly)} a month, or ${usd0(yearly)} a year at current prices. Over this statement you paid ${usd(paid)} for ${items.length > 1 ? 'them' : 'it'}.`,
      [cat, CATEGORY_WORDS[cat] || '', ...items.map((s) => nameWords(s.name).join(' '))], ['spend', 'spent', 'pay', 'paid', 'cost', 'year', 'month']);
  }

  const subs = active.filter(isSubscription);
  const bills = active.filter((s) => !isSubscription(s));
  if (subs.length) {
    add(`All ${subs.length} subscriptions together cost ${usd(round2(subs.reduce((t, s) => t + s.monthly, 0)))} a month, or ${usd0(subs.reduce((t, s) => t + s.yearly, 0))} a year.`,
      ['subscription', 'subscriptions'], ['recurring', 'repeating', 'regular', 'monthly', 'month', 'year', 'total'], true);
  }
  if (bills.length) {
    const cats = [...new Set(bills.map((s) => s.category.toLowerCase()))].filter((c) => c !== 'other');
    add(`Regular bills${cats.length ? ` (${list(cats)})` : ''} together cost ${usd(round2(bills.reduce((t, s) => t + s.monthly, 0)))} a month, or ${usd0(bills.reduce((t, s) => t + s.yearly, 0))} a year.`,
      ['bill', 'bills'], ['recurring', 'repeating', 'regular', 'monthly', 'month', 'year', 'total'], true);
  }
  if (active.length) {
    const top = [...active].sort((a, b) => b.yearly - a.yearly).slice(0, 5);
    add(`The biggest repeating costs, largest first: ${top.map((s, i) => `${i + 1}) ${s.name}, ${usd0(s.yearly)} a year`).join('; ')}.`,
      ['biggest', 'largest', 'top', 'expensive', 'most'], ['repeating', 'recurring', 'regular', 'cost', 'costs', 'subscription', 'bill']);
  }

  const ghosts = active.filter((s) => s.worthALook);
  if (ghosts.length) {
    const total = ghosts.reduce((t, s) => t + s.yearly, 0);
    const shown = [...ghosts].sort((a, b) => b.yearly - a.yearly).slice(0, 6);
    const more = ghosts.length - shown.length;
    const items = shown.map((s) => `${s.name} (${usd0(s.yearly)} a year; ${s.reasons[0].charAt(0).toLowerCase()}${s.reasons[0].slice(1)})`);
    if (more) items.push(`${more} smaller ${more === 1 ? 'one' : 'ones'}`);
    add(`${ghosts.length} repeating charges are worth a look, together ${usd0(total)} a year: ${list(items)}.`,
      ['save', 'saving', 'savings', 'cancel', 'cut', 'forgot', 'forgotten', 'worth', 'waste', 'unused', 'reduce', 'trial', 'price', 'increase', 'twice', 'double', 'overlap', 'duplicate', 'ghost'], ['subscription', 'look'], true);
  }

  // Fees, one sentence per type, with the usual way to avoid them. One dollar amount per sentence and
  // counts in words: with "3 charges, $10.50" side by side, a small model can swap the numbers.
  if (r.fees.length) {
    add(`Bank fees in this statement add up to ${usd(r.totals.feesTotal)}.`, ['fee', 'fees', 'bank'], ['charge', 'charges', 'avoid', 'avoided'], true);
    const byType = new Map();
    for (const f of r.fees) byType.set(f.type, [...(byType.get(f.type) || []), f]);
    for (const [type, items] of [...byType].sort((a, b) => sumOf(b[1]) - sumOf(a[1]))) {
      const times = items.length === 1 ? 'once' : `${countWord(items.length)} times`;
      add(`${type}s cost ${usd(sumOf(items))} in total (charged ${times}). How to avoid them: ${lowerFirst(items[0].tip)}`,
        ['fee', 'fees', 'avoid', 'avoided', 'avoidable', type], ['bank', 'charge', 'charges']);
    }
  }

  // Day-to-day spending: everything that is not a repeating charge.
  const recurringKeys = new Set(r.subscriptions.map((s) => s.key));
  const daily = r.merchants.filter((m) => !recurringKeys.has(m.key) && !TRANSFER.test(String(m.descriptor).toUpperCase()));
  const spendCat = new Map();
  for (const m of daily) {
    if (m.category === 'Other') continue;
    spendCat.set(m.category, [...(spendCat.get(m.category) || []), m]);
  }
  for (const [cat, ms] of spendCat) {
    const total = round2(ms.reduce((t, m) => t + m.total, 0));
    const count = ms.reduce((t, m) => t + m.count, 0);
    const where = [...ms].sort((a, b) => b.total - a.total).slice(0, 2).map((m) => m.name);
    add(`Day-to-day spending on ${cat.toLowerCase()}: ${usd(total)} over this statement, about ${usd(total / months)} a month, across ${count} ${count === 1 ? 'purchase' : 'purchases'}, mostly at ${list(where)}.`,
      [cat, CATEGORY_WORDS[cat] || '', ...ms.slice(0, 3).map((m) => nameWords(m.name).join(' '))], ['spend', 'spent', 'spending', 'month', 'year']);
  }
  if (daily.length) {
    const top = daily.slice(0, 5); // merchants are already sorted by total
    add(`Where the most day-to-day money went: ${list(top.map((m) => `${m.name} ${usd(m.total)}`))}.`,
      ['most', 'store', 'stores', 'shop', 'merchant', 'merchants', 'place', 'places'], ['where', 'spend', 'spent', 'money']);
  }
  // Single places, for "how much at Starbucks?"
  for (const m of daily.slice(0, 40)) {
    add(`${m.name}: ${usd(m.total)} over this statement, across ${m.count} ${m.count === 1 ? 'purchase' : 'purchases'}, about ${usd(m.total / months)} a month.`,
      [nameWords(m.name).join(' ')], ['spend', 'spent', 'month', 'year']);
  }

  return { period, facts };
}

/** Dollar amounts written in a piece of text, as numbers: "$1,853" -> 1853, "$4.50" -> 4.5. */
export function amountsIn(text) {
  return [...String(text).matchAll(/\$\s?(\d[\d,]*(?:\.\d+)?)/g)].map((m) => Number(m[1].replace(/,/g, '')));
}

/**
 * Amounts in the model's answer that are not among the facts it was given. Rounding a fact to whole
 * dollars is fine ($564.59 -> $565); any other number means the model made it up or swapped it.
 */
export function unsupportedAmounts(answer, facts) {
  const allowed = amountsIn(facts.join('\n'));
  return amountsIn(answer).filter((a) => !allowed.some((b) => Math.abs(a - b) < 0.005 || (Number.isInteger(a) && Math.round(b) === a)));
}

/** The period line plus the few facts that best match the question. */
export function pickFacts(question, sheet, max = 6) {
  const q = new Set(words(question));
  const hits = (set) => [...set].filter((w) => q.has(w)).length;
  const scored = sheet.facts.map((f) => ({ f, score: 3 * hits(f.strong) + hits(f.weak) }));
  const best = Math.max(0, ...scored.map((s) => s.score));
  // No word that points at a particular fact: give a short overview instead of loose matches.
  const chosen = best < 3
    ? sheet.facts.filter((f) => f.general)
    : scored.filter((s) => s.score >= Math.max(3, best / 2)).sort((a, b) => b.score - a.score).map((s) => s.f);
  return [sheet.period, ...chosen.slice(0, max).map((f) => f.text)];
}
