/* PORTAL DO MERCADO — o dono (login Google) gerencia o PRÓPRIO mercado. Tudo exige sessão e checa se o usuário é membro.
   GET  /api/mercado/meus                         → meus mercados (com contagens e chaves)
   POST /api/mercado/criar                        { nome, cidade, email?, cnpj? } → cria, torna você dono e devolve as chaves UMA vez
   POST /api/mercado/editar                       { id, nome, cidade, cnpj, email }
   POST /api/mercado/chave                        { id, nova: true } | { id, revogar: <id da chave> }
   POST /api/mercado/ativo                        { id, ativo: true|false }   (pausar/retomar)
   GET  /api/mercado/precos?id=&ambiente=&q=      → preços do mercado
   POST /api/mercado/precos                       { id, ambiente: "teste"|"producao", itens: [...] }  (mesmo formato de /api/v1/precos)
   POST /api/mercado/excluir-preco                { id, gtin, ambiente }
   POST /api/mercado/excluir                      { id, confirmar: "<nome do mercado>" } → apaga mercado, chaves e preços */
const { sql, sha256, enviar, erro, corpo, crypto } = require("../_lib");
const A = require("../_auth");
const { enviarPrecos } = require("../v1/precos");
const { cnpjValido } = require("../v1/cadastro");

const MAX_MERCADOS = 3;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const norm = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

async function chave(mercadoId, amb) {
  const k = `lc_${amb === "teste" ? "test" : "live"}_${crypto.randomBytes(16).toString("hex")}`;
  await sql().query(`insert into chaves_api (mercado_id, prefixo, hash, ambiente) values ($1, $2, $3, $4)`, [mercadoId, k.slice(0, 12), sha256(k), amb]);
  return k;
}
const par = async id => ({ teste: await chave(id, "teste"), producao: await chave(id, "producao") });

/* usuário logado e (se id) membro do mercado; devolve null depois de já ter respondido o erro */
async function acesso(req, res, id) {
  let usr = null;
  try { usr = await A.usuario(req); } catch (e) { /* sem login */ }
  if (!usr) { erro(res, 401, "login", "Entre com o Google para acessar o portal do mercado."); return null; }
  if (id == null) return { usr };
  const r = await sql().query(
    `select m.* from mercados m join mercado_membros mm on mm.mercado_id = m.id where m.id = $1 and mm.usuario_id = $2`, [parseInt(id, 10) || 0, usr.id]);
  if (!r.length) { erro(res, 403, "sem_acesso", "Você não é dono deste mercado."); return null; }
  return { usr, m: r[0] };
}

module.exports = async (req, res) => {
  const acao = (req.query && req.query.acao) || "";
  try {
    if (acao === "meus" && req.method === "GET") {
      const a = await acesso(req, res); if (!a) return;
      const r = await sql().query(
        `select m.id, m.nome, m.cnpj, m.cidade, m.email, m.ativo, m.criado_em,
                (select count(*)::int from precos p where p.mercado_id = m.id and p.ambiente = 'producao') as produtos,
                (select count(*)::int from precos p where p.mercado_id = m.id and p.ambiente = 'teste') as produtos_teste,
                (select max(p.atualizado_em) from precos p where p.mercado_id = m.id and p.ambiente = 'producao') as ultima_atualizacao,
                (select coalesce(json_agg(json_build_object('id', c.id, 'prefixo', c.prefixo, 'ambiente', c.ambiente, 'revogada', c.revogada_em is not null, 'criada_em', c.criada_em) order by c.id), '[]'::json)
                   from chaves_api c where c.mercado_id = m.id) as chaves
           from mercados m join mercado_membros mm on mm.mercado_id = m.id where mm.usuario_id = $1 order by m.id desc`, [a.usr.id]);
      return enviar(res, 200, { ok: true, usuarioEmail: a.usr.email, dados: r });
    }

    if (acao === "criar" && req.method === "POST") {
      const a = await acesso(req, res); if (!a) return;
      const b = corpo(req) || {};
      const nome = String(b.nome || "").replace(/\s+/g, " ").trim(), cidade = String(b.cidade || "").replace(/\s+/g, " ").trim();
      const email = String(b.email || a.usr.email || "").trim().toLowerCase(), cnpj = b.cnpj ? String(b.cnpj).replace(/\D/g, "") : null;
      if (nome.length < 3 || nome.length > 120) return erro(res, 400, "nome", "Informe o nome do mercado (3 a 120 caracteres).");
      if (cidade.length < 2 || cidade.length > 80) return erro(res, 400, "cidade", "Informe a cidade.");
      if (!EMAIL.test(email) || email.length > 160) return erro(res, 400, "email", "Informe um e-mail de contato válido.");
      if (cnpj && !cnpjValido(cnpj)) return erro(res, 400, "cnpj", "CNPJ inválido. Confira os 14 dígitos ou deixe em branco.");
      const qtd = await sql().query(`select count(*)::int as n from mercado_membros where usuario_id = $1`, [a.usr.id]);
      if (qtd[0].n >= MAX_MERCADOS) return erro(res, 400, "limite", `Cada conta pode ter até ${MAX_MERCADOS} mercados.`);
      let m;
      try {
        m = await sql().query(`insert into mercados (nome, cnpj, cidade, email, origem) values ($1, $2, $3, $4, 'portal') returning id, nome, cidade`, [nome.slice(0, 120), cnpj, cidade.slice(0, 80), email]);
      } catch (e) {
        if (/mercados_cnpj_uq|duplicate key/i.test(String(e.message))) return erro(res, 409, "cnpj", "Esse CNPJ já está cadastrado. Fale com a equipe para assumir a conta do mercado.");
        throw e;
      }
      await sql().query(`insert into mercado_membros (mercado_id, usuario_id, papel) values ($1, $2, 'dono')`, [m[0].id, a.usr.id]);
      return enviar(res, 201, { ok: true, mercado: m[0], chaves: await par(m[0].id), aviso: "Guarde as chaves agora: elas não são mostradas de novo. Você pode gerar novas a qualquer momento aqui no portal." });
    }

    if (acao === "editar" && req.method === "POST") {
      const b = corpo(req) || {}; const a = await acesso(req, res, b.id); if (!a) return;
      const nome = String(b.nome || "").replace(/\s+/g, " ").trim(), cidade = String(b.cidade || "").replace(/\s+/g, " ").trim();
      const cnpj = b.cnpj ? String(b.cnpj).replace(/\D/g, "") : null, email = b.email ? String(b.email).trim().toLowerCase() : null;
      if (nome.length < 3 || nome.length > 120) return erro(res, 400, "nome", "Nome do mercado: 3 a 120 caracteres.");
      if (cidade.length < 2 || cidade.length > 80) return erro(res, 400, "cidade", "Informe a cidade.");
      if (cnpj && !cnpjValido(cnpj)) return erro(res, 400, "cnpj", "CNPJ inválido.");
      if (email && !EMAIL.test(email)) return erro(res, 400, "email", "E-mail inválido.");
      try { await sql().query(`update mercados set nome = $1, cidade = $2, cnpj = $3, email = $4 where id = $5`, [nome, cidade, cnpj, email, a.m.id]); }
      catch (e) { if (/mercados_cnpj_uq|duplicate key/i.test(String(e.message))) return erro(res, 409, "cnpj", "Já existe outro mercado com esse CNPJ."); throw e; }
      return enviar(res, 200, { ok: true });
    }

    if (acao === "chave" && req.method === "POST") {
      const b = corpo(req) || {}; const a = await acesso(req, res, b.id); if (!a) return;
      if (b.nova) return enviar(res, 201, { ok: true, chaves: await par(a.m.id), aviso: "Guarde agora: as chaves não são mostradas de novo." });
      if (b.revogar) {
        const r = await sql().query(`update chaves_api set revogada_em = now() where id = $1 and mercado_id = $2 and revogada_em is null returning id`, [parseInt(b.revogar, 10), a.m.id]);
        return r.length ? enviar(res, 200, { ok: true }) : erro(res, 404, "chave", "Chave não encontrada ou já revogada.");
      }
      return erro(res, 400, "acao", "Informe nova ou revogar.");
    }

    if (acao === "ativo" && req.method === "POST") {
      const b = corpo(req) || {}; const a = await acesso(req, res, b.id); if (!a) return;
      if (typeof b.ativo !== "boolean") return erro(res, 400, "ativo", "Informe ativo true ou false.");
      await sql().query(`update mercados set ativo = $1 where id = $2`, [b.ativo, a.m.id]);
      return enviar(res, 200, { ok: true, ativo: b.ativo });
    }

    if (acao === "precos" && req.method === "GET") {
      const a = await acesso(req, res, req.query.id); if (!a) return;
      const amb = req.query.ambiente === "teste" ? "teste" : "producao", ps = [a.m.id, amb]; let w = "";
      if (req.query.q) { ps.push("%" + String(req.query.q).replace(/[%_\\]/g, "") + "%"); w = ` and (descricao ilike $3 or gtin like $3)`; }
      const r = await sql().query(
        `select gtin, descricao, unidade, preco::float as preco, promocao_preco::float as promocao_preco, promocao_ate, atualizado_em
           from precos where mercado_id = $1 and ambiente = $2${w} order by descricao nulls last, gtin limit 500`, ps);
      return enviar(res, 200, { ok: true, ambiente: amb, dados: r });
    }

    if (acao === "precos" && req.method === "POST") {
      const b = corpo(req) || {}; const a = await acesso(req, res, b.id); if (!a) return;
      if (!a.m.ativo) return erro(res, 403, "pausado", "Seu mercado está pausado. Retome-o para enviar preços.");
      req.body = { itens: b.itens }; /* mesmo formato e mesmas validações de /api/v1/precos */
      return await enviarPrecos(req, res, { id: a.m.id, nome: a.m.nome, ambiente: b.ambiente === "teste" ? "teste" : "producao" });
    }

    if (acao === "excluir-preco" && req.method === "POST") {
      const b = corpo(req) || {}; const a = await acesso(req, res, b.id); if (!a) return;
      const r = await sql().query(`delete from precos where mercado_id = $1 and gtin = $2 and ambiente = $3 returning gtin`, [a.m.id, String(b.gtin || ""), b.ambiente === "teste" ? "teste" : "producao"]);
      return r.length ? enviar(res, 200, { ok: true }) : erro(res, 404, "preco", "Preço não encontrado.");
    }

    if (acao === "excluir" && req.method === "POST") {
      const b = corpo(req) || {}; const a = await acesso(req, res, b.id); if (!a) return;
      if (norm(b.confirmar) !== norm(a.m.nome)) return erro(res, 400, "confirmacao", "Digite o nome do mercado para confirmar a exclusão.");
      await sql().query(`delete from precos_historico where mercado_id = $1`, [a.m.id]);
      await sql().query(`delete from mercados where id = $1`, [a.m.id]); /* chaves, preços e vínculos saem junto */
      return enviar(res, 200, { ok: true });
    }

    return erro(res, 404, "rota", "Rota não encontrada.");
  } catch (e) { return erro(res, 500, "interno", "Erro interno."); }
};
