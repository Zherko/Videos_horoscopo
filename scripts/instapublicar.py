#!/usr/bin/env python3
"""Publica en Instagram vía instagrapi (API privada): 1 reel + 3 stories.

Aleatorio con memoria y sin repeticiones: cada fecha baraja los 12 signos
(seed=fecha) y publica los 8 menos recientes (historial recalculado desde
2026-01-01: determinista, sin estado en disco). Solape mínimo con el día
anterior (4/8, inevitable publicando 8 de 12 al día) y los 2 reels siempre
entre los menos usados → el reel nunca repite el de ayer. Dentro de cada
pase los 4 signos son distintos (reel nunca en sus stories).
El reel sube con portada propia ({fecha}-{signo}-cover.jpg, frame t=3s);
sin cover cae a la miniatura automática. Stories sin portada.
Blindaje: antes de subir lee los reels ya en vivo hoy y omite el que
exista (anti-duplicados; sin lectura no publica), al final verifica que
el reel quedó en vivo y escribe veredicto.txt (OK/FALLO) para la alarma.
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
import random
import re
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
EPOCH_ORD = datetime(2026, 1, 1).toordinal()
try:
    MADRID_TZ = ZoneInfo('Europe/Madrid')
except Exception:
    # Sin base tzdata (Windows sin pip tzdata): los pases son 10:00/16:00,
    # lejos de medianoche, así que UTC no cambia el día.
    MADRID_TZ = timezone.utc


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


def day_picks(signs, target_ord):
    """8 signos del día: los menos recientes (baraja diaria con seed=fecha
    como desempate). Recalcula el historial desde EPOCH_ORD: determinista."""
    last_used = {}
    eight = []
    for ord_ in range(EPOCH_ORD, target_ord + 1):
        rng = random.Random(str(ord_))
        order = signs[:]
        rng.shuffle(order)
        pos = {s: i for i, s in enumerate(order)}
        eight = sorted(signs, key=lambda s: (last_used.get(s, -1), pos[s]))[:8]
        for s in eight:
            last_used[s] = ord_
    return eight


def escribir_veredicto(txt):
    try:
        (ROOT / 'veredicto.txt').write_text(txt + '\n', encoding='utf-8')
    except Exception:
        pass


def publicados_hoy(cl, signs, fecha):
    """Slugs con reel en vivo hoy: caption con #slug y taken_at de hoy
    (Europe/Madrid). Las stories no se pueden comprobar (no están en el
    feed y caducan en 24h): solo cubre reels."""
    live = set()
    for m in cl.user_medias(cl.user_id, amount=25):
        taken = m.taken_at
        try:
            madrid = (taken if taken.tzinfo else taken.replace(tzinfo=timezone.utc)).astimezone(MADRID_TZ)
        except Exception:
            continue
        if madrid.strftime('%Y-%m-%d') != fecha:
            continue
        cap = m.caption_text or ''
        for s in signs:
            if re.search(fr'#{s}(?![a-z0-9])', cap):
                live.add(s)
    return live


def main():
    # Consola Windows (cp1252) rompe los prints con emoji tras publicar:
    # un crash ahí finge ERROR con exit 1 aunque la subida fue bien.
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
        sys.stderr.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass
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

    # Dos slots al día con bloques disjuntos del mismo 8 (mañana=reel uno de
    # los 2 menos usados + 3 stories, tarde=el otro + otras 3). Sin solape
    # mañana↔tarde y solape mínimo con el día anterior.
    eight = day_picks(signs, datetime(Y, M, D).toordinal())
    if a.slot == '0':
        reel, stories = eight[0], eight[2:5]
    else:
        reel, stories = eight[1], eight[5:8]
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
            cover = ROOT / f'{fecha}-{slug}-cover.jpg'
            print(f'Cover: {cover.name}' if cover.exists() else 'Cover: auto (sin cover.jpg)')
        if a.dry_run:
            print('[dry-run] no se publica')

    if a.dry_run:
        print('\nHecho (dry-run): 1 reel + 3 stories.')
        return

    escribir_veredicto(f'INICIO {fecha} slot={a.slot} dry={a.dry_run}')

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

    # Anti-duplicados: lee qué reels ya están en vivo hoy (3 intentos);
    # sin lectura no se publica. El reel en vivo se omite; las stories
    # siempre se intentan (no son comprobables por API).
    live = set()
    for intento in range(1, 4):
        try:
            live = publicados_hoy(cl, signs, fecha)
            break
        except Exception as e:
            print(f'Aviso: sin lectura de publicados (intento {intento}/3): {type(e).__name__}.')
            time.sleep(10)
    else:
        msg = 'ERROR: sin lectura de publicados, no se publica (anti-duplicados).'
        print(msg, file=sys.stderr)
        escribir_veredicto(f'FALLO {fecha} slot={a.slot} sin-lectura')
        sys.exit(1)
    ya = [s for _, s, _ in plan if s in live]
    if ya:
        print(f'Ya en vivo, se omiten: {", ".join(ya)}')

    try:
        assert hasattr(cl, 'clip_upload') and hasattr(cl, 'video_upload_to_story')
        for kind, slug, caption in plan:
            video = str(ROOT / f'{fecha}-{slug}.mp4')
            if kind == 'REELS':
                if slug in live:
                    print(f'(omitido, ya en vivo) Reel {slug}')
                    continue
                cover = ROOT / f'{fecha}-{slug}-cover.jpg'
                m = cl.clip_upload(video, caption, thumbnail=(str(cover) if cover.exists() else None))
                print(f'✅ Reel {slug}: pk={m.pk}')
                live.add(slug)
            else:
                cl.video_upload_to_story(video)
                print(f'✅ Story {slug} publicada')
            time.sleep(90)
    except Exception as e:
        print(f'ERROR publicando ({type(e).__name__}: {e}). '
              'Si pide verificación, hazla en el móvil y reintenta.',
              file=sys.stderr)
        escribir_veredicto(f'FALLO {fecha} slot={a.slot} {type(e).__name__}')
        sys.exit(1)
    # Verificación final: el reel debe estar en vivo (relecturas con espera).
    ok = False
    for _ in range(3):
        time.sleep(20)
        try:
            if reel in publicados_hoy(cl, signs, fecha):
                ok = True
                break
        except Exception:
            pass
    if not ok:
        print(f'ERROR: el reel {reel} no aparece en vivo tras publicar.', file=sys.stderr)
        escribir_veredicto(f'FALLO {fecha} slot={a.slot} reel-no-visible')
        sys.exit(1)
    escribir_veredicto(f'OK {fecha} slot={a.slot} reel={reel}')
    print('\nHecho: 1 reel + 3 stories.')


if __name__ == '__main__':
    main()
