#!/usr/bin/env python3
"""Publica en Instagram vía instagrapi (API privada): 1 reel + 3 stories.

Rotación determinista sin repeticiones: reel = doy%12, stories = +3/+6/+9
(en cualquier ventana de 3 días no se repite ningún signo).
Sin LLM: caption reconstruido del corpus (vendor/corpus) con las mismas
fórmulas del generador (generar-reel.mjs).

Sesión: se crea UNA vez en un PC de confianza y se reutiliza. Sin contraseña
en el cron: si la sesión caduca el job falla con mensaje claro y hay que
regenerar session.json en local.

Uso:
  python scripts/instapublicar.py --date=2026-09-25 --dry-run
  IG_SESSION='<json>' python scripts/instapublicar.py --date=2026-09-25
"""
import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent.parent
MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
         'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
GLYPH = {'aries': '♈', 'tauro': '♉', 'geminis': '♊', 'cancer': '♋',
         'leo': '♌', 'virgo': '♍', 'libra': '♎', 'escorpio': '♏',
         'sagitario': '♐', 'capricornio': '♑', 'acuario': '♒', 'piscis': '♓'}
LUNA_KW = {'nueva': ['siembra', 'intención'], 'creciente': ['empuja', 'avanza'],
           'llena': ['culmina', 'celebra'], 'menguante': ['suelta', 'ordena']}


def load(name):
    return json.loads((ROOT / name).read_text(encoding='utf-8'))


def pick(arr, m1, m2, idx, doy):
    return arr[(doy * m1 + idx * m2) % len(arr)]


def pick_biased(arr, m1, m2, idx, doy, kw):
    if not kw:
        return pick(arr, m1, m2, idx, doy)
    low = [t.lower() for t in arr]
    cand = [t for i, t in enumerate(arr) if any(k in low[i] for k in kw)]
    if len(cand) >= 3:
        return cand[(doy * m1 + idx * m2) % len(cand)]
    return pick(arr, m1, m2, idx, doy)


def build_caption(slug, meta, corpus, doy, fecha):
    Y, M, D = map(int, fecha.split('-'))
    idx = [s['slug'] for s in meta['signos']].index(slug)
    c = corpus[slug]
    ref = datetime(2000, 1, 6, 18, 14, tzinfo=timezone.utc).timestamp() / 86400
    day = datetime(Y, M, D, 12, tzinfo=timezone.utc).timestamp() / 86400
    c0 = ((day - ref) % 29.53 + 29.53) % 29.53
    fase = ('nueva' if c0 < 1.2 else 'creciente' if c0 < 7.4
            else 'llena' if c0 < 14.8 else 'menguante' if c0 < 22.1 else 'nueva')
    import math
    illum = round((1 - math.cos(2 * math.pi * c0 / 29.53)) / 2 * 100)
    kw = LUNA_KW[fase]
    lead = pick_biased(c['lead'], 1, 3, idx, doy, kw[:2])
    energia = pick_biased(c['energia'], 31, 17, idx, doy, kw)
    amor = pick_biased(c['amor'], 17, 29, idx, doy, kw[:1])
    trabajo = pick_biased(c['trabajo'], 13, 23, idx, doy, kw[:1])
    numero = (doy * 7 + idx * 13) % 99 + 1
    color = meta['colores'][(doy + idx) % len(meta['colores'])]
    glyph = GLYPH[slug]
    nombre = slug[0].upper() + slug[1:]
    return (f"{glyph} {nombre} hoy {D} de {MESES[M - 1]} — {lead}\n\n"
            f"Energía: {energia}\nAmor: {amor}\nTrabajo: {trabajo}\n\n"
            f"Nº {numero} · Color {color} · Luna {fase} {illum}% · "
            f"Ritual: {c['ritual'][fase]}\n"
            f"Todos los horóscopos del día en diarioastral.com ✨ Link en bio\n\n"
            f"#horoscopo #horoscopodehoy #diarioastral #astrologia #zodiaco "
            f"#{slug} #horoscopo{slug} {glyph} #cartaastral #lunahoy "
            f"#signosdelzodiaco #horoscopodiario #astrologiaespañol")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--date', default=None)
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--slot', default='0', choices=['0', '1'],
                    help='0=mañana, 1=tarde (bloques disjuntos, sin repeticiones)')
    a = ap.parse_args()
    fecha = a.date or datetime.now(ZoneInfo('Europe/Madrid')).strftime('%Y-%m-%d')
    try:
        datetime.strptime(fecha, '%Y-%m-%d')
    except ValueError:
        print('--date debe ser YYYY-MM-DD', file=sys.stderr)
        sys.exit(1)

    meta = load('vendor/corpus/meta.json')
    corpus = {}
    for f in ['fuego.json', 'tierra.json', 'aire.json', 'agua.json']:
        corpus.update(load(f'vendor/corpus/{f}'))
    signs = [s['slug'] for s in meta['signos']]
    Y, M, D = map(int, fecha.split('-'))
    d = datetime(Y, M, D, 12, tzinfo=timezone.utc)
    # Igual que generar-reel.mjs: 1-ene = día 1 (no día 0)
    doy = (d - datetime(Y - 1, 12, 31, tzinfo=timezone.utc)).days

    # Dos slots al día con bloques disjuntos: base mañana=2*doy, tarde=2*doy+1.
    # Bloques consecutivos nunca comparten signo (residuos mod 3 distintos).
    base = 2 * doy + int(a.slot)
    reel = signs[base % 12]
    stories = [signs[(base + off) % 12] for off in (3, 6, 9)]
    assert len({reel, *stories}) == 4, 'rotación rota'
    plan = [('REELS', reel, build_caption(reel, meta, corpus, doy, fecha))]
    plan += [('STORIES', s, None) for s in stories]

    print(f"Fecha: {fecha}  Slot: {a.slot}  Reel: {reel}  Stories: {', '.join(stories)}"
          f"{'  [dry-run]' if a.dry_run else ''}")
    for kind, slug, caption in plan:
        video = ROOT / f'{fecha}-{slug}.mp4'
        print(f'\n=== {kind} {slug} ===\n{video}')
        if not video.exists():
            print(f'ERROR: no existe {video}', file=sys.stderr)
            sys.exit(1)
        if kind == 'REELS':
            print(f'Caption ({len(caption)} chars)')
        if a.dry_run:
            print('[dry-run] no se publica')

    if a.dry_run:
        print('\nHecho (dry-run): 1 reel + 3 stories.')
        return

    session = os.environ.get('IG_SESSION')
    if not session:
        print('Falta IG_SESSION en el entorno.', file=sys.stderr)
        sys.exit(1)
    sess_file = ROOT / 'session.json'
    sess_file.write_text(session, encoding='utf-8')
    os.chmod(sess_file, 0o600)

    from instagrapi import Client
    cl = Client()
    try:
        cl.load_settings(str(sess_file))
        # Sesión reutilizada tal cual, sin login() ni contraseña.
        me = cl.user_info(cl.user_id)
        print(f"Sesión OK: @{me.username}")
    except Exception as e:
        print(f'ERROR: sesión no válida ({type(e).__name__}: {e}). '
              'Regenera session.json en local y actualiza el secret IG_SESSION.',
              file=sys.stderr)
        sys.exit(1)

    try:
        assert hasattr(cl, 'clip_upload') and hasattr(cl, 'video_upload_to_story')
        for kind, slug, caption in plan:
            video = str(ROOT / f'{fecha}-{slug}.mp4')
            if kind == 'REELS':
                m = cl.clip_upload(video, caption)
                print(f'✅ Reel {slug}: pk={m.pk}')
            else:
                cl.video_upload_to_story(video)
                print(f'✅ Story {slug} publicada')
            time.sleep(90)
    except Exception as e:
        print(f'ERROR publicando ({type(e).__name__}: {e}). '
              'Si pide verificación, hazla en el móvil y reintenta.',
              file=sys.stderr)
        sys.exit(1)
    print('\nHecho: 1 reel + 3 stories.')


if __name__ == '__main__':
    main()
