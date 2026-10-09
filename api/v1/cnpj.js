/* GET /api/v1/cnpj?cnpj=00000000000000 → dados públicos da Receita para preencher o cadastro (nome, cidade, situação).
   Público, com limite por IP. Só dados de empresa; nada é guardado. */
const { sql, sha256, enviar, erro } = require("../_lib");
const { consultar } = require("../_cnpj");
const { cnpjValido } = require("./cadastro");

module.exports = async (req, res) => {
  if (req.method !== "GET") return erro(res, 405, "metodo", "Use GET.");
  const cnpj = String((req.query && req.query.cnpj) || "").replace(/\D/g, "");
  if (!cnpjValido(cnpj)) return erro(res, 400, "cnpj", "CNPJ inválido.");
  try {
    const ip = sha256(String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "?").split(",")[0].trim() + "|lc");
    const u = await sql().query(`select count(*)::int as n from uso_publico where ip_hash = $1 and tipo = 'cnpj' and em > now() - interval '1 hour'`, [ip]);
    if (u[0].n >= 40) return erro(res, 429, "limite", "Muitas consultas. Tente de novo mais tarde.");
    await sql().query(`insert into uso_publico (ip_hash, tipo) values ($1, 'cnpj')`, [ip]);
    const c = await consultar(cnpj);
    if (!c) return erro(res, 502, "consulta", "Não consegui consultar a Receita agora. Preencha manualmente.");
    if (!c.encontrado) return enviar(res, 200, { ok: true, encontrado: false });
    enviar(res, 200, { ok: true, ...c });
  } catch (e) { erro(res, 500, "interno", "Erro interno."); }
};
