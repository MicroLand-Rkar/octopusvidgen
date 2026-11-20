"""Check a locale file against the English source: every key present, placeholders identical.
Usage: python3 scripts/i18n-check.py src/i18n/locales/th.json"""
import json, re, sys
base = __file__.rsplit('/', 1)[0] + '/../src/i18n/locales/'
en, my = json.load(open(base + 'en.json')), json.load(open(base + 'my.json'))
# English is the source; the style texts are keyed by their English, the examples' slugs come from English.
src = {'ui_en': en['ui'], 'style_en': sorted(my['style']), 'examples_my': en['examples']}
loc = json.load(open(sys.argv[1]))
ph = lambda s: sorted(re.findall(r'\{[a-zA-Z_]+\}', s))
bad = []
ui = loc.get('ui', {})
for k, v in src['ui_en'].items():
    if k not in ui: bad.append(f'ui missing {k}')
    elif ph(ui[k]) != ph(v): bad.append(f'ui placeholders {k}: {ph(ui[k])} vs {ph(v)}')
st = loc.get('style', {})
for k in ([] if sys.argv[1].endswith('en.json') else src['style_en']):  # English is its own source
    if k not in st: bad.append(f'style missing {k[:50]}')
    elif ph(st[k]) != ph(k): bad.append(f'style placeholders {k[:40]}')
ex = loc.get('examples', {})
for k, v in src['examples_my'].items():
    if len(ex.get(k, [])) != len(v): bad.append(f'examples {k}: {len(ex.get(k, []))}/{len(v)}')
print('\n'.join(bad[:40]) or 'OK', f'({len(bad)} problems)' if bad else '')
sys.exit(1 if bad else 0)
