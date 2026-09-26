#!/usr/bin/env node
// Autopublica en Instagram: 1 reel (con texto+hashtags) + 3 stories.
// Rotación determinista sin repeticiones: reel = doy%12, stories = +3/+6/+9
// (en cualquier ventana de 3 días no se repite ningún signo).
// Sin LLM: caption reconstruido del corpus con las mismas fórmulas del generador.
// Uso:
//   node scripts/autopublicar.mjs --date=2026-09-25 --dry-run
//   IG_USER_ID=x IG_ACCESS_TOKEN=y node scripts/autopublicar.mjs --date=2026-09-25
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const API = 'https://graph.facebook.com/v21.0';
const PAGES = 'https://zherko.github.io/Videos_horoscopo';

const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v ?? true];
}));

function hoyISO() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
const FECHA = args.date || hoyISO();
if (!/^\d{4}-\d{2}-\d{2}$/.test(FECHA)) { console.error('--date debe ser YYYY-MM-DD'); process.exit(1); }
const dryRun = !!args['dry-run'];
const IG_USER_ID = process.env.IG_USER_ID;
const IG_TOKEN = process.env.IG_ACCESS_TOKEN;

// --- corpus (mismas fórmulas que generar-reel.mjs) ---
const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
const load = p => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));
const meta = load('vendor/corpus/meta.json');
const corpus = {};
for (const f of ['fuego.json', 'tierra.json', 'aire.json', 'agua.json']) Object.assign(corpus, load(`vendor/corpus/${f}`));
const COLORES = meta.colores;
const RITUAL_BASE = meta.ritual_base;
const SIGNS = meta.signos; // mismo orden que el generador
const GLYPH = { aries:'♈', tauro:'♉', geminis:'♊', cancer:'♋', leo:'♌', virgo:'♍', libra:'♎', escorpio:'♏', sagitario:'♐', capricornio:'♑', acuario:'♒', piscis:'♓' };

const [Y, M, D] = FECHA.split('-').map(Number);
const d = new Date(Date.UTC(Y, M - 1, D, 12));
const doy = Math.floor((d.getTime() - Date.UTC(Y, 0, 0)) / 864e5);

const luna = (() => {
  const ref = Date.UTC(2000, 0, 6, 18, 14) / 864e5;
  const c = (((d.getTime() / 864e5 - ref) % 29.53) + 29.53) % 29.53;
  const fase = c < 1.2 ? 'nueva' : c < 7.4 ? 'creciente' : c < 14.8 ? 'llena' : c < 22.1 ? 'menguante' : 'nueva';
  const illum = Math.round((1 - Math.cos(2 * Math.PI * c / 29.53)) / 2 * 100);
  return { fase, illum };
})();
const LUNA_KW = { nueva:['siembra','intención'], creciente:['empuja','avanza'], llena:['culmina','celebra'], menguante:['suelta','ordena'] };
const pick = (arr, m1, m2, idx) => arr[(doy * m1 + idx * m2) % arr.length];
const pickBiased = (arr, m1, m2, idx, kw) => {
  if (!kw?.length) return pick(arr, m1, m2, idx);
  const low = arr.map(t => t.toLowerCase());
  const cand = arr.filter((_, i) => kw.some(k => low[i].includes(k)));
  if (cand.length >= 3) return cand[(doy * m1 + idx * m2) % cand.length];
  return pick(arr, m1, m2, idx);
};

function buildCaption(slug) {
  const idx = SIGNS.findIndex(s => s.slug === slug);
  const c = corpus[slug];
  const kw = LUNA_KW[luna.fase] || [];
  const lead = pickBiased(c.lead, 1, 3, idx, kw.slice(0, 2));
  const energia = pickBiased(c.energia, 31, 17, idx, kw);
  const amor = pickBiased(c.amor, 17, 29, idx, kw.slice(0, 1));
  const trabajo = pickBiased(c.trabajo, 13, 23, idx, kw.slice(0, 1));
  const numero = ((doy * 7 + idx * 13) % 99) + 1;
  const color = COLORES[(doy + idx) % COLORES.length];
  const glyph = GLYPH[slug];
  const nombre = slug.charAt(0).toUpperCase() + slug.slice(1);
  return `${glyph} ${nombre} hoy ${D} de ${MESES[M - 1]} — ${lead}\n\nEnergía: ${energia}\nAmor: ${amor}\nTrabajo: ${trabajo}\n\nNº ${numero} · Color ${color} · Luna ${luna.fase} ${luna.illum}% · Ritual: ${c.ritual[luna.fase]}\nTodos los horóscopos del día en diarioastral.com ✨ Link en bio\n\n#horoscopo #horoscopodehoy #diarioastral #astrologia #zodiaco #${slug} #horoscopo${slug} ${glyph} #cartaastral #lunahoy #signosdelzodiaco #horoscopodiario #astrologiaespañol`;
}

// --- rotación sin repeticiones ---
const reelSlug = SIGNS[doy % 12].slug;
const storySlugs = [3, 6, 9].map(off => SIGNS[(doy + off) % 12].slug);
const plan = [
  { kind: 'REELS', slug: reelSlug, caption: buildCaption(reelSlug) },
  ...storySlugs.map(slug => ({ kind: 'STORIES', slug })),
];

async function urlOk(url, tries = 12) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { method: 'HEAD' });
      if (r.ok) return true;
      console.log(`  Pages aún no sirve ${url} (${r.status}), reintento ${i + 1}/${tries}`);
    } catch (e) {
      console.log(`  sin red aún (${e.cause?.code || e.message}), reintento ${i + 1}/${tries}`);
    }
    await new Promise(r => setTimeout(r, 30000));
  }
  return false;
}

async function waitFinished(id, max = 60) {
  for (let i = 0; i < max; i++) {
    await new Promise(r => setTimeout(r, 5000));
    const r = await fetch(`${API}/${id}?fields=status_code&access_token=${IG_TOKEN}`);
    const j = await r.json();
    if (j.status_code === 'FINISHED') return true;
    if (j.status_code === 'ERROR' || j.status_code === 'EXPIRED') {
      console.error('Container falló:', JSON.stringify(j));
      return false;
    }
  }
  console.error('Timeout esperando FINISHED');
  return false;
}

async function publicar(item) {
  const videoUrl = `${PAGES}/${FECHA}-${item.slug}.mp4`;
  console.log(`\n=== ${item.kind} ${item.slug} ===\n${videoUrl}`);
  if (item.kind === 'REELS') console.log(`Caption (${item.caption.length} chars)`);
  if (!(await urlOk(videoUrl))) { console.error('MP4 no accesible, abortando'); process.exit(1); }
  if (dryRun) { console.log('[dry-run] no se publica'); return; }

  const body = new URLSearchParams({ media_type: item.kind, video_url: videoUrl, access_token: IG_TOKEN });
  if (item.kind === 'REELS') { body.set('caption', item.caption); body.set('share_to_feed', 'true'); }
  let res = await fetch(`${API}/${IG_USER_ID}/media`, { method: 'POST', body });
  let data = await res.json();
  if (!res.ok || !data.id) { console.error('Error creando container:', JSON.stringify(data)); process.exit(1); }
  console.log(`Container OK: ${data.id}`);
  if (!(await waitFinished(data.id))) process.exit(1);
  res = await fetch(`${API}/${IG_USER_ID}/media_publish`, {
    method: 'POST',
    body: new URLSearchParams({ creation_id: data.id, access_token: IG_TOKEN }),
  });
  data = await res.json();
  if (!res.ok || !data.id) { console.error('Error publicando:', JSON.stringify(data)); process.exit(1); }
  console.log(`✅ Publicado ${item.kind} ${item.slug}: media_id=${data.id}`);
}

console.log(`Fecha: ${FECHA}  Reel: ${reelSlug}  Stories: ${storySlugs.join(', ')}${dryRun ? '  [dry-run]' : ''}`);
if (!dryRun && (!IG_USER_ID || !IG_TOKEN)) {
  console.error('Falta IG_USER_ID / IG_ACCESS_TOKEN en el entorno.');
  process.exit(1);
}
for (const item of plan) await publicar(item);
console.log('\nHecho: 1 reel + 3 stories.');
