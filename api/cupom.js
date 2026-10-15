/* GET/POST /api/cupom  (qr = texto completo do QR code da NFC-e do RS)
   Busca a nota no portal SVRS e devolve mercado + itens. Só RS (UF 43).
   O host é FIXO e o parâmetro p é validado por regex: a função não busca URL que o cliente mande.
   Não devolve nem registra o CPF do consumidor (a página o traz, mas ele nunca é lido aqui). */
const PORTAL = "https://dfe-portal.svrs.rs.gov.br/Dfe/QrCodeNFce?p=";
const FORMATO = /^\d{44}\|\d\|\d(?:\|[0-9A-Za-z.+\/=]+){1,5}\|[0-9A-Fa-f]{40}$/; /* normal: chave|2|1|1|hash; contingência: chave|2|1|dia|valor|digest|1|hash */

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
      const rej = /^\d{3} - .{5,150}/.exec(aviso); /* recusa da Fazenda (ex.: 234 - prazo de 24h) */
      return res.status(502).end(JSON.stringify({ ok: false, erro: "portal", msg: /^23[48] /.test(aviso) ? "A nota ainda não está disponível no portal da Fazenda. Tente de novo mais tarde." : rej ? "A Fazenda respondeu: " + rej[0] : "O portal não devolveu os itens.", detalhe: aviso }));
    }
    /* o mercado do cupom entra no catálogo da região (pelo CNPJ), para aparecer nas sugestões do envio de vídeo */
    try {
      const { sql } = require("./_lib");
      const seg0 = (dados.mercado.endereco || "").split(",").map(s => s.trim()).filter(Boolean);
      const cid0 = seg0.length >= 2 ? seg0[seg0.length - 2] : null, cnpj0 = (dados.mercado.cnpj || "").replace(/\D/g, "");
      if (cid0 && cnpj0.length === 14 && dados.mercado.nome) {
        const bonito = s => s.toLowerCase().replace(/\b(ltda|eireli|epp|me|s\/?a)\b\.?/g, "").replace(/\s+/g, " ").trim().replace(/(^|\s)(\S)/g, (a, b, c) => b + c.toUpperCase());
        const cidade0 = cid0.toLowerCase().replace(/(^|\s)(\S)/g, (a, b, c) => b + c.toUpperCase()).replace(/ (De|Da|Do) /g, x => x.toLowerCase());
        const ja = await sql().query(`select id from mercados_regiao where cnpj = $1`, [cnpj0]);
        if (!ja.length) await sql().query(`insert into mercados_regiao (nome, cidade, endereco, cnpj, fonte) values ($1, $2, $3, $4, 'cupom') on conflict do nothing`, [bonito(dados.mercado.nome), cidade0, seg0.slice(0, 2).join(", ").slice(0, 160), cnpj0]);
      }
    } catch (e) { /* o catálogo é um bônus: nunca derruba a leitura do cupom */ }

    /* se a pessoa está logada, o servidor registra a contribuição (1 por cupom, no mundo todo) — pontos só de cupom que o servidor viu */
    let contribuicao = null, contribId = null;
    try {
      const A = require("./_auth"), { sql } = require("./_lib");
      const usr = await A.usuario(req);
      if (usr) {
        const seg = (dados.mercado.endereco || "").split(",").map(s => s.trim()).filter(Boolean);
        const cidade = seg.length >= 2 ? seg[seg.length - 2] : null;
        const ins = await sql().query(
          `insert into contribuicoes (usuario_id, tipo, mercado_nome, cidade, itens, chave) values ($1, 'cupom', $2, $3, $4, $5)
           on conflict (chave) do nothing returning id`, [usr.id, dados.mercado.nome, cidade, dados.itens.length, p.slice(0, 44)]);
        contribId = ins.length ? ins[0].id : null;
        const n = await A.pontos(usr.id);
        contribuicao = { novo: ins.length > 0, pontos: n, nivel: A.nivel(n) };
      }
    } catch (e) { contribuicao = null; }

    /* guarda os itens e preços do cupom: vêm do portal da Fazenda (não dá para forjar) e alimentam a comparação de TODOS.
       Se a pessoa está logada, ficam ligados à contribuição dela (excluir a coleta apaga estes preços). Nunca guarda CPF. */
    try {
      const { sql } = require("./_lib");
      const seg = (dados.mercado.endereco || "").split(",").map(s => s.trim()).filter(Boolean);
      const cid = seg.length >= 2 ? seg[seg.length - 2] : null, cnpj = (dados.mercado.cnpj || "").replace(/\D/g, "");
      const cidade = cid ? cid.toLowerCase().replace(/(^|\s)(\S)/g, (a, b, c) => b + c.toUpperCase()).replace(/ (De|Da|Do) /g, x => x.toLowerCase()) : null;
      const v = dados.itens.map((x, i) => ({ ...x, i })).filter(x => x.nome && x.unit > 0 && x.unit < 10000);
      if (cidade && cnpj.length === 14 && v.length) {
        await sql().query(
          `insert into precos_cupom (chave, ordem, cnpj, mercado_nome, cidade, descricao, codigo_loja, unidade, qtd, preco_unit, emissao, contribuicao_id)
           select $1, t.o, $2, $3, $4, t.d, t.c, t.u, t.q, t.p, ($5::timestamp at time zone 'America/Sao_Paulo'), $6
             from unnest($7::int[], $8::text[], $9::text[], $10::text[], $11::numeric[], $12::numeric[]) as t(o, d, c, u, q, p)
           on conflict (chave, ordem) do nothing`,
          [p.slice(0, 44), cnpj, dados.mercado.nome, cidade, dados.emissao, contribId,
            v.map(x => x.i), v.map(x => x.nome.slice(0, 160)), v.map(x => x.codigo || null), v.map(x => (x.un || "").slice(0, 8) || null), v.map(x => x.qtd), v.map(x => x.unit)]);
      }
    } catch (e) { /* guardar é um bônus: nunca derruba a leitura do cupom */ }
    return res.status(200).end(JSON.stringify({ ok: true, ...dados, contribuicao }));
  } catch (e) {
    return res.status(504).end(JSON.stringify({ ok: false, erro: "timeout", msg: "O portal da Fazenda não respondeu a tempo." }));
  } finally {
    clearTimeout(t);
  }
};
module.exports.parse = parse;
