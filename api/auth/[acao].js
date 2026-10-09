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
         returning id, nome, email, foto`, [g.sub, g.nome.slice(0, 120), g.email, g.foto]);
      A.abrirSessao(res, r[0].id);
      return enviar(res, 200, { ok: true, usuario: await publico(r[0]) });
    }

    if (acao === "me" && req.method === "GET") {
      const u = await A.usuario(req);
      return enviar(res, 200, { ok: true, usuario: u ? await publico(u) : null });
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
