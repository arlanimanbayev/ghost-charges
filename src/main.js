// Ghost Charges UI. Statement in -> rules-based report at once -> merchant names refined by the
// hybrid model -> report re-rendered. Everything lives in memory; nothing is stored.

import { parseAny, parseText } from './parse.js';
import { analyse, fmtDate, round2, merchantKey, feeType } from './detect.js';
import { factSheet, pickFacts, unsupportedAmounts } from './facts.js';
import { retryNote } from './prompts.js';
import { createAI } from './ai.js';

const $ = (id) => document.getElementById(id);
const money = (n) => `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const money0 = (n) => `$${Math.round(Number(n)).toLocaleString('en-US')}`;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const SAMPLES = {
  checking: { url: '/samples/northfield-checking-12-months.csv', name: 'northfield-checking-12-months.csv' },
  pdf: { url: '/samples/northfield-statement-aug-oct-2026.pdf', name: 'northfield-statement-aug-oct-2026.pdf' },
  card: { url: '/samples/card-export-aug-oct-2026.csv', name: 'card-export-aug-oct-2026.csv' },
};

const state = {
  ai: null,
  fileName: '',
  transactions: [],
  hints: {},
  report: null,
  decisions: new Map(), // key -> 'keep' | 'cancel'
  kits: new Map(), // key -> cancel guide
  ledger: [],
  device: 'checking',
};

// ---------- boot ----------
init();

async function init() {
  wireInput();
  state.ai = await (globalThis.__GHOST_DEV_AI__ ? globalThis.__GHOST_DEV_AI__({ onLedger }) : createAI({ onLedger }));
  await refreshDevice();
}

async function refreshDevice() {
  state.device = state.ai.connected ? await state.ai.deviceAvailability() : 'disconnected';
  renderDevice();
}

function renderDevice(progress) {
  const btn = $('device');
  const text = $('device-text');
  const s = state.device;
  btn.dataset.state = s;
  btn.disabled = s !== 'downloadable';
  const labels = {
    available: 'Gemini Nano is ready on this device',
    downloadable: 'Set up on-device AI (one-time download)',
    downloading: progress != null ? `Downloading Gemini Nano: ${Math.round(progress * 100)}%` : 'Downloading Gemini Nano',
    unavailable: "This computer can't run Gemini Nano: names use the cloud, letters only",
    unsupported: "No on-device AI in this browser: names use the cloud, letters only",
    disconnected: 'AI is off in this copy: rules only',
    checking: 'Checking for on-device AI',
  };
  text.textContent = labels[s] || s;
}

$('device').addEventListener('click', async () => {
  if (state.device !== 'downloadable') return;
  state.device = 'downloading';
  renderDevice(0);
  try {
    await state.ai.prepareDevice((p) => renderDevice(p));
  } catch (e) {
    showError(`Gemini Nano couldn't be set up: ${e.message}`);
  }
  await refreshDevice();
});

// ---------- input ----------
function wireInput() {
  const drop = $('drop');
  const file = $('file');
  file.addEventListener('change', () => file.files[0] && readFile(file.files[0]));
  ['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => { const f = e.dataTransfer.files[0]; if (f) readFile(f); });
  document.querySelectorAll('[data-sample]').forEach((b) => b.addEventListener('click', () => loadSample(b.dataset.sample)));
  $('paste-go').addEventListener('click', () => {
    const text = $('paste').value;
    if (!text.trim()) return showError('Paste some statement lines first: each line needs a date, a description and an amount.');
    start('pasted text', parseText(text));
  });
  $('restart').addEventListener('click', () => {
    $('results').hidden = true;
    $('intro').hidden = false;
    $('file').value = '';
    window.scrollTo({ top: 0 });
  });
  $('ask-form').addEventListener('submit', (e) => { e.preventDefault(); ask($('question').value); });
  $('chips').addEventListener('click', (e) => { if (e.target.tagName === 'BUTTON') { $('question').value = e.target.textContent; ask(e.target.textContent); } });
  $('plan-download').addEventListener('click', downloadPlan);
}

async function loadSample(id) {
  const s = SAMPLES[id];
  const r = await fetch(s.url);
  const blob = await r.blob();
  readFile(new File([blob], s.name, { type: id === 'pdf' ? 'application/pdf' : 'text/csv' }));
}

async function readFile(f) {
  hideError();
  try {
    if (/\.pdf$/i.test(f.name) || f.type === 'application/pdf') {
      const { pdfToLines } = await import('./pdf.js');
      const lines = await pdfToLines(await f.arrayBuffer());
      start(f.name, parseText(lines.join('\n')));
    } else {
      start(f.name, parseAny(await f.text()));
    }
  } catch (e) {
    showError(`Couldn't read ${f.name}: ${e.message}`);
  }
}

function showError(msg) { const el = $('error'); el.textContent = msg; el.hidden = false; }
function hideError() { $('error').hidden = true; }

// ---------- analysis ----------
async function start(name, parsed) {
  if (!parsed.transactions.length) {
    return showError("No transactions found. The file needs a date, a description and an amount on each line; a CSV export from your bank's website works best.");
  }
  state.fileName = name;
  state.transactions = parsed.transactions;
  state.signFlipped = parsed.signFlipped;
  state.hints = {};
  state.decisions = new Map();
  state.kits = new Map();
  state.report = analyse(state.transactions);
  $('intro').hidden = true;
  $('results').hidden = false;
  renderAll(true);
  window.scrollTo({ top: 0 });
  await nameMerchants();
}

async function nameMerchants() {
  const naming = $('naming');
  if (!state.ai.connected) { naming.textContent = 'Merchant names come from built-in rules in this copy.'; return; }
  const unknown = state.report.merchants.filter((m) => !state.report.subscriptions.find((s) => s.key === m.key && s.known));
  if (!unknown.length) { naming.textContent = ''; return; }
  const where = state.device === 'available' ? 'Gemini Nano on this device' : "Gemini in Google's cloud (merchant names only, no numbers)";
  naming.textContent = `Cleaning up ${unknown.length} merchant names with ${where}…`;
  try {
    const hints = await state.ai.nameMerchants(unknown, (i, n, source) => {
      naming.textContent = `Cleaning up merchant names with ${source === 'on_device' ? 'Gemini Nano on this device' : "Gemini in Google's cloud (names only, no numbers)"}: part ${i} of ${n}`;
    });
    state.hints = hints;
    state.report = analyse(state.transactions, hints);
    const last = state.ledger[state.ledger.length - 1];
    naming.textContent = `${Object.keys(hints).length} merchant names cleaned up by ${last?.source === 'in_cloud' ? "Gemini in Google's cloud, from names with every number removed" : 'Gemini Nano on this device'}.`;
    renderAll(false);
  } catch (e) {
    naming.textContent = `Merchant names kept as they appear on the statement (${e.message}).`;
  }
}

// ---------- rendering ----------
const isSubscription = (s) => s.known || state.hints[s.key]?.kind === 'subscription';

function renderAll(first) {
  const r = state.report;
  const active = r.subscriptions.filter((s) => s.active);
  const ghosts = active.filter((s) => s.worthALook);
  const subs = active.filter((s) => !s.worthALook && isSubscription(s));
  const bills = active.filter((s) => !s.worthALook && !isSubscription(s));
  const stopped = r.subscriptions.filter((s) => !s.active);
  const subsMonthly = round2(active.filter(isSubscription).reduce((t, s) => t + s.monthly, 0));
  const billsMonthly = round2(active.filter((s) => !isSubscription(s)).reduce((t, s) => t + s.monthly, 0));

  $('file-line').innerHTML = `<span>${esc(state.fileName)}</span><span>${fmtDate(r.range.start)} to ${fmtDate(r.range.end)}</span><span>${r.count} transactions</span>${state.signFlipped ? '<span>Purchases were positive in this file, so the signs were flipped</span>' : ''}`;
  $('verdict').textContent = ghosts.length
    ? `${ghosts.length} ${ghosts.length === 1 ? 'charge is' : 'charges are'} worth a look. Together they cost ${money0(r.totals.worthALookYearly)} a year.`
    : r.subscriptions.length
      ? 'Nothing here looks forgotten. Your repeating charges are listed below.'
      : "No repeating charges found. A longer statement (three months or more) shows more.";
  renderTally(subsMonthly, billsMonthly);

  $('ghosts').innerHTML = ghosts.map(ghostItem).join('');
  $('ghosts-group').hidden = !ghosts.length;
  $('fees').innerHTML = feeItems(r.fees);
  $('fees-group').hidden = !r.fees.length;
  $('subs').innerHTML = subs.map(rowItem).join('');
  $('subs-group').hidden = !subs.length;
  $('bills').innerHTML = bills.map(rowItem).join('');
  $('bills-group').hidden = !bills.length;
  $('stopped').innerHTML = stopped.map(rowItem).join('');
  $('stopped-group').hidden = !stopped.length;
  wireRows();
  renderStatement(first);
  renderPlan();
}

function renderTally(subsMonthly, billsMonthly) {
  const r = state.report;
  $('tally').innerHTML = `
    <div><dt>Subscriptions</dt><dd>${money(subsMonthly)}<small> a month</small></dd></div>
    <div><dt>Bills</dt><dd>${money(billsMonthly)}<small> a month</small></dd></div>
    <div><dt>Fees in this statement</dt><dd>${money(r.totals.feesTotal)}</dd></div>
    <div class="plan"><dt>Your cancel plan</dt><dd id="plan-total">$0<small> a year</small></dd></div>`;
}

function ghostItem(s) {
  const d = state.decisions.get(s.key);
  const next = s.nextDate ? `, next around ${fmtDate(s.nextDate)}` : '';
  return `<li class="ghost${d ? ` is-${d}` : ''}" data-key="${esc(s.key)}">
    <div class="g-head"><h4>${esc(s.name)}</h4><p class="g-amt">${money(s.amount)}<small>${s.cadence === 'yearly' ? ' a year' : s.cadence === 'monthly' ? ' a month' : ' each'}</small></p></div>
    <p class="g-meta">${esc(s.category)}, ${esc(s.cadenceLabel.toLowerCase())}${next}. ${money0(s.yearly)} a year.</p>
    <ul class="g-why">${s.reasons.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
    <div class="g-act">
      <button type="button" class="act-cancel" aria-pressed="${d === 'cancel'}">${d === 'cancel' ? 'In your cancel plan' : 'Add to cancel plan'}</button>
      <button type="button" class="act-keep" aria-pressed="${d === 'keep'}">${d === 'keep' ? 'Keeping it' : 'Keep it'}</button>
      <button type="button" class="act-howto">How to cancel</button>
    </div>
  </li>`;
}

function rowItem(s) {
  const next = s.nextDate ? `next around ${fmtDate(s.nextDate)}` : `last charged ${fmtDate(s.lastDate)}`;
  const hint = state.hints[s.key];
  const cat = hint?.category || s.category;
  return `<li data-key="${esc(s.key)}"><span class="r-name">${esc(s.name)}</span><span class="r-meta">${esc(cat)}, ${esc(s.cadenceLabel.toLowerCase())}, ${next}</span><span class="r-amt">${money(s.amount)}</span></li>`;
}

function feeItems(fees) {
  const byType = new Map();
  for (const f of fees) {
    if (!byType.has(f.type)) byType.set(f.type, { type: f.type, tip: f.tip, items: [] });
    byType.get(f.type).items.push(f);
  }
  return [...byType.values()].sort((a, b) => sum(b.items) - sum(a.items)).map((g) => `<li>
    <div class="f-head"><h4>${esc(g.type)}</h4><p class="f-amt">${money(sum(g.items))}</p></div>
    <p class="f-dates">${g.items.length === 1 ? 'Once' : `${g.items.length} times`}: ${g.items.map((i) => fmtDate(i.date).replace(/, \d{4}$/, '')).join(', ')}</p>
    <p class="f-tip">${esc(g.tip)}</p>
  </li>`).join('');
}
const sum = (items) => round2(items.reduce((t, i) => t + i.amount, 0));

function wireRows() {
  $('ghosts').querySelectorAll('li.ghost').forEach(wireGhost);
}

function wireGhost(li) {
  const key = li.dataset.key;
  li.querySelector('.act-cancel').addEventListener('click', () => decide(key, 'cancel'));
  li.querySelector('.act-keep').addEventListener('click', () => decide(key, 'keep'));
  li.querySelector('.act-howto').addEventListener('click', () => openKit(key));
  li.addEventListener('mouseenter', () => highlightRows(key));
  li.addEventListener('focusin', () => highlightRows(key));
}

function decide(key, choice) {
  state.decisions.set(key, state.decisions.get(key) === choice ? undefined : choice);
  const old = $('ghosts').querySelector(`li[data-key="${CSS.escape(key)}"]`);
  const s = state.report.subscriptions.find((x) => x.key === key);
  if (old) {
    const tpl = document.createElement('template');
    tpl.innerHTML = ghostItem(s).trim();
    const li = tpl.content.firstElementChild;
    old.replaceWith(li);
    wireGhost(li);
  }
  renderPlan();
}

function renderPlan() {
  const planned = state.report.subscriptions.filter((s) => state.decisions.get(s.key) === 'cancel');
  const total = round2(planned.reduce((t, s) => t + s.yearly, 0));
  const el = $('plan-total');
  if (el) el.innerHTML = `${money0(total)}<small> a year</small>`;
  $('plan-download').disabled = !planned.length;
}

// ---------- statement strip ----------
function renderStatement(first) {
  const subKeys = new Set(state.report.subscriptions.map((s) => s.key));
  const ghostKeys = new Set(state.report.subscriptions.filter((s) => s.worthALook).map((s) => s.key));
  const rows = [...state.transactions].reverse().slice(0, 1500);
  const monthName = (iso) => new Date(iso + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  let lastMonth = '';
  const html = rows.map((t) => {
    const fee = t.amount < 0 && feeType(t.description);
    const key = !fee && t.amount <= 0 ? merchantKey(t.description) : null;
    const tracked = key && subKeys.has(key);
    const cls = fee ? 'fee' : tracked && ghostKeys.has(key) ? 'haunted' : '';
    const amt = t.amount > 0 ? `+${money(t.amount)}` : `-${money(-t.amount)}`;
    const m = t.date.slice(0, 7);
    const head = m !== lastMonth ? `<tr class="month"><th colspan="3" scope="rowgroup">${monthName(t.date)}</th></tr>` : '';
    lastMonth = m;
    return `${head}<tr${cls ? ` class="${cls}"` : ''}${tracked ? ` data-key="${esc(key)}"` : ''}><td class="t-date">${Number(t.date.slice(8))}</td><td class="t-desc">${esc(t.description)}</td><td class="t-amt${t.amount > 0 ? ' in' : ''}">${amt}</td></tr>`;
  }).join('');
  $('tx').querySelector('tbody').innerHTML = html;
  const paper = $('paper');
  paper.classList.remove('reveal');
  if (first && !matchMedia('(prefers-reduced-motion: reduce)').matches) { void paper.offsetWidth; paper.classList.add('reveal'); }
}

function highlightRows(key) {
  const paper = $('paper');
  paper.querySelectorAll('tr.lit').forEach((r) => r.classList.remove('lit'));
  const rows = paper.querySelectorAll(`tr[data-key="${CSS.escape(key)}"]`);
  rows.forEach((r) => r.classList.add('lit'));
  if (rows[0]) {
    const top = rows[0].offsetTop - paper.clientHeight / 3;
    paper.scrollTo({ top, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }
}

// ---------- cancel kit ----------
async function openKit(key) {
  const s = state.report.subscriptions.find((x) => x.key === key);
  const dlg = $('kit');
  $('kit-title').textContent = `How to cancel ${s.name}`;
  $('kit-source').textContent = '';
  $('kit-body').innerHTML = '<p class="loading">Writing the steps…</p>';
  dlg.showModal();
  try {
    const kit = state.kits.get(key) || await state.ai.cancelKit(s.name);
    state.kits.set(key, kit);
    $('kit-source').innerHTML = kit.source === 'on_device'
      ? 'Written by Gemini Nano on this device, offline. Only the name was used.'
      : `Written by Gemini in Google's cloud. It was sent the name <q>${esc(s.name)}</q> and nothing else.`;
    $('kit-body').innerHTML = `
      ${kit.where ? `<p class="kit-where">${esc(kit.where)}</p>` : ''}
      <ol class="kit-steps">${(kit.steps || []).map((x) => `<li>${esc(x)}</li>`).join('')}</ol>
      ${kit.keepCheaper?.trim() ? `<p class="kit-cheaper"><strong>Before you cancel:</strong> ${esc(kit.keepCheaper)}</p>` : ''}
      ${kit.watchOut ? `<p class="kit-watch">${esc(kit.watchOut)}</p>` : ''}
      <h4>Message to send</h4>
      <div class="kit-mail"><p class="kit-subject">${esc(kit.emailSubject || '')}</p><pre>${esc(kit.emailBody || '')}</pre></div>
      <div class="kit-actions">
        <button type="button" id="kit-copy">Copy message</button>
        <button type="button" id="kit-plan" class="secondary">${state.decisions.get(key) === 'cancel' ? 'In your cancel plan' : 'Add to cancel plan'}</button>
      </div>`;
    $('kit-copy').addEventListener('click', async () => {
      await navigator.clipboard.writeText(`${kit.emailSubject}\n\n${kit.emailBody}`);
      $('kit-copy').textContent = 'Copied';
    });
    $('kit-plan').addEventListener('click', () => {
      if (state.decisions.get(key) !== 'cancel') decide(key, 'cancel');
      $('kit-plan').textContent = 'In your cancel plan';
    });
  } catch (e) {
    $('kit-body').innerHTML = `<p class="error">${esc(e.message)}</p><p>Most services cancel from the account or billing page on their website or app. Subscriptions bought through Apple or Google are cancelled in that store's subscription settings.</p>`;
  }
}

// ---------- ask (on-device only) ----------
async function ask(question) {
  const q = String(question || '').trim();
  if (!q) return;
  const out = $('answer');
  if (state.device !== 'available') {
    out.innerHTML = `<p class="refused">${state.device === 'disconnected'
      ? 'AI is off in this copy of Ghost Charges. The totals above are all calculated on this computer.'
      : state.device === 'downloadable'
      ? 'Set up on-device AI first (the button at the top). This question includes your amounts, so it only runs on this computer.'
      : "Gemini Nano isn't available here, and this question includes your amounts, so Ghost Charges won't send it to the cloud. The totals above are all calculated on this computer."}</p>`;
    return;
  }
  if (state.asking) return; // one question at a time
  setAsking(true);
  out.innerHTML = '<p class="loading">Thinking on this device…</p>';
  // The numbers are worked out here; Gemini Nano only puts the picked facts into words.
  const facts = pickFacts(q, factSheet(state.report, { isSubscription }));
  const figures = `<details class="answer-facts"><summary>Figures it was given, calculated in your browser</summary><ul>${facts.map((f) => `<li>${esc(f)}</li>`).join('')}</ul></details>`;
  const draft = (text) => { out.innerHTML = `<p class="draft">${esc(text)}</p><p class="loading">Writing on this device…</p>`; };
  try {
    // Every dollar amount in the answer must be one of the figures; one retry, then show the figures themselves.
    let text = await state.ai.ask(q, facts, draft);
    let bad = unsupportedAmounts(text, facts);
    if (bad.length) {
      out.innerHTML = `<p class="loading">An amount in the draft didn't match your statement. Asking again…</p>`;
      text = await state.ai.ask(q, facts, draft, retryNote(bad));
      bad = unsupportedAmounts(text, facts);
    }
    out.innerHTML = bad.length
      ? `<p class="refused">Gemini Nano's answer used an amount that isn't in your statement, so it isn't shown. These are the figures, calculated in your browser:</p><ul class="answer-list">${facts.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>`
      : `<p>${esc(text)}</p><p class="answer-src">Answered on this device by Gemini Nano. Every amount checked against your statement.</p>${figures}`;
  } catch (e) {
    out.innerHTML = `<p class="refused">The on-device model couldn't answer (${esc(e.message)}). Nothing was sent anywhere.</p>`;
  } finally {
    setAsking(false);
  }
}

function setAsking(on) {
  state.asking = on;
  for (const b of document.querySelectorAll('#ask-form button, #chips button')) b.disabled = on;
}

// ---------- privacy ledger ----------
function onLedger(entry) {
  state.ledger.push(entry);
  const tbody = $('ledger').querySelector('tbody');
  tbody.querySelector('.empty')?.remove();
  const tr = document.createElement('tr');
  const where = entry.source === 'on_device' ? 'This device' : "Google's cloud";
  tr.innerHTML = `<td>${entry.at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</td><td>${esc(entry.job)}</td><td><span class="where ${entry.source}">${where}</span></td><td>${esc(entry.sent)}</td><td>${esc(entry.kept)}</td>`;
  tbody.appendChild(tr);
}

// ---------- cancel plan download ----------
function downloadPlan() {
  const planned = state.report.subscriptions.filter((s) => state.decisions.get(s.key) === 'cancel');
  const lines = [`My cancel plan (from Ghost Charges, ${new Date().toLocaleDateString('en-US')})`, ''];
  for (const s of planned) {
    lines.push(`${s.name}: ${money(s.amount)} ${s.cadence === 'yearly' ? 'a year' : 'a month'} (${money0(s.yearly)} a year)`);
    for (const r of s.reasons) lines.push(`  - ${r}`);
    const kit = state.kits.get(s.key);
    if (kit?.steps?.length) { lines.push('  How to cancel:'); kit.steps.forEach((x, i) => lines.push(`   ${i + 1}. ${x}`)); }
    lines.push('');
  }
  lines.push(`Total: ${money0(round2(planned.reduce((t, s) => t + s.yearly, 0)))} a year.`);
  const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/plain' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: 'my-cancel-plan.txt' });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

