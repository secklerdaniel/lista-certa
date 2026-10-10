/* Painel interno de USUÁRIOS (header x-admin-key = env ADMIN_KEY; sem a env, fecha).
   Usuários nascem pelo login com o Google; aqui se gerencia.
   GET  /api/admin/usuarios                              → usuários com pontos e último acesso
   GET  /api/admin/usuarios?contribuicoes=<id>           → últimas contribuições do usuário
   POST { usuarioId, editar: { nome } }                  → corrige o nome exibido
   POST { usuarioId, bloqueado: true|false }             → bloqueia/desbloqueia (bloqueado não contribui nem entra)
   GET  /api/admin/usuarios?coletas=1                    → últimas 300 coletas (preços) enviadas, com o usuário
   POST { coletaId, excluirColeta: true }                → apaga um preço da coleta
   POST { usuarioId, excluir: true }                     → APAGA a conta e as contribuições (as coletas ficam, anônimas) */
const { sql, enviar, erro, corpo, admin } = require("../_lib");

module.exports = async (req, res) => {
  if (!admin(req)) return erro(res, 401, "nao_autorizado", "Não autorizado.");
  try {
    if (req.method === "GET") {
      if (req.query && req.query.contribuicoes) {
        const r = await sql().query(`select id, tipo, mercado_nome, cidade, itens, criado_em from contribuicoes where usuario_id = $1 order by id desc limit 50`, [parseInt(req.query.contribuicoes, 10)]);
        return enviar(res, 200, { ok: true, dados: r });
      }
      if (req.query && req.query.coletas) {
        const r = await sql().query(`select c.id, c.mercado_nome, c.cidade, c.descricao, c.gtin, c.preco, c.promocao_preco, c.origem, c.criado_em, u.nome as usuario
          from coletas c left join usuarios u on u.id = c.usuario_id order by c.id desc limit 300`);
        return enviar(res, 200, { ok: true, dados: r });
      }
      const r = await sql().query(
        `select u.id, u.nome, u.email, u.foto, u.bloqueado, u.criado_em, u.ultimo_acesso,
                (select count(*)::int from contribuicoes c where c.usuario_id = u.id) as pontos,
                (select count(*)::int from coletas c where c.usuario_id = u.id) as precos_enviados
           from usuarios u order by u.ultimo_acesso desc`);
      return enviar(res, 200, { ok: true, dados: r });
    }
    if (req.method !== "POST") return erro(res, 405, "metodo", "Use GET ou POST.");
    const b = corpo(req) || {};
    if (b.excluirColeta === true) {
      await sql().query(`delete from coletas where id = $1`, [parseInt(b.coletaId, 10) || 0]);
      return enviar(res, 200, { ok: true });
    }
    const id = parseInt(b.usuarioId, 10);
    if (!id) return erro(res, 400, "usuario", "Informe usuarioId.");
    const ex = await sql().query(`select id from usuarios where id = $1`, [id]);
    if (!ex.length) return erro(res, 404, "usuario", "Usuário não existe.");
    if (b.editar && typeof b.editar === "object") {
      const nome = String(b.editar.nome || "").replace(/\s+/g, " ").trim();
      if (nome.length < 2 || nome.length > 120) return erro(res, 400, "nome", "Nome: 2 a 120 caracteres.");
      await sql().query(`update usuarios set nome = $1 where id = $2`, [nome, id]);
      return enviar(res, 200, { ok: true, usuarioId: id });
    }
    if (typeof b.bloqueado === "boolean") {
      await sql().query(`update usuarios set bloqueado = $1 where id = $2`, [b.bloqueado, id]);
      return enviar(res, 200, { ok: true, usuarioId: id, bloqueado: b.bloqueado });
    }
    if (b.excluir === true) {
      await sql().query(`update coletas set contribuicao_id = null where usuario_id = $1`, [id]); /* os preços ficam, sem o nome */
      await sql().query(`update precos_cupom set contribuicao_id = null where contribuicao_id in (select id from contribuicoes where usuario_id = $1)`, [id]);
      await sql().query(`delete from usuarios where id = $1`, [id]); /* contribuicoes saem junto; coletas.usuario_id vira null */
      return enviar(res, 200, { ok: true, excluido: id });
    }
    return erro(res, 400, "acao", "Nada a fazer: informe editar, bloqueado ou excluir.");
  } catch (e) { erro(res, 500, "interno", "Erro interno."); }
};
