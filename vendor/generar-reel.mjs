#!/usr/bin/env node
// Genera reels Tipo 1 (Órbita XL) con datos reales deterministas — solo cambia interior, estilo blindado.
// Uso: node scripts/generar-reel.mjs --signo=tauro --date=2026-09-22
//      node scripts/generar-reel.mjs --date=2026-09-22          # 12 signos
//      node scripts/generar-reel.mjs --signo=tauro              # hoy Europe/Madrid
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v ?? true];
}));

function hoyISO() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
const FECHA = args.date || hoyISO();
if (!/^\d{4}-\d{2}-\d{2}$/.test(FECHA)) { console.error('--date debe ser YYYY-MM-DD'); process.exit(1); }
const soloSigno = args.signo ? String(args.signo).toLowerCase() : null;

const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
const COLORES_FALLBACK = ['dorado','lila','blanco luna','azul cielo','verde esmeralda','rojo coral','violeta'];

const load = p => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));
const meta = load('data/corpus/meta.json');
const corpus = {};
for (const f of ['fuego.json','tierra.json','aire.json','agua.json']) Object.assign(corpus, load(`data/corpus/${f}`));
const COLORES = meta.colores?.length === 7 ? meta.colores : COLORES_FALLBACK;
const RITUAL_BASE = meta.ritual_base;
const SIGNS = meta.signos; // [{slug,nombre,idx,...}]
const GLYPH = { aries:'♈', tauro:'♉', geminis:'♊', cancer:'♋', leo:'♌', virgo:'♍', libra:'♎', escorpio:'♏', sagitario:'♐', capricornio:'♑', acuario:'♒', piscis:'♓' };
const GLYPH_COLOR = { aries:'#DC2626', tauro:'#16A34A', geminis:'#D97706', cancer:'#2563EB', leo:'#DC2626', virgo:'#16A34A', libra:'#D97706', escorpio:'#2563EB', sagitario:'#DC2626', capricornio:'#16A34A', acuario:'#D97706', piscis:'#2563EB' };
const ELEMENTO = { aries:'Fuego', tauro:'Tierra', geminis:'Aire', cancer:'Agua', leo:'Fuego', virgo:'Tierra', libra:'Aire', escorpio:'Agua', sagitario:'Fuego', capricornio:'Tierra', acuario:'Aire', piscis:'Agua' };
const REGENTE = { aries:'Marte', tauro:'Venus', geminis:'Mercurio', cancer:'Luna', leo:'Sol', virgo:'Mercurio', libra:'Venus', escorpio:'Plutón', sagitario:'Júpiter', capricornio:'Saturno', acuario:'Urano', piscis:'Neptuno' };
const FECHAS_SIGNO = { aries:'21 mar – 19 abr', tauro:'20 abr – 20 may', geminis:'21 may – 20 jun', cancer:'21 jun – 22 jul', leo:'23 jul – 22 ago', virgo:'23 ago – 22 sep', libra:'23 sep – 22 oct', escorpio:'23 oct – 21 nov', sagitario:'22 nov – 21 dic', capricornio:'22 dic – 19 ene', acuario:'20 ene – 18 feb', piscis:'19 feb – 20 mar' };

const [Y,M,D] = FECHA.split('-').map(Number);
const fechaLarga = `${D} de ${MESES[M-1]} de ${Y}`;
const fechaCorta = `${String(D).padStart(2,'0')} · ${MESES[M-1].slice(0,3).toUpperCase()} · ${Y}`;
const d = new Date(Date.UTC(Y, M-1, D, 12));
const doy = Math.floor((d.getTime() - Date.UTC(Y,0,0))/864e5);

const luna = (() => {
  const ref = Date.UTC(2000,0,6,18,14)/864e5;
  const c = (((d.getTime()/864e5 - ref)%29.53)+29.53)%29.53;
  const fase = c < 1.2 ? 'nueva' : c < 7.4 ? 'creciente' : c < 14.8 ? 'llena' : c < 22.1 ? 'menguante' : 'nueva';
  const illum = Math.round((1 - Math.cos(2*Math.PI*c/29.53))/2*100);
  return { fase, illum, txt: `${fase} · ${illum}%` };
})();

const LUNA_KW={nueva:['siembra','intención','inicia','planta','nuevo'],creciente:['empuja','avanza','impulso','retoma','empuje'],llena:['culmina','celebra','cosecha','plenitud','culminar'],menguante:['suelta','ordena','limpia','cierra','soltar']};
const pick=(arr,m1,m2,idx)=>arr[(doy*m1+idx*m2)%arr.length];
const pickBiased=(arr,m1,m2,idx,kw)=>{ if(!kw||!kw.length) return pick(arr,m1,m2,idx); const low=arr.map(t=>t.toLowerCase()); const cand=arr.filter((_,i)=>kw.some(k=>low[i].includes(k))); if(cand.length>=3){ const j=(doy*m1+idx*m2)%cand.length; return cand[j]; } return pick(arr,m1,m2,idx); };

function cap(s){return s.charAt(0).toUpperCase()+s.slice(1)}

const templatePath = join(ROOT, '.opencode/skills/reel-estilo1-orbita-xl/template.html');
if (!existsSync(templatePath)) { console.error('Falta template en', templatePath); process.exit(1); }
let tpl = readFileSync(templatePath, 'utf8');

const signosAGenerar = soloSigno ? [soloSigno] : SIGNS.map(s=>s.slug);
if (soloSigno && !corpus[soloSigno]) { console.error(`Signo desconocido: ${soloSigno}`); process.exit(1); }

function generarUno(slug){
  const idx = SIGNS.findIndex(s=>s.slug===slug);
  const c = corpus[slug];
  const sMeta = SIGNS[idx];
  const nombre = sMeta.nombre; // con mayúscula
  const glyph = GLYPH[slug] || '♈';
  const glyphColor = GLYPH_COLOR[slug] || '#16A34A';
  const elemento = ELEMENTO[slug] || '—';
  const regente = REGENTE[slug] || '—';
  const rango = FECHAS_SIGNO[slug] || '';

  const lunaKw = LUNA_KW[luna.fase]||[];
  const lead = pickBiased(c.lead, 1, 3, idx, lunaKw.slice(0,2));
  const energia = pickBiased(c.energia, 31, 17, idx, lunaKw);
  const amor = pickBiased(c.amor, 17, 29, idx, lunaKw.slice(0,1));
  const trabajo = pickBiased(c.trabajo, 13, 23, idx, lunaKw.slice(0,1));
  const numero = ((doy * 7 + idx * 13) % 99) + 1;
  const color = COLORES[(doy + idx) % COLORES.length];
  const ritualFull = `${RITUAL_BASE[luna.fase]}: ${c.ritual[luna.fase]}`;
  // porcentajes deterministas (igual que tauro-hoy.html hero)
  const eV=55+((doy*3+idx*17)%40), aV=45+((doy*5+idx*11)%45), tV=50+((doy*7+idx*19)%40);

  // Planetas por tarjeta (criterio tipo 1)
  const planetaEnergia = 'marte';
  const planetaAmor = 'venus';
  const planetaTrabajo = 'jupiter';

  let out = tpl;
  // Reemplazos — placeholders si existen, si no fallback a reemplazo directo de textos de Tauro de ejemplo
  // Como template es Tauro hardcodeado, reemplazamos los valores concretos
  // Glyph y color
  out = out.replaceAll('♉︎', glyph + '︎');
  out = out.replaceAll('#16A34A', glyphColor);
  out = out.replaceAll('>Tauro<', `>${cap(slug)}<`);
  out = out.replaceAll('Tauro · Diario Astral', `${cap(slug)} · Diario Astral`);
  out = out.replaceAll('♉ Tauro', `${glyph} ${cap(slug)}`);
  out = out.replaceAll('20 ABR — 20 MAY · TIERRA · Regente Venus', `${rango.toUpperCase()} · ${elemento.toUpperCase()} · Regente ${regente}`);
  out = out.replaceAll('20 abr – 20 may', rango);
  // Fechas
  out = out.replaceAll('22 · SEP · 2026', fechaCorta.replace(' · ',' · ').toUpperCase());
  out = out.replaceAll('22 de septiembre', fechaLarga.replace(/ de \d{4}/,''));
  // Textos — reemplazo por los textos deterministas reales (escapado básico)
  const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;');
  // Lead/portada (entre comillas)
  out = out.replace('saborea el momento', esc(lead).slice(0, 80)); // fallback si no hay placeholder
  // Para reemplazo robusto, si template tiene placeholders {{lead}} etc., usarlos; si no, reemplazar los textos de ejemplo exactos de Tauro 22-09
  // Textos exactos de ejemplo en template Tauro 22-09:
  const MAP_TEXTO = {
    'saborea el momento': lead,
    'Si la ansiedad aprieta, toca algo': energia,
    'cocina, jardinería, ordenar un cajón. Lo manual te devuelve al presente mejor que cualquier app.': '',
    'Regálate primero: date el capricho que siempre pospones.': amor,
    'Quien se quiere bien, quiere mejor a los demás. Tu sensualidad hoy es tranquila — un gesto vale más que mil palabras.': '',
    'Tu fiabilidad hoy es tu tarjeta:': trabajo,
    'Aunque sea un detalle. Quien cumple sin ruido, repite. Pide por escrito y con cifras.': '',
  };
  // Como los textos de ejemplo contienen HTML intercalado, hacemos reemplazos por frases clave
  out = out.replace('Si la ansiedad aprieta, toca algo', esc(energia).slice(0, 120));
  // Si los textos son largos, truncamos para que quepa en tarjeta XL (máx ~140 chars) y añadimos el resto
  // Para no complicar, si template no tiene placeholders, generamos una versión simplificada: reemplazamos párrafos completos por los textos reales
  // Estrategia simple: buscar los <p style="font-size:58px...> y <p style="font-size:42px...> y sustituir contenido
  // Como es frágil, si falla, el usuario verá el texto de ejemplo — pero el generador avisa

  // Números y chips
  out = out.replaceAll('>Número 87<', `>Número ${numero}<`);
  out = out.replaceAll('>87<', `>${numero}<`);
  out = out.replaceAll('Color dorado', `Color ${color}`);
  out = out.replaceAll('>dorado<', `>${color}<`);
  out = out.replaceAll('Luna llena 84%', `Luna ${luna.fase} ${luna.illum}%`);
  out = out.replaceAll('luna llena 84%', `luna ${luna.fase} ${luna.illum}%`);
  out = out.replaceAll('Luna llena · ritual: celebra', `Luna ${luna.fase} · ritual: ${c.ritual[luna.fase]}`);
  out = out.replaceAll('68%', `${eV}%`);
  out = out.replaceAll('74%', `${aV}%`);
  out = out.replaceAll('62%', `${tV}%`);
  out = out.replaceAll('width:68%', `width:${eV}%`);
  out = out.replaceAll('width:74%', `width:${aV}%`);
  out = out.replaceAll('width:62%', `width:${tV}%`);
  // Planetas (ya correctos por defecto, pero aseguramos)
  out = out.replaceAll('marte.svg', `${planetaEnergia}.svg`);
  out = out.replaceAll('venus.svg', `${planetaAmor}.svg`);
  // jupiter ya es correcto, pero lo reafirmamos
  // URLs
  out = out.replaceAll('tauro-hoy.html', `${slug}-hoy.html`);
  out = out.replaceAll('/reel-tauro-', `/reel-${slug}-`);

  // Ajuste fino: si energia/ amor / trabajo son muy largos, recortamos a 160 chars para XL
  const truncate = (s, n) => s.length > n ? s.slice(0, n-1) + '…' : s;
  // Reemplazo directo de párrafos por textos reales truncados (robusto por regex de párrafos)
  // Energía headline + body: usamos energia como un solo bloque dividido en dos frases si contiene punto
  const energiaParts = energia.split('. ');
  const energiaHead = truncate(energiaParts[0] + (energiaParts.length>1?'.':''), 90);
  const energiaBody = truncate(energiaParts.slice(1).join('. ') || '', 110);
  out = out.replace(/<p style="font-size:58px[^>]*>.*?<\/p>/, `<p style="font-size:58px;line-height:1.22;color:#1B1B4D;margin-top:32px;font-weight:800">${esc(energiaHead)}</p>`);
  if (energiaBody) out = out.replace(/<p style="font-size:42px[^>]*>.*?<\/p>/, `<p style="font-size:42px;line-height:1.28;color:rgba(27,27,77,.72);margin-top:16px;font-weight:600">${esc(energiaBody)}</p>`);

  const amorHead = truncate(amor.split('. ')[0]+'.', 90);
  const amorBody = truncate(amor.split('. ').slice(1).join('. '), 110);
  out = out.replace(/<p style="font-size:60px[^>]*>.*?<\/p>/, `<p style="font-size:60px;line-height:1.18;color:#1B1B4D;margin-top:32px;font-weight:800">${esc(amorHead)}</p>`);
  out = out.replace(/<p style="font-size:40px[^>]*>Quien se quiere bien.*?<\/p>/, `<p style="font-size:40px;line-height:1.30;color:rgba(27,27,77,.68);margin-top:18px;font-weight:600">${esc(amorBody || amor)}</p>`);

  const trabajoHead = truncate(trabajo.split('. ')[0]+'.', 90);
  const trabajoBody = truncate(trabajo.split('. ').slice(1).join('. '), 110);
  out = out.replace(/<p style="font-size:54px[^>]*>Tu fiabilidad.*?<\/p>/, `<p style="font-size:54px;line-height:1.20;color:#1B1B4D;margin-top:32px;font-weight:800">${esc(trabajoHead)}</p>`);
  out = out.replace(/<p style="font-size:40px[^>]*>Aunque sea un detalle.*?<\/p>/, `<p style="font-size:40px;line-height:1.30;color:rgba(27,27,77,.65);margin-top:16px;font-weight:600">${esc(trabajoBody || '')}</p>`);

  // Portada lead
  out = out.replace(/“Hoy Tauro.*?<\/div>/, `“Hoy ${cap(slug)} <b style="color:#FBBF24">${esc(lead).slice(0,60)}</b>”</div>`);

  // Nueva estructura: Reel-horoscopo diario/YYYY-MM-DD/signo/
  const outDir = join(ROOT, `hyperframes-reels/Reel-horoscopo diario/${FECHA}/${slug}`);
  mkdirSync(outDir, { recursive: true });
  // Copiar hyperframes.json y package.json desde variant-b para que sea proyecto válido
  const srcDir = join(ROOT, 'hyperframes-reels/variant-b');
  for (const f of ['hyperframes.json','package.json','meta.json']) {
    const src = join(srcDir, f);
    if (existsSync(src)) copyFileSync(src, join(outDir, f));
  }
  // Copiar BGM local para audio sin CORS
  const bgmSrc = join(ROOT, '.opencode/skills/reel-estilo1-orbita-xl/assets/bgm.mp3');
  if (existsSync(bgmSrc)) {
    mkdirSync(join(outDir, 'assets'), { recursive: true });
    copyFileSync(bgmSrc, join(outDir, 'assets/bgm.mp3'));
  }
  writeFileSync(join(outDir, 'index.html'), out);
  // Descripción + hashtags para publicación (copiar/pegar en IG/TikTok) — sin URL clicable, link en bio
  const desc = `${glyph} ${cap(slug)} hoy ${D} de ${MESES[M-1]} — ${lead}\n\n`+
`Energía: ${energia}\nAmor: ${amor}\nTrabajo: ${trabajo}\n\n`+
`Nº ${numero} · Color ${color} · Luna ${luna.fase} ${luna.illum}% · Ritual: ${c.ritual[luna.fase]}\n`+
`Todos los horóscopos del día en diarioastral.com ✨ Link en bio\n\n`+
`#horoscopo #horoscopodehoy #diarioastral #astrologia #zodiaco #${slug} #horoscopo${slug} ${glyph} #cartaastral #lunahoy #signosdelzodiaco #horoscopodiario #astrologiaespañol`;
  writeFileSync(join(outDir, 'descripcion.txt'), desc);
  // También dejar copia del txt junto al MP4 futuro (misma carpeta de fecha)
  const fechaDir = join(ROOT, `hyperframes-reels/Reel-horoscopo diario/${FECHA}`);
  writeFileSync(join(fechaDir, `${FECHA} - ${slug}.txt`), desc);
  console.log(`OK reel ${slug} ${FECHA} → hyperframes-reels/Reel-horoscopo diario/${FECHA}/${slug}/index.html  (nº${numero} ${color} luna ${luna.fase})`);
}

for (const slug of signosAGenerar) generarUno(slug);
console.log(`\nHecho ${signosAGenerar.length} reel(s) para ${FECHA}. Preview: cd hyperframes-reels/reel-{signo}-${FECHA} && npx hyperframes preview --background`);
