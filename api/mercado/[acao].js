/* PORTAL DO MERCADO — conta PRÓPRIA do mercado (e-mail + senha), separada dos usuários do app. Tudo checa a posse do mercado.
   POST /api/mercado/registrar     { email, senha, nome, cidade, cnpj? } → cria a conta e o 1º mercado, abre a sessão, devolve as chaves UMA vez
   POST /api/mercado/entrar        { email, senha }
   POST /api/mercado/sair
   GET  /api/mercado/eu            → { conta: { email } | null }
   POST /api/mercado/senha         { atual, nova }
   POST /api/mercado/excluir-conta { senha } → apaga a conta E todos os mercados dela
   GET  /api/mercado/meus
   POST /api/mercado/criar         { nome, cidade, email?, cnpj? } → outro mercado na mesma conta (até 3)
   POST /api/mercado/vincular      { chave } → traz para a conta um mercado já cadastrado (prova: chave de PRODUÇÃO)
   POST /api/mercado/editar        { id, nome, cidade, cnpj, email }
   POST /api/mercado/chave         { id, nova: true } | { id, revogar: <id da chave> }
   POST /api/mercado/ativo         { id, ativo: true|false }
   GET  /api/mercado/precos?id=&ambiente=&q=
   POST /api/mercado/precos        { id, ambiente: "teste"|"producao", itens: [...] }   (mesmo formato de /api/v1/precos)
   POST /api/mercado/excluir-preco { id, gtin, ambiente }
   POST /api/mercado/excluir       { id, confirmar: "<nome do mercado>" } */
const { sql, sha256, enviar, erro, corpo, crypto } = require("../_lib");
const C = require("../_conta");
const { enviarPrecos } = require("../v1/precos");
const { cnpjValido } = require("../v1/cadastro");
const { verificarAtivo } = require("../_cnpj");

const MAX_MERCADOS = 3;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const norm = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const ipHash = req => sha256(String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "?").split(",")[0].trim() + "|lc");

async function chave(mercadoId, amb) {
  const k = `lc_${amb === "teste" ? "test" : "live"}_${crypto.randomBytes(16).toString("hex")}`;
  await sql().query(`insert into chaves_api (mercado_id, prefixo, hash, ambiente) values ($1, $2, $3, $4)`, [mercadoId, k.slice(0, 12), sha256(k), amb]);
  return k;
}
const par = async id => ({ teste: await chave(id, "teste"), producao: await chave(id, "producao") });

/* limite por IP (tabela uso_publico): devolve true se ainda pode */
async function dentroDoLimite(req, tipo, max, intervalo) {
  const ip = ipHash(req);
  const r = await sql().query(`select count(*)::int as n from uso_publico where ip_hash = $1 and tipo = $2 and em > now() - interval '${intervalo}'`, [ip, tipo]);
  if (r[0].n >= max) return false;
  await sql().query(`insert into uso_publico (ip_hash, tipo) values ($1, $2)`, [ip, tipo]);
  return true;
}

/* conta logada e (se id) dona do mercado; devolve null depois de já ter respondido o erro */
async function acesso(req, res, id) {
  let c = null;
  try { c = await C.conta(req); } catch (e) { /* sem login */ }
  if (!c) { erro(res, 401, "login", "Entre na conta do mercado."); return null; }
  if (id == null) return { c };
  const r = await sql().query(`select * from mercados where id = $1 and conta_id = $2`, [parseInt(id, 10) || 0, c.id]);
  if (!r.length) { erro(res, 403, "sem_acesso", "Este mercado não pertence à sua conta."); return null; }
  return { c, m: r[0] };
}

/* a Receita só barra quando CONFIRMA que o CNPJ não está ativo; consulta fora do ar não bloqueia */
async function cnpjAtivo(v, res) {
  if (!v.cnpj) return true;
  const inativo = await verificarAtivo(v.cnpj);
  if (inativo) { erro(res, 400, "cnpj_inativo", inativo); return false; }
  return true;
}
function validarMercado(b, res, emailPadrao) {
  const nome = String(b.nome || "").replace(/\s+/g, " ").trim(), cidade = String(b.cidade || "").replace(/\s+/g, " ").trim();
  const email = String(b.email || emailPadrao || "").trim().toLowerCase(), cnpj = b.cnpj ? String(b.cnpj).replace(/\D/g, "") : null;
  if (nome.length < 3 || nome.length > 120) { erro(res, 400, "nome", "Informe o nome do mercado (3 a 120 caracteres)."); return null; }
  if (cidade.length < 2 || cidade.length > 80) { erro(res, 400, "cidade", "Informe a cidade."); return null; }
  if (!EMAIL.test(email) || email.length > 160) { erro(res, 400, "email", "Informe um e-mail de contato válido."); return null; }
  if (cnpj && !cnpjValido(cnpj)) { erro(res, 400, "cnpj", "CNPJ inválido. Confira os 14 dígitos ou deixe em branco."); return null; }
  return { nome: nome.slice(0, 120), cidade: cidade.slice(0, 80), email, cnpj };
}
async function inserirMercado(v, contaId, res) {
  try {
    return (await sql().query(`insert into mercados (nome, cnpj, cidade, email, origem, conta_id) values ($1, $2, $3, $4, 'portal', $5) returning id, nome, cidade`, [v.nome, v.cnpj, v.cidade, v.email, contaId]))[0];
  } catch (e) {
    if (/mercados_cnpj_uq|duplicate key/i.test(String(e.message))) { erro(res, 409, "cnpj", "Esse CNPJ já está cadastrado. Se o mercado já existe, entre na conta dele ou use 'vincular' com a chave de produção."); return null; }
    throw e;
  }
}

module.exports = async (req, res) => {
  const acao = (req.query && req.query.acao) || "";
  try {
    /* ---------- conta ---------- */
    if (acao === "registrar" && req.method === "POST") {
      const b = corpo(req) || {};
      const email = String(b.email || "").trim().toLowerCase();
      if (!EMAIL.test(email) || email.length > 160) return erro(res, 400, "email", "Informe um e-mail válido.");
      if (!C.senhaOk(b.senha)) return erro(res, 400, "senha", "A senha deve ter de 8 a 72 caracteres.");
      /* mercado JÁ cadastrado (pela API ou pelo admin): em vez de criar outro, a conta assume o existente com a chave de PRODUÇÃO */
      let v = null, existente = null;
      if (b.chave) {
        const k = String(b.chave).trim();
        if (!/^lc_live_[0-9a-f]{32}$/.test(k)) return erro(res, 400, "chave", "Informe a chave de produção do mercado (começa com lc_live_).");
        const r = await sql().query(`select m.id, m.nome, m.conta_id from chaves_api c join mercados m on m.id = c.mercado_id where c.hash = $1 and c.revogada_em is null`, [sha256(k)]);
        if (!r.length) return erro(res, 404, "chave", "Chave não encontrada ou revogada.");
        if (r[0].conta_id) return erro(res, 409, "ja_vinculado", "Este mercado já pertence a uma conta. Entre nela ou fale com a equipe.");
        existente = r[0];
      } else { v = validarMercado(b, res, email); if (!v) return; if (!(await cnpjAtivo(v, res))) return; }
      if (!(await dentroDoLimite(req, "cadastro", 5, "1 day"))) return erro(res, 429, "limite", "Muitos cadastros deste endereço hoje. Tente amanhã ou fale com a equipe.");
      if ((await sql().query(`select 1 from mercado_contas where email = $1`, [email])).length) return erro(res, 409, "email_ja_cadastrado", "Esse e-mail já tem conta. Use a aba Entrar.");
      const conta = (await sql().query(`insert into mercado_contas (email, senha_hash) values ($1, $2) returning id, email`, [email, C.hashSenha(b.senha)]))[0];
      if (existente) {
        await sql().query(`update mercados set conta_id = $1 where id = $2`, [conta.id, existente.id]);
        C.abrir(res, conta.id);
        return enviar(res, 201, { ok: true, conta: { email: conta.email }, mercado: { id: existente.id, nome: existente.nome }, chaves: null });
      }
      const m = await inserirMercado(v, conta.id, res);
      if (!m) { await sql().query(`delete from mercado_contas where id = $1`, [conta.id]); return; }
      C.abrir(res, conta.id);
      return enviar(res, 201, { ok: true, conta: { email: conta.email }, mercado: m, chaves: await par(m.id), aviso: "Guarde as chaves agora: elas não são mostradas de novo. Você pode gerar novas a qualquer momento no portal." });
    }

    if (acao === "entrar" && req.method === "POST") {
      const b = corpo(req) || {};
      const email = String(b.email || "").trim().toLowerCase();
      if (!(await dentroDoLimite(req, "login_mercado", 12, "15 minutes"))) return erro(res, 429, "limite", "Muitas tentativas. Aguarde alguns minutos.");
      const r = await sql().query(`select id, email, senha_hash from mercado_contas where email = $1`, [email]);
      /* mesma resposta para e-mail inexistente e senha errada (não revela quais e-mails existem) */
      if (!r.length || typeof b.senha !== "string" || !C.confere(b.senha, r[0].senha_hash)) return erro(res, 401, "credenciais", "E-mail ou senha incorretos.");
      await sql().query(`update mercado_contas set ultimo_acesso = now() where id = $1`, [r[0].id]);
      C.abrir(res, r[0].id);
      return enviar(res, 200, { ok: true, conta: { email: r[0].email } });
    }

    if (acao === "sair" && req.method === "POST") { C.fechar(res); return enviar(res, 200, { ok: true }); }

    if (acao === "eu" && req.method === "GET") {
      const c = await C.conta(req);
      return enviar(res, 200, { ok: true, conta: c ? { email: c.email } : null });
    }

    if (acao === "senha" && req.method === "POST") {
      const a = await acesso(req, res); if (!a) return;
      const b = corpo(req) || {};
      if (!C.senhaOk(b.nova)) return erro(res, 400, "senha", "A nova senha deve ter de 8 a 72 caracteres.");
      const r = await sql().query(`select senha_hash from mercado_contas where id = $1`, [a.c.id]);
      if (!C.confere(String(b.atual || ""), r[0].senha_hash)) return erro(res, 401, "credenciais", "A senha atual está incorreta.");
      await sql().query(`update mercado_contas set senha_hash = $1 where id = $2`, [C.hashSenha(b.nova), a.c.id]);
      return enviar(res, 200, { ok: true });
    }

    if (acao === "excluir-conta" && req.method === "POST") {
      const a = await acesso(req, res); if (!a) return;
      const r = await sql().query(`select senha_hash from mercado_contas where id = $1`, [a.c.id]);
      if (!C.confere(String((corpo(req) || {}).senha || ""), r[0].senha_hash)) return erro(res, 401, "credenciais", "Senha incorreta.");
      const ids = (await sql().query(`select id from mercados where conta_id = $1`, [a.c.id])).map(x => x.id);
      for (const id of ids) { await sql().query(`delete from precos_historico where mercado_id = $1`, [id]); await sql().query(`delete from mercados where id = $1`, [id]); }
      await sql().query(`delete from mercado_contas where id = $1`, [a.c.id]);
      C.fechar(res);
      return enviar(res, 200, { ok: true });
    }

    /* ---------- mercados ---------- */
    if (acao === "meus" && req.method === "GET") {
      const a = await acesso(req, res); if (!a) return;
      const r = await sql().query(
        `select m.id, m.nome, m.cnpj, m.cidade, m.email, m.ativo, m.criado_em,
                (select count(*)::int from precos p where p.mercado_id = m.id and p.ambiente = 'producao') as produtos,
                (select count(*)::int from precos p where p.mercado_id = m.id and p.ambiente = 'teste') as produtos_teste,
                (select max(p.atualizado_em) from precos p where p.mercado_id = m.id and p.ambiente = 'producao') as ultima_atualizacao,
                (select coalesce(json_agg(json_build_object('id', c.id, 'prefixo', c.prefixo, 'ambiente', c.ambiente, 'revogada', c.revogada_em is not null, 'criada_em', c.criada_em) order by c.id), '[]'::json)
                   from chaves_api c where c.mercado_id = m.id) as chaves
           from mercados m where m.conta_id = $1 order by m.id desc`, [a.c.id]);
      return enviar(res, 200, { ok: true, contaEmail: a.c.email, dados: r });
    }

    if (acao === "criar" && req.method === "POST") {
      const a = await acesso(req, res); if (!a) return;
      const v = validarMercado(corpo(req) || {}, res, a.c.email); if (!v) return;
      if (!(await cnpjAtivo(v, res))) return;
      const qtd = await sql().query(`select count(*)::int as n from mercados where conta_id = $1`, [a.c.id]);
      if (qtd[0].n >= MAX_MERCADOS) return erro(res, 400, "limite", `Cada conta pode ter até ${MAX_MERCADOS} mercados.`);
      const m = await inserirMercado(v, a.c.id, res); if (!m) return;
      return enviar(res, 201, { ok: true, mercado: m, chaves: await par(m.id), aviso: "Guarde as chaves agora: elas não são mostradas de novo." });
    }

    /* traz para esta conta um mercado já cadastrado (pela API, pelo admin ou por outra conta sua): quem tem a chave de PRODUÇÃO prova que é o dono */
    if (acao === "vincular" && req.method === "POST") {
      const a = await acesso(req, res); if (!a) return;
      const k = String((corpo(req) || {}).chave || "").trim();
      if (!/^lc_live_[0-9a-f]{32}$/.test(k)) return erro(res, 400, "chave", "Informe a chave de produção do mercado (começa com lc_live_).");
      const r = await sql().query(`select m.id, m.nome, m.conta_id from chaves_api c join mercados m on m.id = c.mercado_id where c.hash = $1 and c.revogada_em is null`, [sha256(k)]);
      if (!r.length) return erro(res, 404, "chave", "Chave não encontrada ou revogada.");
      if (r[0].conta_id === a.c.id) return enviar(res, 200, { ok: true, mercado: { id: r[0].id, nome: r[0].nome } });
      if (r[0].conta_id) return erro(res, 409, "ja_vinculado", "Este mercado já pertence a outra conta. Fale com a equipe se for engano.");
      const qtd = await sql().query(`select count(*)::int as n from mercados where conta_id = $1`, [a.c.id]);
      if (qtd[0].n >= MAX_MERCADOS) return erro(res, 400, "limite", `Cada conta pode ter até ${MAX_MERCADOS} mercados.`);
      await sql().query(`update mercados set conta_id = $1 where id = $2`, [a.c.id, r[0].id]);
      return enviar(res, 200, { ok: true, mercado: { id: r[0].id, nome: r[0].nome } });
    }

    if (acao === "editar" && req.method === "POST") {
      const b = corpo(req) || {}; const a = await acesso(req, res, b.id); if (!a) return;
      const v = validarMercado(b, res, a.c.email); if (!v) return;
      if (v.cnpj !== a.m.cnpj && !(await cnpjAtivo(v, res))) return;
      try { await sql().query(`update mercados set nome = $1, cidade = $2, cnpj = $3, email = $4 where id = $5`, [v.nome, v.cidade, v.cnpj, v.email, a.m.id]); }
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
      await sql().query(`delete from mercados where id = $1`, [a.m.id]); /* chaves e preços saem junto */
      return enviar(res, 200, { ok: true });
    }

    return erro(res, 404, "rota", "Rota não encontrada.");
  } catch (e) { return erro(res, 500, "interno", "Erro interno."); }
};
