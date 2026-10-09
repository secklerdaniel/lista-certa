/* Painel interno (header x-admin-key = env ADMIN_KEY; sem a env, fecha).
   POST /api/admin/mercados  { nome, cnpj?, cidade, ibge? }  → cria o mercado e devolve as chaves UMA vez
   POST /api/admin/mercados  { mercadoId, novaChave: true } → gera nova chave (a anterior continua válida até revogar)
   GET  /api/admin/mercados  → lista mercados e prefixos das chaves */
const { sql, sha256, enviar, erro, corpo, admin, crypto } = require("../_lib");

const nova = amb => `lc_${amb === "teste" ? "test" : "live"}_${crypto.randomBytes(16).toString("hex")}`;
async function guardar(mercadoId, amb) {
  const k = nova(amb);
  await sql().query(`insert into chaves_api (mercado_id, prefixo, hash, ambiente) values ($1, $2, $3, $4)`, [mercadoId, k.slice(0, 12), sha256(k), amb]);
  return k;
}

module.exports = async (req, res) => {
  if (!admin(req)) return erro(res, 401, "nao_autorizado", "Não autorizado.");
  try {
    if (req.method === "GET") {
      const r = await sql().query(
        `select m.id, m.nome, m.cnpj, m.cidade, m.ativo, m.criado_em,
                (select json_agg(json_build_object('prefixo', c.prefixo, 'ambiente', c.ambiente, 'revogada', c.revogada_em is not null))
                   from chaves_api c where c.mercado_id = m.id) as chaves
           from mercados m order by m.id`);
      return enviar(res, 200, { ok: true, dados: r });
    }
    if (req.method !== "POST") return erro(res, 405, "metodo", "Use GET ou POST.");
    const b = corpo(req) || {};
    if (b.mercadoId && b.novaChave) {
      const ok = await sql().query(`select id from mercados where id = $1`, [parseInt(b.mercadoId, 10)]);
      if (!ok.length) return erro(res, 404, "mercado", "Mercado não existe.");
      return enviar(res, 201, { ok: true, mercadoId: ok[0].id, chaves: { teste: await guardar(ok[0].id, "teste"), producao: await guardar(ok[0].id, "producao") }, aviso: "Guarde agora: as chaves não são mostradas de novo." });
    }
    if (!b.nome || !b.cidade) return erro(res, 400, "campos", "Informe nome e cidade.");
    const m = await sql().query(`insert into mercados (nome, cnpj, cidade, ibge) values ($1, $2, $3, $4) returning id, nome, cidade`,
      [String(b.nome).slice(0, 120), b.cnpj ? String(b.cnpj).replace(/\D/g, "") : null, String(b.cidade).slice(0, 80), b.ibge || null]);
    enviar(res, 201, { ok: true, mercado: m[0], chaves: { teste: await guardar(m[0].id, "teste"), producao: await guardar(m[0].id, "producao") }, aviso: "Guarde agora: as chaves não são mostradas de novo." });
  } catch (e) { erro(res, 500, "interno", "Erro interno."); }
};
