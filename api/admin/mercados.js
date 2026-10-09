/* Painel interno (header x-admin-key = env ADMIN_KEY; sem a env, fecha).
   GET  /api/admin/mercados                                  → mercados, contagem de produtos e chaves (só prefixos)
   POST { nome, cnpj?, cidade, ibge? }                       → cria o mercado e devolve as chaves UMA vez
   POST { mercadoId, novaChave: true }                       → gera um novo par de chaves (as anteriores continuam válidas)
   POST { mercadoId, revogarChave: <id da chave> }           → revoga uma chave
   POST { mercadoId, ativo: true|false }                     → ativa/desativa o mercado (some das consultas públicas) */
const { sql, sha256, enviar, erro, corpo, admin, crypto } = require("../_lib");

const nova = amb => `lc_${amb === "teste" ? "test" : "live"}_${crypto.randomBytes(16).toString("hex")}`;
async function guardar(mercadoId, amb) {
  const k = nova(amb);
  await sql().query(`insert into chaves_api (mercado_id, prefixo, hash, ambiente) values ($1, $2, $3, $4)`, [mercadoId, k.slice(0, 12), sha256(k), amb]);
  return k;
}
const par = async id => ({ teste: await guardar(id, "teste"), producao: await guardar(id, "producao") });
const AVISO = "Guarde agora: as chaves não são mostradas de novo.";

module.exports = async (req, res) => {
  if (!admin(req)) return erro(res, 401, "nao_autorizado", "Não autorizado.");
  try {
    if (req.method === "GET") {
      const r = await sql().query(
        `select m.id, m.nome, m.cnpj, m.cidade, m.ativo, m.criado_em,
                (select count(*)::int from precos p where p.mercado_id = m.id and p.ambiente = 'producao') as produtos,
                (select count(*)::int from precos p where p.mercado_id = m.id and p.ambiente = 'teste') as produtos_teste,
                (select max(p.atualizado_em) from precos p where p.mercado_id = m.id and p.ambiente = 'producao') as ultima_atualizacao,
                (select coalesce(json_agg(json_build_object('id', c.id, 'prefixo', c.prefixo, 'ambiente', c.ambiente, 'revogada', c.revogada_em is not null, 'criada_em', c.criada_em) order by c.id), '[]'::json)
                   from chaves_api c where c.mercado_id = m.id) as chaves
           from mercados m order by m.id desc`);
      return enviar(res, 200, { ok: true, dados: r });
    }
    if (req.method !== "POST") return erro(res, 405, "metodo", "Use GET ou POST.");
    const b = corpo(req) || {};
    if (b.mercadoId) {
      const id = parseInt(b.mercadoId, 10);
      const ex = await sql().query(`select id from mercados where id = $1`, [id]);
      if (!ex.length) return erro(res, 404, "mercado", "Mercado não existe.");
      if (b.novaChave) return enviar(res, 201, { ok: true, mercadoId: id, chaves: await par(id), aviso: AVISO });
      if (b.revogarChave) {
        const r = await sql().query(`update chaves_api set revogada_em = now() where id = $1 and mercado_id = $2 and revogada_em is null returning id`, [parseInt(b.revogarChave, 10), id]);
        return r.length ? enviar(res, 200, { ok: true, revogada: r[0].id }) : erro(res, 404, "chave", "Chave não encontrada ou já revogada.");
      }
      if (typeof b.ativo === "boolean") {
        await sql().query(`update mercados set ativo = $1 where id = $2`, [b.ativo, id]);
        return enviar(res, 200, { ok: true, mercadoId: id, ativo: b.ativo });
      }
      return erro(res, 400, "acao", "Nada a fazer: informe novaChave, revogarChave ou ativo.");
    }
    if (!b.nome || !b.cidade) return erro(res, 400, "campos", "Informe nome e cidade.");
    const m = await sql().query(`insert into mercados (nome, cnpj, cidade, ibge) values ($1, $2, $3, $4) returning id, nome, cidade`,
      [String(b.nome).slice(0, 120), b.cnpj ? String(b.cnpj).replace(/\D/g, "") : null, String(b.cidade).slice(0, 80), b.ibge || null]);
    enviar(res, 201, { ok: true, mercado: m[0], chaves: await par(m[0].id), aviso: AVISO });
  } catch (e) { erro(res, 500, "interno", "Erro interno."); }
};
