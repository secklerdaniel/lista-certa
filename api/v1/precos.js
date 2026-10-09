/* POST /api/v1/precos  — o mercado envia preços (em lote, por GTIN)   [chave do mercado]
   GET  /api/v1/precos  — consulta pública de preços (ou os de teste, com chave de teste) */
const { sql, enviar, erro, corpo, gtinValido, autenticar } = require("../_lib");
const { resolverPendentes } = require("../_ia");

const MAX_LOTE = 1000;
const num = v => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && /^\d+([.,]\d{1,4})?$/.test(v) ? parseFloat(v.replace(",", ".")) : NaN);
const dinheiro = v => { const n = num(v); return n > 0 && n < 100000 ? Math.round(n * 100) / 100 : NaN; };
const data = v => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(v)) ? v : null);

async function enviarPrecos(req, res, m) {
  const b = corpo(req);
  if (!b || !Array.isArray(b.itens)) return erro(res, 400, "corpo_invalido", 'Envie um JSON com o campo "itens" (lista).');
  if (!b.itens.length) return erro(res, 400, "lote_vazio", "A lista de itens está vazia.");
  if (b.itens.length > MAX_LOTE) return erro(res, 413, "lote_grande", `No máximo ${MAX_LOTE} itens por requisição.`);

  const rejeitados = [], ultimo = new Map(), agora = Date.now();
  b.itens.forEach((it, indice) => {
    const rej = (codigo, msg) => rejeitados.push({ indice, gtin: it && it.gtin, erro: codigo, msg });
    if (!it || typeof it !== "object") return rej("item_invalido", "Item não é um objeto.");
    if (!gtinValido(it.gtin)) return rej("gtin_invalido", "GTIN inválido (8, 12, 13 ou 14 dígitos, com dígito verificador). Envie como texto.");
    const preco = dinheiro(it.preco);
    if (isNaN(preco)) return rej("preco_invalido", "Preço deve ser um número maior que zero.");
    let pp = null, pa = null;
    if (it.promocao != null) {
      pp = dinheiro(it.promocao.preco); pa = data(it.promocao.ate);
      if (isNaN(pp) || pp >= preco) return rej("promocao_invalida", "Preço promocional deve ser menor que o preço.");
      if (!pa) return rej("promocao_invalida", 'Informe "ate" no formato AAAA-MM-DD.');
    }
    let em = null;
    if (it.atualizadoEm != null) {
      const t = Date.parse(it.atualizadoEm);
      if (isNaN(t) || t > agora + 5 * 60e3) return rej("data_invalida", "atualizadoEm deve ser data/hora ISO 8601 e não pode estar no futuro.");
      em = new Date(t).toISOString();
    }
    ultimo.set(it.gtin, [
      it.gtin, typeof it.descricao === "string" ? it.descricao.slice(0, 120) : null,
      typeof it.unidade === "string" ? it.unidade.slice(0, 6).toUpperCase() : null, preco, pp, pa, em]);
  });

  const L = [...ultimo.values()];
  let r = { atualizados: 0, historico: 0 };
  if (L.length) {
    const col = i => L.map(x => x[i]);
    const q = await sql().query(
      `with entrada as (
         select * from unnest($1::text[], $2::text[], $3::text[], $4::numeric[], $5::numeric[], $6::date[], $7::timestamptz[])
           as t(gtin, descricao, unidade, preco, promo_preco, promo_ate, atualizado_em)),
       antigo as (select p.gtin, p.preco from precos p join entrada e on e.gtin = p.gtin where p.mercado_id = $8 and p.ambiente = $9),
       up as (
         insert into precos (mercado_id, ambiente, gtin, descricao, unidade, preco, promocao_preco, promocao_ate, atualizado_em, origem)
         select $8, $9, gtin, descricao, unidade, preco, promo_preco, promo_ate, coalesce(atualizado_em, now()), 'api' from entrada
         on conflict (mercado_id, ambiente, gtin) do update set
           descricao = coalesce(excluded.descricao, precos.descricao), unidade = coalesce(excluded.unidade, precos.unidade),
           preco = excluded.preco, promocao_preco = excluded.promocao_preco, promocao_ate = excluded.promocao_ate,
           atualizado_em = excluded.atualizado_em, recebido_em = now()
         where precos.atualizado_em <= excluded.atualizado_em
         returning gtin, preco),
       hist as (
         insert into precos_historico (mercado_id, ambiente, gtin, preco, em)
         select $8, $9, up.gtin, up.preco, now() from up left join antigo a on a.gtin = up.gtin
         where a.preco is distinct from up.preco returning 1)
       select (select count(*) from up)::int as atualizados, (select count(*) from hist)::int as historico`,
      [col(0), col(1), col(2), col(3), col(4), col(5), col(6), m.id, m.ambiente]);
    r = q[0];
  }
  const aceitos = L.length;
  /* IA: normaliza o nome dos GTINs que ainda não conhecemos (falha nunca derruba o envio) */
  let ia = { resolvidos: 0 };
  if (m.ambiente === "producao") { try { ia = await resolverPendentes(); } catch (e) { ia = { resolvidos: 0, erro: true }; } }
  enviar(res, 200, {
    produtosNormalizadosPorIA: ia.resolvidos,
    ok: true, ambiente: m.ambiente === "teste" ? "teste (homologação)" : "producao", mercado: m.nome,
    recebidos: b.itens.length, aceitos, atualizados: r.atualizados, ignoradosPorDataAntiga: aceitos - r.atualizados,
    mudancasDePreco: r.historico, rejeitados,
  });
}

async function consultar(req, res, m) {
  const q = req.query || {};
  const gtin = q.gtin ? String(q.gtin) : null, busca = q.q ? String(q.q).trim() : null;
  if (!gtin && !busca && !q.cidade && !q.mercado) return erro(res, 400, "criterio", 'Informe "gtin", "q" (palavras da descrição), "cidade" ou "mercado".');
  if (gtin && !gtinValido(gtin)) return erro(res, 400, "gtin_invalido", "GTIN inválido.");
  if (busca && busca.length < 3) return erro(res, 400, "q_curto", '"q" precisa de ao menos 3 caracteres.');
  const limite = Math.min(Math.max(parseInt(q.limite, 10) || 50, 1), 1000);
  const ambiente = m && m.ambiente === "teste" ? "teste" : "producao";
  const ps = [ambiente]; const w = ["p.ambiente = $1"];
  if (m && ambiente === "teste") { ps.push(m.id); w.push(`p.mercado_id = $${ps.length}`); }
  if (gtin) { ps.push(gtin); w.push(`p.gtin = $${ps.length}`); }
  if (busca) for (const t of busca.split(/\s+/).filter(x => x.length > 1)) { ps.push("%" + t.replace(/[%_\\]/g, "") + "%"); w.push(`p.descricao ilike $${ps.length}`); }
  if (q.cidade) { ps.push(String(q.cidade)); w.push(`lower(m.cidade) = lower($${ps.length})`); }
  if (q.mercado) { const id = parseInt(q.mercado, 10); if (id) { ps.push(id); w.push(`p.mercado_id = $${ps.length}`); } }
  ps.push(limite);
  const rows = await sql().query(
    `select p.gtin, p.descricao, p.unidade, p.preco::float as preco, p.promocao_preco::float as promo_preco, p.promocao_ate,
            p.atualizado_em, m.id as mercado_id, m.nome as mercado, m.cidade,
            pr.nome as pr_nome, pr.marca as pr_marca, pr.quantidade::float as pr_qtd, pr.unidade as pr_un, pr.categoria as pr_cat, pr.catalogo_id as pr_cat_id
       from precos p join mercados m on m.id = p.mercado_id left join produtos pr on pr.gtin = p.gtin
      where ${w.join(" and ")} and m.ativo
      order by coalesce(case when p.promocao_ate >= current_date then p.promocao_preco end, p.preco) asc, p.atualizado_em desc
      limit $${ps.length}`, ps);
  enviar(res, 200, {
    ok: true, ambiente, total: rows.length,
    dados: rows.map(r => ({
      gtin: r.gtin, descricao: r.descricao, unidade: r.unidade, preco: r.preco,
      promocao: r.promo_preco && r.promocao_ate && new Date(r.promocao_ate) >= new Date(new Date().toDateString())
        ? { preco: r.promo_preco, ate: new Date(r.promocao_ate).toISOString().slice(0, 10) } : null,
      atualizadoEm: new Date(r.atualizado_em).toISOString(),
      mercado: { id: r.mercado_id, nome: r.mercado, cidade: r.cidade },
      produto: r.pr_nome ? { nome: r.pr_nome, marca: r.pr_marca, quantidade: r.pr_qtd, unidade: r.pr_un, categoria: r.pr_cat, catalogoId: r.pr_cat_id } : null,
    })),
  });
}

module.exports = async (req, res) => {
  try {
    if (req.method === "OPTIONS") { res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS"); res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, X-API-Key"); res.statusCode = 204; return res.end(); }
    const m = await autenticar(req);
    if (req.method === "POST") {
      if (!m) return erro(res, 401, "nao_autorizado", "Chave de API ausente ou inválida. Use Authorization: Bearer <chave>.");
      return await enviarPrecos(req, res, m);
    }
    if (req.method === "GET") return await consultar(req, res, m);
    return erro(res, 405, "metodo", "Use GET ou POST.");
  } catch (e) {
    return erro(res, 500, "interno", "Erro interno. Tente de novo em instantes.");
  }
};

module.exports.enviarPrecos = enviarPrecos; /* usado também pelo portal do mercado (/api/mercado) */
