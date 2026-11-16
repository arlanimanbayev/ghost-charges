// Prompts and output schemas for the three AI jobs, plus the guard that keeps private data out of
// anything that could run in the cloud. Pure module, unit-tested.
//
//  1. Name merchants      PREFER_ON_DEVICE  input: scrubbed descriptors only (no digits, no amounts)
//  2. Cancel kit          PREFER_IN_CLOUD   input: one merchant name
//  3. Ask your statement  ONLY_ON_DEVICE    input: amounts, dates, totals (never leaves the device)

import { scrubDescriptor } from './detect.js';

export const CATEGORIES = [
  'Streaming video', 'Music', 'Audiobooks', 'Cloud storage', 'Software', 'News', 'Learning', 'Fitness', 'Wellbeing',
  'Membership', 'Delivery membership', 'Gaming', 'Dating', 'Creators', 'Phone & internet', 'Utilities', 'Insurance',
  'Rent & housing', 'Loans & credit', 'Groceries', 'Dining', 'Coffee', 'Food delivery', 'Transport', 'Fuel', 'Shopping',
  'Travel', 'Health', 'Personal care', 'Entertainment', 'Education', 'Charity', 'Transfers', 'Cash', 'Other',
];
export const KINDS = ['subscription', 'bill', 'one-off', 'transfer'];

// ---------- 1. naming ----------
export const NAMING_SYSTEM = `You clean up bank statement merchant descriptors.
For each item, give the merchant's everyday brand name, one category from the list, and the kind:
- "subscription": a service billed automatically on a schedule (streaming, apps, memberships, gyms, news).
- "bill": a regular household bill (phone, internet, utilities, insurance, rent, loan payments).
- "one-off": ordinary shopping, food, transport, travel.
- "transfer": moving money between people or accounts.
Use the brand name people would recognise, in title case. If unsure, keep the descriptor's main words.
Categories: ${CATEGORIES.join(', ')}.`;

export const NAMING_SCHEMA = {
  type: 'object',
  properties: {
    merchants: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          name: { type: 'string' },
          category: { type: 'string', enum: CATEGORIES },
          kind: { type: 'string', enum: KINDS },
        },
        required: ['id', 'name', 'category', 'kind'],
      },
    },
  },
  required: ['merchants'],
};

/** Build naming prompts in chunks. Only scrubbed descriptors go in: letters and spaces. */
export function namingPrompts(merchants, chunkSize = 30) {
  const items = merchants.map((m, i) => ({ id: i + 1, key: m.key, text: scrubDescriptor(m.descriptor) || m.key }));
  const chunks = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    const part = items.slice(i, i + chunkSize);
    const text = `Descriptors:\n${part.map((p) => `${p.id}. ${p.text}`).join('\n')}\n\nReturn JSON with one entry per id.`;
    assertCloudSafe(text);
    chunks.push({ text, items: part });
  }
  return chunks;
}

/** Map a model answer back onto grouping keys, keeping only valid values. */
export function readNaming(json, items) {
  const out = {};
  const byId = new Map(items.map((p) => [p.id, p]));
  for (const m of json?.merchants || []) {
    const item = byId.get(Number(m.id));
    if (!item || typeof m.name !== 'string' || !m.name.trim()) continue;
    out[item.key] = {
      name: m.name.trim().slice(0, 40),
      category: CATEGORIES.includes(m.category) ? m.category : 'Other',
      kind: KINDS.includes(m.kind) ? m.kind : 'one-off',
    };
  }
  return out;
}

// ---------- 2. cancel kit ----------
export const CANCEL_SYSTEM = `You help people cancel subscriptions they no longer want. You get one service name. Write a guide for that specific service, using what you know about it.
- where: one sentence naming where this service handles cancellation: its website account page, its app, the Apple or Google store, or by phone.
- steps: three to five short steps that use this service's own menu and button names when you know them, for example "Open Account, then Membership, then Cancel membership". If you don't know them, say so in one step and give the general route.
- keepCheaper: only if this service is known to offer a cheaper plan, an ad-supported plan, a pause or a student price, name it in one sentence. Otherwise return an empty string.
- watchOut: one sentence on what people often miss, for example that access lasts until the end of the paid period, that subscriptions billed by Apple or Google are cancelled in that store, or that yearly plans are rarely refunded.
- emailSubject and emailBody: a short, polite message to support that also works as written proof of the request.
Rules: never invent web addresses, phone numbers, prices or policies; name the main domain only if you are certain of it. Never ask for card numbers or passwords.`;

export const CANCEL_SCHEMA = {
  type: 'object',
  properties: {
    where: { type: 'string' },
    steps: { type: 'array', items: { type: 'string' } },
    keepCheaper: { type: 'string' },
    watchOut: { type: 'string' },
    emailSubject: { type: 'string' },
    emailBody: { type: 'string' },
  },
  required: ['where', 'steps', 'emailSubject', 'emailBody'],
};

export function cancelPrompt(serviceName) {
  const name = String(serviceName).replace(/[^A-Za-z&+ .()'/-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
  const text = `Service: ${name}\nWrite the cancellation guide. Use the placeholder [Your name] and [Account email] in the message.`;
  assertCloudSafe(text);
  return text;
}

// ---------- 3. ask your statement (on-device only) ----------
export const ASK_SYSTEM = `You answer one question about a person's bank statement, privately, on their own device.
You get a few facts that were already calculated exactly. Answer only from those facts.
Copy names and dollar amounts exactly as they are written. Never add, subtract, multiply or estimate numbers yourself.
If the facts don't answer the question, say this statement doesn't show that.
Answer in at most three short sentences of plain English. Point out patterns and options; never tell the person what they must do.`;

/** facts: short sentences already picked for this question (see pickFacts in facts.js). */
export function askPrompt(question, facts, note = '') {
  return `Facts:\n${facts.map((f) => `- ${f}`).join('\n')}\n\nQuestion: ${String(question).slice(0, 300)}${note ? `\n\n${note}` : ''}`;
}

/** Added on the one retry after an answer used an amount that is not in the facts. */
export function retryNote(bad) {
  return `Your previous answer used ${bad.map((a) => `$${a}`).join(', ')}, which is not in the facts. Answer again and copy each dollar amount exactly from the fact it belongs to.`;
}

// ---------- guard ----------
/**
 * Throws if text could carry private numbers: currency symbols, decimals, 3+ digit runs, or dates.
 * Every prompt that might run in the cloud passes through this.
 */
export function assertCloudSafe(text) {
  const s = String(text);
  const bad = /[$€£]|\d+[.,]\d{2}\b|\d{3,}|\b\d{1,2}[/-]\d{1,2}\b/;
  const lines = s.split('\n').map((l) => l.replace(/^\d{1,2}\.\s/, '')); // list numbering is fine
  const hit = lines.find((l) => bad.test(l));
  if (hit) throw new Error(`Refusing to send possibly private data to the cloud: "${hit.slice(0, 40)}"`);
  return true;
}
