// LOCAL UI TESTING ONLY. Never part of the deployed build (scripts/build.mjs leaves it out).
// Stands in for Firebase AI Logic so the interface can be exercised without a Firebase project:
// `npm run dev:mock` serves the page with this file loaded first.

const params = new URLSearchParams(location.search);
const device = params.get('device') || 'available';

const NAMES = {
  'STATE FARM': ['State Farm', 'Insurance', 'bill'],
  'VERIZON WIRELESS': ['Verizon', 'Phone & internet', 'bill'],
  'COMCAST XFINITY': ['Xfinity', 'Phone & internet', 'bill'],
  'COMED ELECTRIC': ['ComEd', 'Utilities', 'bill'],
  'TRADER JOE': ["Trader Joe's", 'Groceries', 'one-off'],
  'KROGER': ['Kroger', 'Groceries', 'one-off'],
  'STARBUCKS STORE': ['Starbucks', 'Coffee', 'one-off'],
  'BLUE BOTTLE': ['Blue Bottle Coffee', 'Coffee', 'one-off'],
  'CHIPOTLE': ['Chipotle', 'Dining', 'one-off'],
  'SHELL OIL': ['Shell', 'Fuel', 'one-off'],
  'UBER TRIP': ['Uber', 'Transport', 'one-off'],
  'AMAZON MKTPL': ['Amazon', 'Shopping', 'one-off'],
  'TARGET': ['Target', 'Shopping', 'one-off'],
  'ZELLE TO': ['Zelle transfer', 'Transfers', 'transfer'],
  'MIDAS AUTO': ['Midas', 'Transport', 'one-off'],
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

globalThis.__GHOST_DEV_AI__ = ({ onLedger }) => {
  const log = (e) => onLedger({ at: new Date(), ...e });
  return {
    connected: true,
    async deviceAvailability() { return device; },
    async prepareDevice(onProgress) { for (let p = 0; p <= 1; p += 0.25) { onProgress(p); await sleep(150); } },
    async nameMerchants(merchants, onChunk) {
      const hints = {};
      const source = device === 'available' ? 'on_device' : 'in_cloud';
      for (const m of merchants) {
        const n = NAMES[m.key];
        if (n) hints[m.key] = { name: n[0], category: n[1], kind: n[2] };
      }
      await sleep(400);
      log({ job: 'Name and sort merchants', source, sent: `${merchants.length} merchant descriptors, letters only`, kept: 'Amounts, dates, balances, account numbers' });
      onChunk(1, 1, source);
      return hints;
    },
    async cancelKit(name) {
      await sleep(500);
      log({ job: `Cancel guide: ${name}`, source: 'in_cloud', sent: `The service name "${name}"`, kept: 'Everything else in your statement' });
      return {
        source: 'in_cloud',
        where: `${name} is usually cancelled from the account or membership page on its website or app.`,
        steps: ['Sign in on the official website, not through a link in an email.', 'Open Account, then Membership or Billing.', 'Choose Cancel membership and confirm.', 'Keep the confirmation email until the next billing date has passed.'],
        watchOut: 'If you subscribed through the App Store or Google Play, cancel in that store instead; the website will not show a cancel button.',
        emailSubject: `Cancel my ${name} subscription`,
        emailBody: `Hello,\n\nPlease cancel the ${name} subscription on the account registered to [Account email], effective at the end of the current billing period, and confirm by email that no further charges will be made.\n\nThank you,\n[Your name]`,
      };
    },
    async ask(question, facts, onText, note = '') {
      if (device !== 'available') throw new Error('Inference mode is ONLY_ON_DEVICE, but an on-device model is not available.');
      // Stand-in: repeats the first picked fact, so the interface can be checked without a model.
      // For fee questions the first draft swaps a number, to exercise the amount check and the retry.
      const text = /fee/i.test(question) && !note ? 'Your ATM fees were $3.00.' : facts[1] || "This statement doesn't show that.";
      let out = '';
      for (const w of text.split(' ')) { out += (out ? ' ' : '') + w; onText(out); await sleep(25); }
      log({ job: 'Answer a question about your statement', source: 'on_device', sent: 'Nothing: it ran on this device', kept: 'Your question, amounts, dates and totals' });
      return out;
    },
  };
};
