/* GET /api/v1/mercados — mercados integrados (público) */
const { sql, enviar, erro } = require("../_lib");

module.exports = async (req, res) => {
  if (req.method !== "GET") return erro(res, 405, "metodo", "Use GET.");
  try {
    const rows = await sql().query(
      `select m.id, m.nome, m.cidade, count(p.gtin)::int as produtos, max(p.atualizado_em) as ultima_atualizacao
         from mercados m left join precos p on p.mercado_id = m.id and p.ambiente = 'producao'
        where m.ativo group by m.id order by m.cidade, m.nome`);
    enviar(res, 200, { ok: true, dados: rows.map(r => ({ id: r.id, nome: r.nome, cidade: r.cidade, produtos: r.produtos, ultimaAtualizacao: r.ultima_atualizacao && new Date(r.ultima_atualizacao).toISOString() })) });
  } catch (e) { erro(res, 500, "interno", "Erro interno."); }
};
