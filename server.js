// Tahal (टहल, "a stroll") — a voice-led walk guide powered by an open-weight Gemma model
// running on your own machine through Ollama. Zero dependencies.
//
//   ollama pull gemma3:4b
//   node server.js
//
// Env: PORT (3000) · OLLAMA_URL (http://127.0.0.1:11434) · MODEL (gemma3:4b)
//      NO_WEATHER=1 (never touch the network) · HOME_NAME / HOME_LAT / HOME_LON (default location)

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 3000;
const OLLAMA = (process.env.OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');
const DEFAULT_MODEL = process.env.MODEL || 'gemma3:4b';
const HOME = {
  name: process.env.HOME_NAME || 'Aligarh',
  lat: Number(process.env.HOME_LAT) || 27.88,
  lon: Number(process.env.HOME_LON) || 78.08,
};
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
};

// ───────────────────────── sky: shared with the browser (public/sun.js) ─────────────────────────
const { sunTimes, seasonFor, skyInfo } = require('./public/sun.js');

// ───────────────────────── weather (optional; offline is a feature, not an error) ─────────────────────────

const WMO = {
  0: 'clear sky', 1: 'mostly clear', 2: 'partly cloudy', 3: 'overcast', 45: 'foggy', 48: 'foggy',
  51: 'light drizzle', 53: 'drizzle', 55: 'heavy drizzle', 61: 'light rain', 63: 'rain', 65: 'heavy rain',
  71: 'light snow', 73: 'snow', 75: 'heavy snow', 80: 'rain showers', 81: 'rain showers', 82: 'violent rain showers',
  95: 'thunderstorm', 96: 'thunderstorm with hail', 99: 'thunderstorm with hail',
};

async function getWeather(lat, lon) {
  if (process.env.NO_WEATHER === '1') return null;
  try {
    // Coordinates are rounded to ~1 km before they leave this machine.
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(2)}&longitude=${lon.toFixed(2)}` +
      `&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,precipitation&timezone=auto`;
    const r = await fetch(url, { signal: AbortSignal.timeout(2500) });
    if (!r.ok) return null;
    const c = (await r.json()).current;
    if (!c) return null;
    return {
      summary: `${WMO[c.weather_code] || 'unsettled'}, ${Math.round(c.temperature_2m)}°C (feels like ${Math.round(c.apparent_temperature)}°C), wind ${Math.round(c.wind_speed_10m)} km/h`,
    };
  } catch {
    return null;
  }
}

// ───────────────────────── personas & languages ─────────────────────────

const PERSONAS = {
  dadi: {
    name: 'Dadi ji', glyph: 'दादी', rate: 0.92,
    blurb: 'A warm storyteller who calls you beta and teases you about your phone.',
    style: 'You are Dadi ji, a warm, witty grandmother. You call the walker "beta". You tell tiny stories, use the occasional homely saying, and tease gently about phones. Never quote real people.',
  },
  panchhi: {
    name: 'Birdwatcher', glyph: 'पंछी', rate: 1,
    blurb: 'Delighted by tiny details. Gets a little too excited about leaves.',
    style: 'You are an obsessive, delighted nature nerd. You notice tiny details (how light sits on a leaf, a wing flick) and make the walker curious. Never claim a particular bird or animal is present; say what to look or listen for.',
  },
  jasoos: {
    name: 'Gully detective', glyph: 'जासूस', rate: 1,
    blurb: 'Treats your walk like a case. The culprit is usually a squirrel.',
    style: 'You are a noir detective narrating the walk as a case: clues, suspects, a mystery hiding in ordinary things. Dry humour. The culprit is always something harmless.',
  },
  maun: {
    name: 'Quiet monk', glyph: 'मौन', rate: 0.85,
    blurb: 'Says very little, and leaves long silences for you to fill.',
    style: 'You speak very little. Short, calm sentences with room to breathe. You mostly invite the walker to notice. Never preachy, never mystical nonsense.',
  },
};

const LANGS = {
  en: { label: 'English', tts: 'en-IN', rule: 'Write in simple, warm, spoken English with short sentences.' },
  hi: { label: 'हिन्दी', tts: 'hi-IN', rule: 'Write in simple, everyday spoken Hindi in Devanagari script (not formal or Sanskritised). Common English words like "phone" or "park" are fine.' },
  hinglish: { label: 'Hinglish', tts: 'en-IN', rule: 'Write in Hinglish: everyday spoken Hindi written in Roman letters, the way people text in India (for example "Chalo, ab dheere dheere chalte hain"). Do not use Devanagari.' },
};

const KINDS = ['walk', 'look', 'listen', 'sit', 'touch'];

function systemPrompt(personaId, langId, places) {
  const p = PERSONAS[personaId] || PERSONAS.dadi;
  const l = LANGS[langId] || LANGS.en;
  const placeRule = places.length
    ? `The walker has taught you these places near them (name — note):\n${places.map((x) => `- ${x.name}${x.note ? ' — ' + x.note : ''}`).join('\n')}\nIf you mention any place, use ONLY these, by exactly the name given. You may use some, all or none, in any order that makes a sensible walk. Never invent any other named place, shop, road or landmark.`
    : 'Do not name any specific place, shop, road or landmark. Talk only about what anyone would find outdoors: trees, sky, light, sounds, textures, shadows, people going about their day.';
  return `You are the voice of Tahal, a walking guide that is spoken aloud into someone's ear while their phone stays in their pocket.
${p.style}
${l.rule}

You plan ONE walk. It is spoken, so:
- No emoji, markdown, lists, asterisks or abbreviations inside any spoken text.
- Every stop is something to do with the body and senses (walk, look, listen, sit, touch). Nothing that needs the phone, tickets, travel or special equipment.
- Keep each spoken "say" to 1 or 2 short sentences (under 35 words). Leave silence; the walker needs time between stops.
- Match the daylight, weather and season you are given. If it is dark or raining, keep it safe, short and close to home.
- Be kind and a little funny. No lectures about screen time or productivity.
${placeRule}

Respond with JSON only, in exactly this shape (keys in English, values in the language above):
{"title": string (max 6 words),
 "intro": string (spoken welcome, 1 or 2 sentences),
 "stops": [{"emoji": string, "kind": "walk"|"look"|"listen"|"sit"|"touch", "title": string (max 4 words), "say": string, "minutes": number}] (4 to 6 stops),
 "outro": string (spoken goodbye, 1 sentence),
 "notice": string (one question to carry in your head while walking)}
The "minutes" of all stops must add up to the time budget.`;
}

function userPrompt(b, sky, weather) {
  const interests = b.interests.length ? b.interests.join(', ') : 'anything';
  const ritu = sky.ritu ? `${sky.ritu.name} (${sky.ritu.gist})` : sky.season;
  return [
    `Time budget: ${b.minutes} minutes in total.`,
    `The walker is especially curious about: ${interests}.`,
    `Season: ${ritu}. Local time: ${sky.localClock}. Daylight: ${sky.text}.`,
    `Weather: ${weather ? weather.summary : 'unknown (offline), so keep the walk flexible'}.`,
    'Plan the walk now.',
  ].join('\n');
}

// ───────────────────────── cleaning what a small model hands back ─────────────────────────

const stripSpoken = (s, n) =>
  String(s == null ? '' : s)
    .replace(/\p{Extended_Pictographic}|️|‍/gu, '')
    .replace(/[*_#`>]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, n);

function extractJson(text) {
  try { return JSON.parse(text); } catch { /* fall through */ }
  const a = text.indexOf('{');
  const b = text.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(text.slice(a, b + 1)); } catch { /* ignore */ } }
  return null;
}

// Small models are bad at arithmetic. Make the stop minutes add up to the budget, exactly.
function fitMinutes(stops, budget) {
  const raw = stops.map((s) => Math.max(0.5, Number(s.minutes) || budget / stops.length));
  const total = raw.reduce((a, b) => a + b, 0);
  const mins = raw.map((r) => Math.max(1, Math.round((r * budget) / total)));
  for (let guard = 0; guard < 200; guard++) {
    const diff = budget - mins.reduce((a, b) => a + b, 0);
    if (diff === 0) break;
    const idx = diff > 0 ? mins.indexOf(Math.max(...mins)) : mins.indexOf(Math.max(...mins));
    if (diff < 0 && mins[idx] <= 1) break;
    mins[idx] += diff > 0 ? 1 : -1;
  }
  return mins;
}

function cleanWalk(q, budget) {
  if (!q || typeof q !== 'object') return null;
  let stops = (Array.isArray(q.stops) ? q.stops : [])
    .map((s) => ({
      emoji: String((s && s.emoji) || '').trim().slice(0, 8) || '🌿',
      kind: KINDS.includes(s && s.kind) ? s.kind : 'walk',
      title: stripSpoken(s && s.title, 40) || 'Keep walking',
      say: stripSpoken(s && s.say, 260),
      minutes: s && s.minutes,
    }))
    .filter((s) => s.say)
    .slice(0, 6);
  if (stops.length < 3) return null;
  stops = stops.slice(0, Math.max(3, Math.min(stops.length, budget)));
  const mins = fitMinutes(stops, budget);
  stops.forEach((s, i) => (s.minutes = mins[i]));
  return {
    title: stripSpoken(q.title, 60) || 'A small stroll',
    intro: stripSpoken(q.intro, 300),
    stops,
    outro: stripSpoken(q.outro, 200),
    notice: stripSpoken(q.notice, 200),
  };
}

function cleanPlaces(list) {
  return (Array.isArray(list) ? list : [])
    .map((p) => ({ name: stripSpoken(p && p.name, 40), note: stripSpoken(p && p.note, 80) }))
    .filter((p) => p.name)
    .slice(0, 12);
}

// ───────────────────────── model call ─────────────────────────

async function ollama(pathname, payload, timeoutMs) {
  const r = await fetch(OLLAMA + pathname, {
    method: payload ? 'POST' : 'GET',
    headers: payload ? { 'content-type': 'application/json' } : undefined,
    body: payload ? JSON.stringify(payload) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!r.ok) throw new Error(`Ollama answered ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

function ollamaError(e, model) {
  const msg = String(e && (e.message + (e.cause ? ' ' + e.cause.message : '')));
  if (/fetch failed|ECONNREFUSED|timed out|aborted/i.test(msg)) {
    return `Can't reach Ollama at ${OLLAMA}. Start it with "ollama serve", then pull a model with "ollama pull ${model}".`;
  }
  if (/not found/i.test(msg)) return `Ollama doesn't have "${model}" yet. Run "ollama pull ${model}" and try again.`;
  return String((e && e.message) || e);
}

// ───────────────────────── http ─────────────────────────

const send = (res, code, obj) => {
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(obj));
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 60000) { reject(new Error('too big')); req.destroy(); } });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

const num = (v, lo, hi, d) => (Number.isFinite(Number(v)) && v !== '' && v !== null ? Math.min(hi, Math.max(lo, Number(v))) : d);
const pick = (v, allowed, d) => (allowed.includes(v) ? v : d);
const modelOf = (b) => (typeof b.model === 'string' && b.model.trim() ? b.model.trim().slice(0, 80) : DEFAULT_MODEL);

async function handleWalk(req, res) {
  let body;
  try { body = await readBody(req); } catch { return send(res, 400, { error: 'That request body was not valid JSON.' }); }

  const lat = num(body.lat, -90, 90, HOME.lat);
  const lon = num(body.lon, -180, 180, HOME.lon);
  const minutes = Math.round(num(body.minutes, 5, 180, 30));
  const persona = pick(body.persona, Object.keys(PERSONAS), 'dadi');
  const lang = pick(body.lang, Object.keys(LANGS), 'en');
  const tz = num(body.tzOffsetMin, -840, 840, 0);
  const model = modelOf(body);
  const places = cleanPlaces(body.places);
  const interests = (Array.isArray(body.interests) ? body.interests : []).map((x) => stripSpoken(x, 30)).filter(Boolean).slice(0, 6);

  const sky = skyInfo(lat, lon, Date.now(), tz);
  const weather = await getWeather(lat, lon);
  const started = Date.now();
  try {
    const out = await ollama('/api/chat', {
      model, stream: false, format: 'json',
      options: { temperature: 0.9, num_predict: 900 },
      messages: [
        { role: 'system', content: systemPrompt(persona, lang, places) },
        { role: 'user', content: userPrompt({ minutes, interests }, sky, weather) },
      ],
    }, 180000);
    const walk = cleanWalk(extractJson((out.message && out.message.content) || ''), minutes);
    if (!walk) return send(res, 502, { error: 'The model replied, but not with a walk I could use. Try again, or pick a different model from the list.' });
    send(res, 200, {
      walk,
      meta: {
        persona, lang, minutes, model, ms: Date.now() - started, online: Boolean(weather),
        phase: sky.phase, ritu: sky.ritu ? sky.ritu.name : sky.season, placesUsed: places.length, tts: LANGS[lang].tts,
      },
    });
  } catch (e) {
    send(res, 503, { error: ollamaError(e, model) });
  }
}

async function handleReflect(req, res) {
  let body;
  try { body = await readBody(req); } catch { return send(res, 400, { error: 'That request body was not valid JSON.' }); }
  const note = stripSpoken(body.note, 500);
  if (!note) return send(res, 400, { error: 'Write one line about your walk first.' });
  const persona = PERSONAS[pick(body.persona, Object.keys(PERSONAS), 'dadi')];
  const lang = LANGS[pick(body.lang, Object.keys(LANGS), 'en')];
  const model = modelOf(body);
  try {
    const out = await ollama('/api/chat', {
      model, stream: false, format: 'json',
      options: { temperature: 0.8, num_predict: 200 },
      messages: [
        { role: 'system', content: `${persona.style}\n${lang.rule}\nThe walker just came back from a walk and jotted one line. Reply with ONE or TWO warm, specific sentences that pick up a detail from what they wrote. No praise for its own sake, no advice, no emoji. JSON only: {"reflection": string}` },
        { role: 'user', content: `Walk: ${stripSpoken(body.title, 60) || 'a stroll'}. Minutes outside: ${Math.round(num(body.minutes, 1, 600, 20))}.\nTheir note: ${note}` },
      ],
    }, 60000);
    const j = extractJson((out.message && out.message.content) || '');
    const reflection = stripSpoken(j && j.reflection, 300);
    if (!reflection) return send(res, 502, { error: 'The model had nothing to say this time.' });
    send(res, 200, { reflection });
  } catch (e) {
    send(res, 503, { error: ollamaError(e, model) });
  }
}

async function handleSky(req, res) {
  let body;
  try { body = await readBody(req); } catch { return send(res, 400, { error: 'Bad JSON.' }); }
  const s = skyInfo(num(body.lat, -90, 90, HOME.lat), num(body.lon, -180, 180, HOME.lon), Date.now(), num(body.tzOffsetMin, -840, 840, 0));
  send(res, 200, { phase: s.phase, localClock: s.localClock, ritu: s.ritu, season: s.season, sunrise: s.sunrise || null, sunset: s.sunset || null, minutesLeft: s.minutesLeft, polar: s.polar || null, now: Date.now() });
}

async function handleModels(_req, res) {
  const personas = Object.entries(PERSONAS).map(([id, p]) => ({ id, name: p.name, glyph: p.glyph, blurb: p.blurb, rate: p.rate }));
  const languages = Object.entries(LANGS).map(([id, l]) => ({ id, label: l.label, tts: l.tts }));
  try {
    const t = await ollama('/api/tags', null, 2500);
    send(res, 200, { ok: true, models: (t.models || []).map((m) => m.name), default: DEFAULT_MODEL, personas, languages, home: HOME });
  } catch {
    send(res, 200, { ok: false, models: [], default: DEFAULT_MODEL, personas, languages, home: HOME });
  }
}

function serveStatic(req, res) {
  const url = new URL(req.url, 'http://localhost');
  let rel;
  try { rel = decodeURIComponent(url.pathname); } catch { res.writeHead(400); return res.end('Bad path'); }
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(buf);
  });
}

const server = http.createServer((req, res) => {
  const p = req.url.split('?')[0];
  if (req.method === 'POST' && p === '/api/walk') return handleWalk(req, res);
  if (req.method === 'POST' && p === '/api/reflect') return handleReflect(req, res);
  if (req.method === 'POST' && p === '/api/sky') return handleSky(req, res);
  if (req.method === 'GET' && p === '/api/models') return handleModels(req, res);
  if (req.method === 'GET') return serveStatic(req, res);
  res.writeHead(405); res.end();
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Tahal is up:  http://localhost:${PORT}`);
    console.log(`Model: ${DEFAULT_MODEL} via ${OLLAMA}   Home: ${HOME.name} (${HOME.lat}, ${HOME.lon})`);
  });
}

module.exports = { sunTimes, skyInfo, seasonFor, fitMinutes, cleanWalk, cleanPlaces, extractJson, systemPrompt, server };
