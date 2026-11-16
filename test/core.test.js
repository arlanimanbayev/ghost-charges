import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseAmount, parseDate, parseCsv, parseText, parseAny, splitCsvLine } from '../src/parse.js';
import { analyse, merchantKey, scrubDescriptor } from '../src/detect.js';
import { factSheet, pickFacts, amountsIn, unsupportedAmounts } from '../src/facts.js';
import { namingPrompts, readNaming, cancelPrompt, askPrompt, assertCloudSafe } from '../src/prompts.js';
import { linesFromTextContent } from '../src/pdftext.js';

const sample = (f) => fs.readFileSync(new URL(`../public/samples/${f}`, import.meta.url), 'utf8');

test('amounts and dates in the formats banks actually use', () => {
  assert.equal(parseAmount('$1,234.56'), 1234.56);
  assert.equal(parseAmount('(12.00)'), -12);
  assert.equal(parseAmount('-4.99'), -4.99);
  assert.equal(parseAmount('12.00 CR'), 12);
  assert.equal(parseAmount('25.00-'), -25);
  assert.equal(parseAmount('1.234,56'), 1234.56);
  assert.equal(parseAmount('abc'), null);
  assert.equal(parseDate('11/03/2025'), '2025-11-03');
  assert.equal(parseDate('2026-01-09'), '2026-01-09');
  assert.equal(parseDate('10/03', 2026), '2026-10-03');
  assert.equal(parseDate('Oct 3', 2026), '2026-10-03');
  assert.equal(parseDate('3 Oct 2026'), '2026-10-03');
  assert.deepEqual(splitCsvLine('"a, b",c,"he said ""hi"""'), ['a, b', 'c', 'he said "hi"']);
});

test('CSV: finds the header under a title block, and handles debit/credit columns', () => {
  const r = parseCsv(sample('northfield-checking-12-months.csv'));
  assert.equal(r.transactions.length, 706);
  assert.equal(r.signFlipped, false);
  const dc = parseCsv('Posted Date,Payee,Debit,Credit\n10/01/2026,NETFLIX.COM,15.49,\n10/02/2026,PAYROLL,,1000.00\n');
  assert.deepEqual(dc.transactions.map((t) => t.amount), [-15.49, 1000]);
});

test('CSV: card exports with purchases as positive numbers are flipped', () => {
  const r = parseAny(sample('card-export-aug-oct-2026.csv'));
  assert.equal(r.signFlipped, true);
  const peloton = r.transactions.find((t) => t.description.startsWith('PELOTON'));
  assert.equal(peloton.amount, -44);
  const payment = r.transactions.find((t) => t.description.startsWith('PAYMENT'));
  assert.ok(payment.amount > 0);
});

test('PDF text: lines from pdf.js become transactions; running balance is ignored', () => {
  const content = { items: [
    { str: '08/01', transform: [1, 0, 0, 1, 54, 700] }, { str: 'SPOTIFY USA BMBRWWPZ', transform: [1, 0, 0, 1, 100, 700] },
    { str: '-11.99', transform: [1, 0, 0, 1, 470, 700] }, { str: '1,728.08', transform: [1, 0, 0, 1, 558, 700] },
    { str: '08/07', transform: [1, 0, 0, 1, 54, 687] }, { str: 'DIRECT DEP NORTHWIND LABS PAYROLL', transform: [1, 0, 0, 1, 100, 687] },
    { str: '1,440.00', transform: [1, 0, 0, 1, 470, 687] }, { str: '3,168.08', transform: [1, 0, 0, 1, 558, 687] },
  ] };
  const lines = linesFromTextContent(content);
  assert.equal(lines[0], '08/01 SPOTIFY USA BMBRWWPZ -11.99 1,728.08');
  const r = parseText(['Statement period: August 1, 2026 – October 31, 2026', ...lines].join('\n'));
  assert.deepEqual(r.transactions, [
    { date: '2026-08-01', description: 'SPOTIFY USA BMBRWWPZ', amount: -11.99 },
    { date: '2026-08-07', description: 'DIRECT DEP NORTHWIND LABS PAYROLL', amount: 1440 },
  ]);
});

test('merchant keys are stable across reference numbers, prefixes and locations', () => {
  assert.equal(merchantKey('SPOTIFY USA PP1X8WA8'), merchantKey('SPOTIFY USA Q2W3E4R5'));
  assert.equal(merchantKey('SQ *BLUE BOTTLE 8573 CHICAGO IL'), 'BLUE BOTTLE');
  assert.equal(merchantKey('NETFLIX.COM 866-579-7172 CA'), 'NETFLIX');
  assert.equal(scrubDescriptor('AMAZON MKTPL*410365'), 'AMAZON MKTPL');
});

test('the 12-month sample: every planted problem is found, and the noise is not', () => {
  const rep = analyse(parseAny(sample('northfield-checking-12-months.csv')).transactions);
  const by = Object.fromEntries(rep.subscriptions.map((s) => [s.name, s]));
  assert.ok(by['Netflix'].flags.priceUp, 'Netflix price rise');
  assert.equal(by['The New York Times'].flags.trialConverted.trial, 1);
  assert.ok(by['Audible'].flags.doubleBilled, 'Audible double charge');
  assert.equal(by['Netflix'].flags.overlapWith.length, 3, '4 streaming services');
  assert.deepEqual(by['Spotify'].flags.overlapWith, ['Amazon Music']);
  assert.deepEqual(by['Uber One'].flags.overlapWith, ['DoorDash DashPass']);
  assert.ok(by['Amazon Prime'].flags.renewsSoon, 'Prime renews within 30 days of the statement end');
  assert.equal(by['Headspace'].active, false, 'cancelled in May');
  assert.equal(by['Duolingo'].flags.renewsSoon, false);
  // Rent by Zelle, coffee, groceries and petrol are not subscriptions.
  for (const name of Object.keys(by)) assert.ok(!/ZELLE|STARBUCKS|TRADER|SHELL|AMAZON MKTPL|BLUE BOTTLE/i.test(name), name);
  assert.equal(rep.fees.filter((f) => f.type.startsWith('Overdraft')).length, 3);
  assert.equal(rep.totals.feesTotal, 205);
});

test('the card sample: a $0 trial that turned paid, and a price rise', () => {
  const rep = analyse(parseAny(sample('card-export-aug-oct-2026.csv')).transactions);
  const by = Object.fromEntries(rep.subscriptions.map((s) => [s.name, s]));
  assert.equal(by['Canva'].flags.trialConverted.trial, 0);
  assert.deepEqual(by['Paramount+'].flags.priceUp, { from: 7.99, to: 12.99 });
  assert.equal(rep.fees[0].type, 'Interest charge');
});

test('model hints can name unknown merchants and drop one-offs', () => {
  const tx = [];
  for (const m of ['08', '09', '10']) tx.push({ date: `2026-${m}-04`, description: 'STATE FARM INSURANCE', amount: -112.4 });
  for (const m of ['08', '09', '10']) tx.push({ date: `2026-${m}-05`, description: 'SQ *ACME BAKERY', amount: -6 });
  const plain = analyse(tx);
  assert.equal(plain.subscriptions.length, 2);
  const hinted = analyse(tx, { 'STATE FARM': { name: 'State Farm', category: 'Insurance', kind: 'bill' }, 'ACME BAKERY': { name: 'Acme Bakery', category: 'Dining', kind: 'one-off' } });
  assert.deepEqual(hinted.subscriptions.map((s) => [s.name, s.category]), [['State Farm', 'Insurance']]);
});

test('privacy guard: cloud prompts carry no amounts, dates or long numbers', () => {
  const rep = analyse(parseAny(sample('northfield-checking-12-months.csv')).transactions);
  const chunks = namingPrompts(rep.merchants);
  assert.ok(chunks.length >= 1);
  for (const c of chunks) {
    assert.ok(!/\$|\d+\.\d{2}|\d{3,}/.test(c.text.replace(/^\d{1,2}\. /gm, '')), 'no numbers in descriptors');
  }
  assert.throws(() => assertCloudSafe('NETFLIX 17.99'), /private/);
  assert.throws(() => assertCloudSafe('paid on 10/14'), /private/);
  assert.throws(() => assertCloudSafe('ACCOUNT 4410'), /private/);
  assert.ok(cancelPrompt('Netflix 866-579-7172').includes('Netflix'));
  assert.ok(!/\d/.test(cancelPrompt('Netflix 866-579-7172')));
  // The on-device prompt may contain amounts: it never goes through the cloud guard.
  assert.ok(askPrompt('How much on streaming?', pickFacts('How much on streaming?', factSheet(rep))).includes('17.99'));
});

test('Ask your statement: each question gets only the facts that answer it, with the sums already done', () => {
  const tx = parseCsv(sample('northfield-checking-12-months.csv')).transactions;
  // What the naming model would add: coffee shops get the Coffee category.
  const hints = {};
  for (const t of tx) if (/STARBUCKS|BLUE BOTTLE/.test(t.description)) hints[merchantKey(t.description)] = { name: /STARBUCKS/.test(t.description) ? 'Starbucks' : 'Blue Bottle Coffee', category: 'Coffee', kind: 'one-off' };
  const rep = analyse(tx, hints);
  const sheet = factSheet(rep);
  const ask = (q) => pickFacts(q, sheet).join('\n');

  const streaming = ask('How much do I spend on streaming a year?');
  for (const name of ['Netflix', 'Hulu', 'Max', 'Disney+']) assert.ok(streaming.includes(name), `streaming answer names ${name}`);
  assert.ok(/a year at current prices/.test(streaming));
  assert.ok(!/coffee|New York Times/i.test(streaming), 'no coffee, no newspaper in the streaming facts');

  const fees = ask('Which fees could I have avoided?');
  assert.ok(/Overdraft/.test(fees) && /add up to/.test(fees));
  assert.ok(!/Streaming video/.test(fees));

  const biggest = ask('What are my three biggest repeating costs?');
  assert.ok(/largest first: 1\)/.test(biggest));

  const coffee = ask('How much on coffee?');
  assert.ok(/Day-to-day spending on coffee/.test(coffee) && /Starbucks/.test(coffee));
  assert.ok(!/Streaming video/.test(coffee));
  assert.ok(/^Starbucks: \$/m.test(ask('How much did I spend at Starbucks?')));

  // Fee facts carry one dollar amount each and no digit counts the model could swap in.
  assert.ok(/ATM fees cost \$10\.50 in total \(charged three times\)/.test(fees));
  assert.ok(/Foreign transaction fees cost \$4\.50 in total/.test(fees));

  // The amount check, on answers Gemini Nano really gave in testing.
  const feeFacts = pickFacts('Which fees could I have avoided?', sheet);
  const swapped = 'You could have avoided the foreign transaction fees, which were $13.50. The ATM fees are $3.00. The overdraft/NSF fees amount to $105.00.';
  assert.deepEqual(unsupportedAmounts(swapped, feeFacts), [13.5, 3]);
  const streamFacts = pickFacts('How much do I spend on streaming a year?', sheet);
  assert.deepEqual(unsupportedAmounts('You pay $660 a year for streaming, and paid $564.59 over this statement ($565).', streamFacts), []);
  assert.deepEqual(amountsIn('$1,853 and $4.50'), [1853, 4.5]);

  // Nothing specific: a short overview, always starting with the period.
  const vague = pickFacts('Tell me something', sheet);
  assert.ok(vague[0].startsWith('This statement runs from'));
  assert.ok(vague.length > 2 && vague.length <= 7);
});

test('readNaming keeps valid answers only and maps ids back to keys', () => {
  const items = [{ id: 1, key: 'STATE FARM' }, { id: 2, key: 'ACME BAKERY' }];
  const out = readNaming({ merchants: [
    { id: 1, name: 'State Farm', category: 'Insurance', kind: 'bill' },
    { id: 2, name: '', category: 'Dining', kind: 'one-off' },
    { id: 9, name: 'Ghost', category: 'Other', kind: 'one-off' },
    { id: 2, name: 'Acme Bakery', category: 'Made up', kind: 'weird' },
  ] }, items);
  assert.deepEqual(out, {
    'STATE FARM': { name: 'State Farm', category: 'Insurance', kind: 'bill' },
    'ACME BAKERY': { name: 'Acme Bakery', category: 'Other', kind: 'one-off' },
  });
});
