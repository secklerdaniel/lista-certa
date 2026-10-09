"""Gera o logo da Lista Certa: símbolo (cupom serrilhado + visto) e palavra em curvas (Archivo condensada, peso 900)."""
import os, json
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.boundsPen import BoundsPen

AQUI = os.path.dirname(os.path.abspath(__file__))
SAIDA = os.path.join(AQUI, "svg"); os.makedirs(SAIDA, exist_ok=True)
AMARELO, CARBONO, PAPEL = "#FFD93B", "#15191A", "#FBFAF5"

f = instantiateVariableFont(TTFont(os.path.join(AQUI, "Archivo.ttf")), {"wght": 900, "wdth": 62})
gs, cmap = f.getGlyphSet(), f.getBestCmap()

def palavra(texto, tracking=0):
    """devolve (path SVG com y para baixo, largura, altura_das_maiusculas, descida, subida)"""
    x, partes, ymin, ymax = 0, [], 0, 0
    for ch in texto:
        g = gs[cmap[ord(ch)]]
        pen = SVGPathPen(gs); g.draw(TransformPen(pen, (1, 0, 0, -1, x, 0))); partes.append(pen.getCommands())
        bp = BoundsPen(gs); g.draw(bp)
        if bp.bounds: ymin, ymax = min(ymin, bp.bounds[1]), max(ymax, bp.bounds[3])
        x += g.width + tracking
    return " ".join(p for p in partes if p), x - tracking, ymin, ymax

def cap():
    bp = BoundsPen(gs); gs[cmap[ord("L")]].draw(bp); return bp.bounds[3]

CAP = cap()

# ---------- símbolo (viewBox 0 0 64 64) ----------
def cupom(cor_papel, cor_visto, barras=True):
    """cupom com borda serrilhada embaixo + visto; barras = 'linhas de texto' do cupom"""
    dentes, x0, x1, topo, base, fundo = 5, 10, 54, 4, 59, 51
    pts = [f"M{x0} {topo}", f"H{x1}", f"V{base}"]
    larg = (x1 - x0) / dentes
    for k in range(1, dentes + 1):
        x = x1 - larg * k
        pts.append(f"L{x:.2f} {fundo if k % 2 else base}")
    pts.append("Z")
    s = f'<path d="{" ".join(pts)}" fill="{cor_papel}"/>'
    if barras:
        s += f'<rect x="17" y="11" width="30" height="3.6" fill="{cor_visto}"/><rect x="17" y="18" width="19" height="3.6" fill="{cor_visto}"/>'
        s += f'<path d="M19 38 L28 47 L46 26" fill="none" stroke="{cor_visto}" stroke-width="7" stroke-linecap="square" stroke-linejoin="miter"/>'
    else:
        s += f'<path d="M18 31 L28 42 L47 18" fill="none" stroke="{cor_visto}" stroke-width="8" stroke-linecap="square" stroke-linejoin="miter"/>'
    return s

def svg(w, h, corpo, titulo="Lista Certa"):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w:g} {h:g}" width="{w:g}" height="{h:g}" role="img" aria-label="{titulo}">'
            f'<title>{titulo}</title>{corpo}</svg>\n')

def grava(nome, conteudo):
    with open(os.path.join(SAIDA, nome), "w", encoding="utf-8") as fh: fh.write(conteudo)

# ---------- palavra ----------
TRACK = -8
pal, larg_pal, ymin, ymax = palavra("Lista Certa", TRACK)
escala = 34 / CAP                      # altura das maiúsculas = 34 unidades
w_txt = larg_pal * escala
def texto(cor, x, y_base):
    return f'<path transform="translate({x:.2f} {y_base:.2f}) scale({escala:.5f})" d="{pal}" fill="{cor}"/>'

# horizontal: símbolo 64 + espaço 14 + palavra
GAP = 14
W = 64 + GAP + w_txt
y_base = 32 + 17                       # maiúsculas centradas na altura do símbolo
def horizontal(papel, visto, tinta):
    return svg(W, 64, f'<g>{cupom(papel, visto)}</g>' + texto(tinta, 64 + GAP, y_base))

grava("logo-horizontal.svg", horizontal(CARBONO, AMARELO, CARBONO))                 # sobre claro/papel
grava("logo-horizontal-amarelo.svg", horizontal(CARBONO, AMARELO, CARBONO))         # sobre amarelo: o visto vira recorte
grava("logo-horizontal-reverso.svg", horizontal(AMARELO, CARBONO, AMARELO))          # sobre carbono/verde
grava("logo-horizontal-preto.svg", horizontal(CARBONO, PAPEL, CARBONO))              # monocromático

# vertical: símbolo grande em cima, palavra embaixo
escala_v = 40 / CAP
Wv = max(64 * 1.6, larg_pal * escala_v)
def vertical(papel, visto, tinta):
    s = f'<g transform="translate({(Wv - 64*1.6)/2:.2f} 0) scale(1.6)">{cupom(papel, visto)}</g>'
    s += f'<path transform="translate({(Wv - larg_pal*escala_v)/2:.2f} {64*1.6 + 18 + 40:.2f}) scale({escala_v:.5f})" d="{pal}" fill="{tinta}"/>'
    return svg(Wv, 64 * 1.6 + 18 + 40 + 6, s)
grava("logo-vertical.svg", vertical(CARBONO, AMARELO, CARBONO))
grava("logo-vertical-reverso.svg", vertical(AMARELO, CARBONO, AMARELO))

# símbolos
grava("simbolo.svg", svg(64, 64, cupom(CARBONO, AMARELO)))
grava("simbolo-reverso.svg", svg(64, 64, cupom(AMARELO, CARBONO)))
# ícone de app / favicon: quadrado amarelo, cupom preto, visto amarelo (versão simples, legível em 16 px)
grava("icone-app.svg", svg(64, 64, f'<rect width="64" height="64" rx="14" fill="{AMARELO}"/>' + cupom(CARBONO, AMARELO, barras=False)))
grava("favicon.svg", svg(64, 64, f'<rect width="64" height="64" rx="14" fill="{AMARELO}"/>' + cupom(CARBONO, AMARELO, barras=False)))
json.dump({"largura_horizontal": round(W, 2), "largura_vertical": round(Wv, 2), "largura_palavra": round(w_txt, 2)}, open(os.path.join(AQUI, "medidas.json"), "w"))
print("ok", os.listdir(SAIDA), "| larg. horizontal", round(W, 1))

# ---------- imagem de compartilhamento (1200x630), tudo em curvas ----------
def linha(txt, cap_h, x, y_base, cor):
    p, larg, _, _ = palavra(txt, TRACK)
    e = cap_h / CAP
    return f'<path transform="translate({x} {y_base}) scale({e:.5f})" d="{p}" fill="{cor}"/>', larg * e
l1, w1 = linha("Compare e economize", 72, 90, 430, CARBONO)
l2, w2 = linha("em Gramado e região.", 72, 90, 520, CARBONO)
logo_g = cupom(CARBONO, AMARELO) + texto(CARBONO, 64 + GAP, y_base)
og = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630"><rect width="1200" height="630" fill="{AMARELO}"/>'
      f'<g transform="translate(90 96) scale(2.6)">{logo_g}</g>{l1}{l2}</svg>\n')
grava("og.svg", og)
print("og larguras:", round(w1), round(w2), "(máx. 1020)")
