// Firebase AI Logic with hybrid inference: three models, three routing choices.
//
//  namer   PREFER_ON_DEVICE  Gemini Nano in Chrome when ready, Gemini in the cloud otherwise.
//                            Safe either way: its prompt only ever holds scrubbed merchant descriptors.
//  canceller PREFER_IN_CLOUD World knowledge (how to cancel a given service) lives in the bigger cloud
//                            model; falls back to Gemini Nano when offline. Prompt: one service name.
//  asker   ONLY_ON_DEVICE    Questions about amounts and dates. Never allowed to fall back to the cloud.
//
// Every call is written to the privacy ledger with where it ran (inferenceSource) and what was sent.

import { initializeApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import { getAI, getGenerativeModel, GoogleAIBackend, InferenceMode } from 'firebase/ai';
import { NAMING_SYSTEM, NAMING_SCHEMA, namingPrompts, readNaming, CANCEL_SYSTEM, CANCEL_SCHEMA, cancelPrompt, ASK_SYSTEM, askPrompt } from './prompts.js';

const CLOUD_MODEL = 'gemini-3.5-flash-lite';
const TEXT_EN = [{ type: 'text', languages: ['en'] }];

const onDevice = (system, schema) => ({
  createOptions: {
    expectedInputs: TEXT_EN,
    expectedOutputs: TEXT_EN,
    initialPrompts: [{ role: 'system', content: [{ type: 'text', value: system }] }],
  },
  ...(schema ? { promptOptions: { responseConstraint: schema } } : {}),
});

const inCloud = (system, schema) => ({
  model: CLOUD_MODEL,
  systemInstruction: system,
  generationConfig: schema ? { responseMimeType: 'application/json', responseJsonSchema: schema, temperature: 0.2 } : { temperature: 0.3 },
});

/** Load the web app config. On Firebase Hosting it is served at /__/firebase/init.json. */
async function loadConfig() {
  try {
    const r = await fetch('/__/firebase/init.json', { cache: 'no-store' });
    if (r.ok) return await r.json();
  } catch { /* not on Firebase Hosting */ }
  try {
    const r = await fetch('/firebase-config.local.json', { cache: 'no-store' });
    if (r.ok) return await r.json();
  } catch { /* no local config */ }
  return null;
}

async function loadAppSettings() {
  try {
    const r = await fetch('/app-settings.json', { cache: 'no-store' });
    if (r.ok) return await r.json();
  } catch { /* defaults */ }
  return {};
}

/** Check Chrome's built-in model for text in English. */
export async function deviceAvailability() {
  const LM = globalThis.LanguageModel;
  if (!LM || typeof LM.availability !== 'function') return 'unsupported';
  try {
    return await LM.availability({ expectedInputs: TEXT_EN, expectedOutputs: TEXT_EN });
  } catch {
    return 'unavailable';
  }
}

export async function createAI({ onLedger = () => {} } = {}) {
  const config = await loadConfig();
  if (!config || !config.apiKey) return disconnectedAI();
  const settings = await loadAppSettings();

  const app = initializeApp(config);
  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
    // Local development only: prints a debug token to register in the Firebase console.
    self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
  }
  if (settings.recaptchaSiteKey) {
    initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(settings.recaptchaSiteKey), isTokenAutoRefreshEnabled: true });
  }
  const ai = getAI(app, { backend: new GoogleAIBackend() });

  const namer = getGenerativeModel(ai, {
    mode: InferenceMode.PREFER_ON_DEVICE,
    onDeviceParams: onDevice(NAMING_SYSTEM, NAMING_SCHEMA),
    inCloudParams: inCloud(NAMING_SYSTEM, NAMING_SCHEMA),
  });
  const canceller = getGenerativeModel(ai, {
    mode: InferenceMode.PREFER_IN_CLOUD,
    onDeviceParams: onDevice(CANCEL_SYSTEM, CANCEL_SCHEMA),
    inCloudParams: inCloud(CANCEL_SYSTEM, CANCEL_SCHEMA),
  });
  const asker = getGenerativeModel(ai, {
    mode: InferenceMode.ONLY_ON_DEVICE,
    onDeviceParams: onDevice(ASK_SYSTEM),
    inCloudParams: { model: CLOUD_MODEL }, // never used: ONLY_ON_DEVICE throws instead of falling back
  });

  const log = (entry) => onLedger({ at: new Date(), ...entry });

  return {
    connected: true,
    deviceAvailability,

    /** Must be called from a click: starts (or finishes) the Gemini Nano download. */
    async prepareDevice(onProgress) {
      await namer.initializeDeviceModel(onProgress);
    },

    /** Clean names, categories and kinds for merchants. Returns { [key]: hint }. */
    async nameMerchants(merchants, onChunk = () => {}) {
      const hints = {};
      const chunks = namingPrompts(merchants);
      for (const [i, chunk] of chunks.entries()) {
        const result = await namer.generateContent(chunk.text);
        const source = result.response.inferenceSource;
        Object.assign(hints, readNaming(parseJson(result.response.text()), chunk.items));
        log({
          job: 'Name and sort merchants',
          source,
          sent: `${chunk.items.length} merchant descriptors, letters only`,
          kept: 'Amounts, dates, balances, account numbers',
        });
        onChunk(i + 1, chunks.length, source);
      }
      return hints;
    },

    /** Steps and a message for cancelling one service. */
    async cancelKit(serviceName) {
      const prompt = cancelPrompt(serviceName);
      const result = await canceller.generateContent(prompt);
      const source = result.response.inferenceSource;
      log({ job: `Cancel guide: ${serviceName}`, source, sent: `The service name "${serviceName}"`, kept: 'Everything else in your statement' });
      return { ...parseJson(result.response.text()), source };
    },

    /** Stream an answer about the statement. Runs on this device or not at all. */
    async ask(question, facts, onText, note = '') {
      const stream = await asker.generateContentStream(askPrompt(question, facts, note));
      let text = '';
      for await (const chunk of stream.stream) {
        text += chunk.text();
        onText(text);
      }
      log({ job: 'Answer a question about your statement', source: 'on_device', sent: 'Nothing: it ran on this device', kept: 'Your question, amounts, dates and totals' });
      return text;
    },
  };
}

/** Without a Firebase project the app still finds everything with its rules; AI features are off. */
function disconnectedAI() {
  return {
    connected: false,
    deviceAvailability,
    async prepareDevice() { throw new Error('This copy of Ghost Charges is not connected to Firebase.'); },
    async nameMerchants() { return {}; },
    async cancelKit() { throw new Error('This copy of Ghost Charges is not connected to Firebase, so cancel guides are off.'); },
    async ask() { throw new Error('This copy of Ghost Charges is not connected to Firebase.'); },
  };
}

function parseJson(text) {
  const s = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '');
  try { return JSON.parse(s); } catch { /* try to cut out the object */ }
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a >= 0 && b > a) {
    try { return JSON.parse(s.slice(a, b + 1)); } catch { /* fall through */ }
  }
  return {};
}
