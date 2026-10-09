/* POST /api/v1/coletas  { mercado: { nome, cidade }, itens: [{ descricao, preco, promocao?, gtin? }] }
   Guarda preços contribuídos pela comunidade (ex.: lidos de vídeo, já revisados pela pessoa) como "pendente de verificação".
   Público, com limite por IP. Não entra em /precos: é separado dos preços enviados pelos mercados. */
const { sql, sha256, enviar, erro, corpo, gtinValido } = require("../_lib");

const MAX_ITENS = 100, LIMITE_HORA = 6;

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") { res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS"); res.setHeader("Access-Control-Allow-Headers", "Content-Type"); res.statusCode = 204; return res.end(); }
  if (req.method !== "POST") return erro(res, 405, "metodo", "Use POST.");
  const b = corpo(req);
  const nome = b && b.mercado && typeof b.mercado.nome === "string" ? b.mercado.nome.trim().slice(0, 120) : "";
  const cidade = b && b.mercado && typeof b.mercado.cidade === "string" ? b.mercado.cidade.trim().slice(0, 80) : "";
  if (!nome || !cidade) return erro(res, 400, "mercado", "Informe mercado.nome e mercado.cidade.");
  if (!b || !Array.isArray(b.itens) || !b.itens.length) return erro(res, 400, "itens", 'Envie "itens".');
  if (b.itens.length > MAX_ITENS) return erro(res, 413, "itens_demais", `No máximo ${MAX_ITENS} itens.`);
  const ok = [];
  for (const it of b.itens) {
    const descricao = it && typeof it.descricao === "string" ? it.descricao.replace(/\s+/g, " ").trim().slice(0, 120) : "";
    const preco = Math.round(Number(it && it.preco) * 100) / 100;
    if (!descricao || !(preco > 0 && preco < 10000)) continue;
    let promo = Math.round(Number(it.promocao) * 100) / 100;
    if (!(promo > 0 && promo < preco)) promo = null;
    ok.push([descricao, it.gtin && gtinValido(String(it.gtin)) ? String(it.gtin) : null, preco, promo]);
  }
  if (!ok.length) return erro(res, 400, "itens_invalidos", "Nenhum item válido.");
  try {
    const ip = sha256(String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "?").split(",")[0].trim() + "|lc");
    const r = await sql().query(`select count(*)::int as n from uso_publico where ip_hash = $1 and tipo = 'coleta' and em > now() - interval '1 hour'`, [ip]);
    if (r[0].n >= LIMITE_HORA) return erro(res, 429, "limite", "Muitos envios em pouco tempo. Tente de novo mais tarde.");
    await sql().query(`insert into uso_publico (ip_hash, tipo) values ($1, 'coleta')`, [ip]);
    await sql().query(
      `insert into coletas (mercado_nome, cidade, descricao, gtin, preco, promocao_preco, origem, ip_hash)
       select $1, $2, d, g, p, pp, 'video', $7 from unnest($3::text[], $4::text[], $5::numeric[], $6::numeric[]) as t(d, g, p, pp)`,
      [nome, cidade, ok.map(x => x[0]), ok.map(x => x[1]), ok.map(x => x[2]), ok.map(x => x[3]), ip]);
    enviar(res, 201, { ok: true, recebidos: ok.length, status: "pendente de verificação" });
  } catch (e) { erro(res, 500, "interno", "Erro interno."); }
};
