/* /api/auth/config  GET   → { clientId } para o botão do Google
   /api/auth/google  POST  { credential } → valida o token do Google, cria/atualiza o usuário e abre a sessão (cookie)
   /api/auth/me      GET   → usuário logado (nome curto, foto, pontos, nível) ou usuario: null
   /api/auth/logout  POST  → encerra a sessão
   /api/auth/ranking GET   ?cidade= → quem mais contribuiu (nome curto) */
const { sql, enviar, erro, corpo } = require("../_lib");
const A = require("../_auth");

const publico = async u => { const n = await A.pontos(u.id); return { nome: A.nomeCurto(u.nome), foto: u.foto, pontos: n, nivel: A.nivel(n) }; };

module.exports = async (req, res) => {
  const acao = (req.query && req.query.acao) || "";
  try {
    if (acao === "config" && req.method === "GET") return enviar(res, 200, { ok: true, clientId: A.clientId() || null });

    if (acao === "google" && req.method === "POST") {
      const b = corpo(req);
      if (!b || typeof b.credential !== "string") return erro(res, 400, "credencial", "Faltou o token do Google.");
      let g;
      try { g = await A.verificarGoogle(b.credential); }
      catch (e) { return erro(res, e.message === "sem_client_id" ? 503 : 401, "google", e.message === "sem_client_id" ? "Login com Google ainda não configurado." : "Não consegui confirmar o login com o Google."); }
      const r = await sql().query(
        `insert into usuarios (google_sub, nome, email, foto) values ($1, $2, $3, $4)
         on conflict (google_sub) do update set nome = excluded.nome, email = excluded.email, foto = excluded.foto, ultimo_acesso = now()
         returning id, nome, email, foto, bloqueado`, [g.sub, g.nome.slice(0, 120), g.email, g.foto]);
      if (r[0].bloqueado) return erro(res, 403, "bloqueado", "Esta conta está bloqueada. Fale com a equipe.");
      A.abrirSessao(res, r[0].id);
      return enviar(res, 200, { ok: true, usuario: await publico(r[0]) });
    }

    if (acao === "me" && req.method === "GET") {
      const u = await A.usuario(req);
      return enviar(res, 200, { ok: true, usuario: u ? await publico(u) : null });
    }

    /* minhas contribuições (para o usuário ver e excluir as próprias coletas) */
    if (acao === "minhas" && req.method === "GET") {
      const u = await A.usuario(req);
      if (!u) return erro(res, 401, "login", "Entre com o Google.");
      const r = await sql().query(`select id, tipo, mercado_nome, cidade, itens, criado_em from contribuicoes where usuario_id = $1 order by id desc limit 100`, [u.id]);
      return enviar(res, 200, { ok: true, dados: r });
    }
    /* exclui UMA contribuição (e, se for de vídeo, os preços enviados nela); os pontos caem junto */
    if (acao === "excluir-contribuicao" && req.method === "POST") {
      const u = await A.usuario(req);
      if (!u) return erro(res, 401, "login", "Entre com o Google.");
      const b = corpo(req) || {};
      const r = await sql().query(`delete from contribuicoes where id = $1 and usuario_id = $2 returning id`, [parseInt(b.id, 10), u.id]);
      if (!r.length) return erro(res, 404, "contribuicao", "Contribuição não encontrada.");
      const pts = await A.pontos(u.id);
      return enviar(res, 200, { ok: true, excluida: r[0].id, pontos: pts, nivel: A.nivel(pts) });
    }
    /* exclui a PRÓPRIA conta (LGPD): apaga cadastro e contribuições; preços já enviados deixam de ter nome */
    if (acao === "excluir-conta" && req.method === "POST") {
      const u = await A.usuario(req);
      if (!u) return erro(res, 401, "login", "Entre com o Google.");
      await sql().query(`update coletas set contribuicao_id = null where usuario_id = $1`, [u.id]); /* os preços ficam, sem o nome */
      await sql().query(`delete from usuarios where id = $1`, [u.id]);
      A.fecharSessao(res);
      return enviar(res, 200, { ok: true });
    }

    if (acao === "logout" && req.method === "POST") { A.fecharSessao(res); return enviar(res, 200, { ok: true }); }

    if (acao === "ranking" && req.method === "GET") {
      const cidade = req.query.cidade ? String(req.query.cidade) : null;
      const r = await sql().query(
        `select u.nome, count(*)::int as n from contribuicoes c join usuarios u on u.id = c.usuario_id
          ${cidade ? "where lower(c.cidade) = lower($1)" : ""} group by u.id order by n desc, max(c.criado_em) desc limit 5`, cidade ? [cidade] : []);
      return enviar(res, 200, { ok: true, dados: r.map(x => ({ nome: A.nomeCurto(x.nome), pontos: x.n })) });
    }

    return erro(res, 404, "rota", "Rota não encontrada.");
  } catch (e) { return erro(res, 500, "interno", "Erro interno."); }
};
