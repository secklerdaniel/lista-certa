/* GET/POST /api/cupom  (qr = texto completo do QR code da NFC-e do RS)
   Busca a nota no portal SVRS e devolve mercado + itens. Só RS (UF 43).
   O host é FIXO e o parâmetro p é validado por regex: a função não busca URL que o cliente mande.
   Não devolve nem registra o CPF do consumidor (a página o traz, mas ele nunca é lido aqui). */
const PORTAL = "https://dfe-portal.svrs.rs.gov.br/Dfe/QrCodeNFce?p=";
const FORMATO = /^\d{44}\|\d\|\d\|\d+\|[0-9A-Fa-f]{40}$/;

const ent = s => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ");
const txt = s => ent(String(s || "").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
const num = s => { const n = parseFloat(String(s || "").replace(/\./g, "").replace(",", ".")); return Number.isFinite(n) ? n : null; };
const pega = (re, s) => { const m = re.exec(s); return m ? m[1] : ""; };

function parse(html) {
  const h = html.replace(/\r/g, "").replace(/\n/g, " ");
  const itens = [];
  const re = /<tr id="Item[^"]*">(.*?)<\/tr>/g;
  let m;
  while ((m = re.exec(h))) {
    const r = m[1];
    const nome = txt(pega(/<span class="txtTit">(.*?)<\/span>/, r));
    if (!nome) continue;
    itens.push({
      nome,
      codigo: pega(/Código:\s*(\S+)/, txt(pega(/<span class="RCod">(.*?)<\/span>/, r))),
      qtd: num(txt(pega(/<span class="Rqtd">(.*?)<\/span>/, r)).replace(/^Qtde\.:\s*/, "")),
      un: txt(pega(/<span class="RUN">(.*?)<\/span>/, r)).replace(/^UN:\s*/, ""),
      unit: (() => { const v = num(txt(pega(/<span class="RvlUnit">(.*?)<\/span>/, r)).replace(/^Vl\. Unit\.:\s*/, "")); return v == null ? null : Math.round(v * 100) / 100; })(),
      total: num(txt(pega(/<span class="valor">(.*?)<\/span>/, r))),
    });
  }
  const topo = pega(/<div[^>]*class="txtTopo"[^>]*>(.*?)<\/div>/, h);
  const textos = [...h.matchAll(/<div class="text">(.*?)<\/div>/g)].map(x => txt(x[1]));
  const emis = /Emissão:\s*<\/strong>\s*(\d{2})\/(\d{2})\/(\d{4}) (\d{2}:\d{2}:\d{2})/.exec(h);
  return {
    mercado: {
      nome: txt(topo),
      cnpj: (textos.find(t => /CNPJ/.test(t)) || "").replace(/^CNPJ:\s*/, ""),
      endereco: textos.find(t => /,\s*RS\s*$/.test(t)) || "",
    },
    emissao: emis ? `${emis[3]}-${emis[2]}-${emis[1]}T${emis[4]}` : null,
    numero: num(pega(/Número:\s*<\/strong>\s*(\d+)/, h)),
    serie: num(pega(/Série:\s*<\/strong>\s*(\d+)/, h)),
    total: num(txt(pega(/Valor a pagar R\$:<\/label><span class="totalNumb txtMax">(.*?)<\/span>/, h))),
    itens,
  };
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  const entrada = req.method === "POST" ? (req.body && req.body.qr) : req.query && req.query.qr;
  const bruto = String(entrada || "").trim();
  const mp = /[?&]p=([^&\s#]+)/i.exec(bruto);
  let p = mp ? mp[1] : bruto;
  try { p = decodeURIComponent(p); } catch (e) { /* mantém */ }
  if (!FORMATO.test(p)) return res.status(400).end(JSON.stringify({ ok: false, erro: "qr_formato", msg: "Texto do QR fora do formato esperado." }));
  if (p.slice(0, 2) !== "43") return res.status(422).end(JSON.stringify({ ok: false, erro: "uf_nao_suportada", msg: "Por enquanto só cupons do RS." }));

  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 15000);
  try {
    const r = await fetch(PORTAL + p, { signal: ctl.signal, headers: { "User-Agent": "Mozilla/5.0 (compatible; ListaCerta/1.0)" } });
    const html = await r.text();
    const dados = parse(html);
    if (!dados.itens.length) {
      const aviso = txt(html).slice(0, 200);
      return res.status(502).end(JSON.stringify({ ok: false, erro: "portal", msg: "O portal não devolveu os itens.", detalhe: aviso }));
    }
    return res.status(200).end(JSON.stringify({ ok: true, ...dados }));
  } catch (e) {
    return res.status(504).end(JSON.stringify({ ok: false, erro: "timeout", msg: "O portal da Fazenda não respondeu a tempo." }));
  } finally {
    clearTimeout(t);
  }
};
module.exports.parse = parse;
