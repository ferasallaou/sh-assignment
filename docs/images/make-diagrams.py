import sys
from html import escape as e
OUT = sys.argv[1]
C = {
  'purple': ('#6b4fd8', '#f5f2ff'), 'blue': ('#2f6fde', '#eef4ff'),
  'green': ('#1f8a5b', '#ecf8f1'), 'grey': ('#57606a', '#f6f8fa'), 'orange': ('#d9822b', '#fff8f0'),
}
def head(w, h):
    m = ''.join(f'<marker id="{n}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="{c[0]}"/></marker>' for n, c in C.items())
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}" '
            "font-family=\"-apple-system, 'Segoe UI', Helvetica, Arial, sans-serif\"><defs>" + m +
            '<style>.band-label{font-size:12px;font-weight:700;letter-spacing:.08em}.t{font-size:14px;font-weight:600;fill:#1f2328}'
            '.s{font-size:12px;fill:#57606a}.edge-label{font-size:12px;fill:#57606a}</style></defs>'
            f'<rect width="{w}" height="{h}" fill="#ffffff"/>')
def band(x, y, w, h, color, label, sub=None, dashed=False):
    s, f = C[color]
    d = ' stroke-dasharray="6 4"' if dashed else ''
    out = f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="14" fill="{f}" stroke="{s}" stroke-width="1.5"{d}/>'
    out += f'<text class="band-label" x="{x+18}" y="{y+24}" fill="{s}">{e(label)}</text>'
    if sub: out += f'<text class="s" x="{x+18}" y="{y+42}">{e(sub)}</text>'
    return out
def box(x, y, w, h, color, title, lines=(), center=True, dashed=False, fill='#ffffff'):
    s = C[color][0]
    d = ' stroke-dasharray="6 4"' if dashed else ''
    out = f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="10" fill="{fill}" stroke="{s}" stroke-width="1.5"{d}/>'
    n = 1 + len(lines)
    top = y + h / 2 - (n * 17) / 2 + 13
    tx, anchor = (x + w / 2, 'middle') if center else (x + 12, 'start')
    out += f'<text class="t" x="{tx}" y="{top}" text-anchor="{anchor}">{e(title)}</text>'
    for i, l in enumerate(lines):
        out += f'<text class="s" x="{tx}" y="{top + 17*(i+1)}" text-anchor="{anchor}">{e(l)}</text>'
    return out
def arrow(points, color, dashed=False, label=None, lx=None, ly=None, anchor='start'):
    s = C[color][0]
    d = ' stroke-dasharray="6 4"' if dashed else ''
    pts = ' '.join(f'{a},{b}' for a, b in points)
    out = f'<polyline points="{pts}" fill="none" stroke="{s}" stroke-width="2"{d} marker-end="url(#{color})"/>'
    if label: out += f'<text class="edge-label" x="{lx}" y="{ly}" text-anchor="{anchor}">{e(label)}</text>'
    return out

# ---------- Data model ----------
def rows(x, y, w, color, items, highlight=()):
    out, yy = '', y
    for i, (name, note) in enumerate(items):
        hl = i in highlight
        out += box(x, yy, w, 40, 'orange' if hl else color, name, [note], center=False, fill='#fff8f0' if hl else '#ffffff')
        yy += 48
    return out
W, H = 1080, 560
svg = head(W, H)
svg += band(20, 20, 330, 470, 'purple', 'RECORD', 'one item from a source')
svg += rows(36, 74, 298, 'purple', [
    ('source · external_id', 'where it came from (Salesforce, Jira, …)'),
    ('title · content', 'the text'),
    ('fields', 'typed fields from the data contract'),
    ('allowed_groups', 'who may see it · empty means no one'),
    ('sensitivity · region', 'internal, confidential · EU, NA'),
    ('content_hash · record_hash', 'did the text change? did anything change?'),
    ('source_updated_at · synced_at', 'so answers can say "as of"'),
    ('one transaction per change', 'text, chunks, links, permissions together'),
], highlight=(3,))
svg += band(420, 20, 330, 220, 'purple', 'CHUNK', 'a searchable piece of a record')
svg += rows(436, 74, 298, 'purple', [
    ('content', 'a few paragraphs of the record'),
    ('keyword index', 'finds exact words, names and IDs'),
    ('embedding · embedding_model', 'finds meaning; one model at a time'),
])
svg += band(420, 290, 330, 200, 'blue', 'LINK', 'connects a record to an entity')
svg += rows(436, 344, 298, 'blue', [
    ('relation', 'requests · implements · describes · owns'),
    ('matched_by', 'id · alias · suggested · reviewed'),
    ('confidence', 'how sure we are about the link'),
])
svg += band(820, 290, 240, 200, 'green', 'ENTITY', 'a shared business object')
svg += rows(836, 344, 208, 'green', [
    ('type', 'feature · customer · team'),
    ('key', 'stable ID, e.g. dark-mode'),
    ('name', 'Dark mode'),
])
svg += band(820, 20, 240, 180, 'green', 'ALIASES', 'other names people use')
svg += box(836, 74, 208, 40, 'green', '"night mode"')
svg += box(836, 122, 208, 40, 'green', '"dark theme"')
svg += arrow([(350, 130), (414, 130)], 'purple', label='split into', lx=382, ly=122, anchor='middle')
svg += arrow([(350, 390), (414, 390)], 'blue', label='has', lx=382, ly=382, anchor='middle')
svg += arrow([(820, 390), (756, 390)], 'blue', label='has', lx=788, ly=382, anchor='middle')
svg += arrow([(940, 200), (940, 284)], 'green', label='known as', lx=950, ly=248)
svg += ('<text class="s" x="20" y="520">Permissions live only on the record (orange). Chunks inherit them, so one permission change applies to every chunk at once,</text>'
        '<text class="s" x="20" y="538">and a change to permissions alone never needs the text split or embedded again.</text>')
svg += '</svg>'
open(f'{OUT}/data-model.svg', 'w').write(svg)

# ---------- Update flow ----------
W, H = 1080, 520
svg = head(W, H)
svg += band(20, 20, 1040, 280, 'green', 'WHEN A RECORD CHANGES · within minutes')
y = 70
svg += box(40, y, 190, 70, 'grey', '1. Source', ['Jira says "ENG-42 changed"'])
svg += arrow([(230, y+35), (254, y+35)], 'green')
svg += box(260, y, 200, 70, 'green', '2. Connector', ['fetches the current item:', 'text and permissions'])
svg += arrow([(460, y+35), (484, y+35)], 'green')
svg += box(490, y, 170, 70, 'green', '3. Change queue', ['in order per record'])
svg += arrow([(660, y+35), (684, y+35)], 'green')
svg += box(690, y, 170, 70, 'green', '4. Worker', ['compares fingerprints'])
svg += box(880, y, 160, 70, 'grey', 'Why fetch?', ['events can be lost,', 'late or doubled'], dashed=True)
svg += arrow([(775, 140), (775, 160), (560, 160), (560, 184)], 'green')
svg += arrow([(775, 140), (775, 160), (880, 160), (880, 184)], 'green')
svg += box(400, 190, 320, 90, 'purple', 'Only permissions changed', ['update the record and its links', 'one transaction, seconds', 'no re-splitting, no new embeddings'])
svg += box(740, 190, 300, 90, 'purple', 'The text changed', ['replace chunks, rebuild links', 'in one transaction,', 'then add embeddings separately'])
svg += ('<text class="s" x="40" y="214">A reader never sees new text</text>'
        '<text class="s" x="40" y="231">with old permissions: each change</text>'
        '<text class="s" x="40" y="248">is saved all at once or not at all.</text>')
svg += band(20, 320, 1040, 170, 'blue', 'EVERY NIGHT · catches deletions no one reported')
y = 370
svg += box(40, y, 300, 90, 'blue', '1. List the source', ['every ID and fingerprint', 'that exists right now'])
svg += arrow([(340, y+45), (374, y+45)], 'blue')
svg += box(380, y, 300, 90, 'blue', '2. Compare with the store', ['anything missing from the source', 'was deleted there'])
svg += arrow([(680, y+45), (714, y+45)], 'blue')
svg += box(720, y, 320, 90, 'blue', '3. Delete it here too', ['record, chunks and links go together', 'an empty export is refused, never', 'treated as "delete everything"'])
svg += '</svg>'
open(f'{OUT}/update-flow.svg', 'w').write(svg)
print('ok')
