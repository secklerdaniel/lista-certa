/* Painel interno de USUÁRIOS (header x-admin-key = env ADMIN_KEY; sem a env, fecha).
   Usuários nascem pelo login com o Google; aqui se gerencia.
   GET  /api/admin/usuarios                              → usuários com pontos e último acesso
   GET  /api/admin/usuarios?contribuicoes=<id>           → últimas contribuições do usuário
   POST { usuarioId, editar: { nome } }                  → corrige o nome exibido
   POST { usuarioId, bloqueado: true|false }             → bloqueia/desbloqueia (bloqueado não contribui nem entra)
   GET  /api/admin/usuarios?coletas=1                    → últimas 300 coletas (preços) enviadas, com o usuário
   POST { coleta: { mercado, cidade, descricao, preco, promocao? } }  → cria uma coleta (origem 'admin')
   POST { coletaId, coleta: { ... } }                    → edita uma coleta
   POST { coletaId, excluirColeta: true }                → apaga um preço da coleta
   POST { ofertas: [...] | { itens: [...] }, acrescentar?, modo?: "produto" }  → carga diária de ofertas de folheto (ver api/_ofertas.js; mora aqui por causa do limite de 12 funções)
   GET  /api/admin/usuarios?ofertas=1                    → ofertas vigentes agrupadas por mercado
   GET  /api/admin/usuarios?produtos=1                   → preços de ofertas, coletas e cupons juntos + listas de produtos (ver api/_produtos.js)
   POST { lerImagem: { imagem: "data:image/jpeg;base64,..." } }  → o Gemini lê uma imagem de ofertas e devolve os itens para REVISÃO (não grava; ver api/_gemini.js)
   POST { oferta: { acao: criar|editar|excluir, id?, produto, mercado, cidade, preco, ... } }  → CRUD de uma oferta avulsa
   POST { lista: { acao: criar|editar|excluir, id?, nome, descricao?, itens: [{ nome, termo?, qtd }] } }  → CRUD das listas de produtos
   POST { usuarioId, excluir: true }                     → APAGA a conta e as contribuições (as coletas ficam, anônimas) */
const { sql, enviar, erro, corpo, admin } = require("../_lib");
const ofertas = require("../_ofertas");
const produtos = require("../_produtos");
const gemini = require("../_gemini");

module.exports = async (req, res) => {
  if (!admin(req)) return erro(res, 401, "nao_autorizado", "Não autorizado.");
  try {
    if (req.method === "GET") {
      if (req.query && req.query.contribuicoes) {
        const r = await sql().query(`select id, tipo, mercado_nome, cidade, itens, criado_em from contribuicoes where usuario_id = $1 order by id desc limit 50`, [parseInt(req.query.contribuicoes, 10)]);
        return enviar(res, 200, { ok: true, dados: r });
      }
      if (req.query && req.query.produtos) return enviar(res, 200, Object.assign({ ok: true }, await produtos.listar()));
      if (req.query && req.query.ofertas) {
        const r = await sql().query(`select mercado, cidade, count(*)::int as itens, min(valido_ate) as ate, max(criado_em) as carregado_em from ofertas group by 1,2 order by max(criado_em) desc`);
        return enviar(res, 200, { ok: true, dados: r });
      }
      if (req.query && req.query.coletas) {
        const r = await sql().query(`select c.id, c.mercado_nome, c.cidade, c.descricao, c.gtin, c.preco, c.promocao_preco, c.origem, c.categoria, c.criado_em, u.nome as usuario
          from coletas c left join usuarios u on u.id = c.usuario_id order by c.id desc limit 1000`);
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
    if (b.lerImagem && typeof b.lerImagem === "object") {
      const img = String(b.lerImagem.imagem || ""), i = img.indexOf(";base64,"), mime = img.slice(5, i);
      if (!img.startsWith("data:image/") || i < 0 || !["image/jpeg", "image/png", "image/webp"].includes(mime) || img.length > 5.5e6) return erro(res, 400, "imagem", "Envie uma imagem JPEG, PNG ou WebP de até ~4 MB.");
      if (!process.env.GEMINI_API_KEY) return erro(res, 503, "ia_indisponivel", "GEMINI_API_KEY não está configurada no servidor.");
      try { return enviar(res, 200, { ok: true, itens: await gemini.lerImagem(mime, img.slice(i + 8)) }); }
      catch (e) { return erro(res, e.status || 502, "ia", e.message || "Não consegui ler a imagem agora."); }
    }
    if (Array.isArray(b) || b.ofertas) {
      const o = await ofertas.carregar(Array.isArray(b) ? b : b.ofertas, b.acrescentar, b.modo);
      const { status, msg, ...resto } = o;
      return status === 200 ? enviar(res, 200, { ok: true, ...resto }) : erro(res, status, "ofertas", msg, resto);
    }
    for (const k of ["oferta", "lista"]) {
      if (b[k] && typeof b[k] === "object") {
        const o = await produtos[k](b[k]);
        return o.status === 200 ? enviar(res, 200, Object.assign({ ok: true }, o, { status: undefined })) : erro(res, o.status, k, o.msg);
      }
    }
    if (b.coleta && typeof b.coleta === "object") {
      const t = (v, n) => String(v || "").replace(/\s+/g, " ").trim().slice(0, n);
      const d = (v) => { const x = parseFloat(String(v).replace(",", ".")); return x > 0 && x < 10000 ? Math.round(x * 100) / 100 : null; };
      const mercado = t(b.coleta.mercado, 120), cidade = t(b.coleta.cidade, 80), descricao = t(b.coleta.descricao, 120);
      const preco = d(b.coleta.preco), promo = b.coleta.promocao ? d(b.coleta.promocao) : null;
      if (!mercado || !cidade || !descricao || !preco) return erro(res, 400, "coleta", "Informe mercado, cidade, descrição e preço válido.");
      const IA = require("../_ia"); /* categoria em branco: a IA decide; fora da lista: erro */
      if (b.coleta.categoria && !IA.CATEGORIAS.includes(b.coleta.categoria)) return erro(res, 400, "categoria", "Categoria inválida.");
      const categoria = b.coleta.categoria || (await IA.categorizar([descricao]))[0];
      if (b.coletaId) {
        await sql().query(`update coletas set mercado_nome = $1, cidade = $2, descricao = $3, preco = $4, promocao_preco = $5, categoria = $7 where id = $6`, [mercado, cidade, descricao, preco, promo, parseInt(b.coletaId, 10) || 0, categoria]);
      } else {
        await sql().query(`insert into coletas (mercado_nome, cidade, descricao, preco, promocao_preco, origem, categoria) values ($1,$2,$3,$4,$5,'admin',$6)`, [mercado, cidade, descricao, preco, promo, categoria]);
      }
      return enviar(res, 200, { ok: true });
    }
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
