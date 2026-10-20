"""Gera o logo da Sacolista: símbolo (sacola de compras com lista) e palavra em curvas (Archivo condensada, peso 900)."""
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

# ---------- símbolo (viewBox 0 0 64 64): sacola de compras com lista ----------
# Desenhada em 640 x 640 (a arte original do Daniel, refeita em vetor) e encaixada no quadrado de 64.
CORPO_SACOLA = "M166.6 212.2Q170.5 182.5 200.5 182.5L439.5 182.5Q469.5 182.5 473.4 212.2L511.6 503.8Q516.0 537.5 482.0 537.5L158.0 537.5Q124.0 537.5 128.4 503.8Z"
def sacola(cor, tile=False):
    """sacola com alça e três itens de lista. tile=True: a mesma sacola, menor, para dentro do quadrado do ícone"""
    arte = (f'<g fill="none" stroke="{cor}" stroke-linecap="round" stroke-linejoin="round">'
            f'<path d="{CORPO_SACOLA}" stroke-width="26"/>'
            '<path d="M240 176V162A80 80 0 0 1 400 162V176" stroke-width="26" stroke-linecap="butt"/>'
            + "".join(f'<circle cx="233.5" cy="{y}" r="24.5" stroke-width="13"/>' for y in (277.5, 362.5, 448))
            + '<path d="M296.5 277.5H427.5M296.5 362.5H427.5M296.5 448H427.5" stroke-width="17"/></g>')
    return f'<g transform="translate(0 1.1) scale(.1)">{arte}</g>' if tile else f'<g transform="translate(-4.8 -3.54) scale(.115)">{arte}</g>'

def svg(w, h, corpo, titulo="Sacolista"):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w:g} {h:g}" width="{w:g}" height="{h:g}" role="img" aria-label="{titulo}">'
            f'<title>{titulo}</title>{corpo}</svg>\n')

def grava(nome, conteudo):
    with open(os.path.join(SAIDA, nome), "w", encoding="utf-8") as fh: fh.write(conteudo)

# ---------- palavra ----------
TRACK = -8
pal, larg_pal, ymin, ymax = palavra("Sacolista", TRACK)
escala = 34 / CAP                      # altura das maiúsculas = 34 unidades
w_txt = larg_pal * escala
def texto(cor, x, y_base):
    return f'<path transform="translate({x:.2f} {y_base:.2f}) scale({escala:.5f})" d="{pal}" fill="{cor}"/>'

# horizontal: símbolo 64 + espaço 14 + palavra
GAP = 14
W = 64 + GAP + w_txt
y_base = 32 + 17                       # maiúsculas centradas na altura do símbolo
def horizontal(papel, visto, tinta):
    return svg(W, 64, f'<g>{sacola(papel)}</g>' + texto(tinta, 64 + GAP, y_base))

grava("logo-horizontal.svg", horizontal(CARBONO, AMARELO, CARBONO))                 # sobre claro/papel
grava("logo-horizontal-amarelo.svg", horizontal(CARBONO, AMARELO, CARBONO))         # sobre amarelo: o visto vira recorte
grava("logo-horizontal-reverso.svg", horizontal(AMARELO, CARBONO, AMARELO))          # sobre carbono/verde
grava("logo-horizontal-preto.svg", horizontal(CARBONO, PAPEL, CARBONO))              # monocromático

# vertical: símbolo grande em cima, palavra embaixo
escala_v = 40 / CAP
Wv = max(64 * 1.6, larg_pal * escala_v)
def vertical(papel, visto, tinta):
    s = f'<g transform="translate({(Wv - 64*1.6)/2:.2f} 0) scale(1.6)">{sacola(papel)}</g>'
    s += f'<path transform="translate({(Wv - larg_pal*escala_v)/2:.2f} {64*1.6 + 18 + 40:.2f}) scale({escala_v:.5f})" d="{pal}" fill="{tinta}"/>'
    return svg(Wv, 64 * 1.6 + 18 + 40 + 6, s)
grava("logo-vertical.svg", vertical(CARBONO, AMARELO, CARBONO))
grava("logo-vertical-reverso.svg", vertical(AMARELO, CARBONO, AMARELO))

# símbolos
grava("simbolo.svg", svg(64, 64, sacola(CARBONO)))
grava("simbolo-reverso.svg", svg(64, 64, sacola(AMARELO)))
# ícone de app / favicon: quadrado amarelo com a sacola preta
grava("icone-app.svg", svg(64, 64, f'<rect width="64" height="64" rx="14" fill="{AMARELO}"/>' + sacola(CARBONO, tile=True)))
grava("favicon.svg", svg(64, 64, f'<rect width="64" height="64" rx="14" fill="{AMARELO}"/>' + sacola(CARBONO, tile=True)))
json.dump({"largura_horizontal": round(W, 2), "largura_vertical": round(Wv, 2), "largura_palavra": round(w_txt, 2)}, open(os.path.join(AQUI, "medidas.json"), "w"))
print("ok", os.listdir(SAIDA), "| larg. horizontal", round(W, 1))

# ---------- imagem de compartilhamento (1200x630), tudo em curvas ----------
def linha(txt, cap_h, x, y_base, cor):
    p, larg, _, _ = palavra(txt, TRACK)
    e = cap_h / CAP
    return f'<path transform="translate({x} {y_base}) scale({e:.5f})" d="{p}" fill="{cor}"/>', larg * e
l1, w1 = linha("Compare e economize", 72, 90, 430, CARBONO)
l2, w2 = linha("em Gramado e região.", 72, 90, 520, CARBONO)
logo_g = sacola(CARBONO) + texto(CARBONO, 64 + GAP, y_base)
og = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630"><rect width="1200" height="630" fill="{AMARELO}"/>'
      f'<g transform="translate(90 96) scale(2.6)">{logo_g}</g>{l1}{l2}</svg>\n')
grava("og.svg", og)
print("og larguras:", round(w1), round(w2), "(máx. 1020)")
