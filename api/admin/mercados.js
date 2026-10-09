/* Painel interno (header x-admin-key = env ADMIN_KEY; sem a env, fecha).
   GET  /api/admin/mercados                          → mercados com contagens e chaves (só prefixos)
   GET  /api/admin/mercados?precos=<id>              → preços do mercado (produção e teste)
   POST { nome, cnpj?, cidade, email?, ibge? }       → cria o mercado e devolve as chaves UMA vez
   POST { mercadoId, editar: { nome, cidade, cnpj, email } }   → edita
   POST { mercadoId, novaChave: true }               → gera novo par de chaves (as anteriores continuam válidas)
   POST { mercadoId, revogarChave: <id> }            → revoga uma chave
   POST { mercadoId, ativo: true|false }             → ativa/desativa (some das consultas públicas)
   POST { mercadoId, excluirPreco: { gtin, ambiente } } → apaga um preço
   POST { mercadoId, excluir: true }                 → APAGA o mercado, as chaves e todos os preços */
const { sql, sha256, enviar, erro, corpo, admin, crypto } = require("../_lib");

const nova = amb => `lc_${amb === "teste" ? "test" : "live"}_${crypto.randomBytes(16).toString("hex")}`;
async function guardar(mercadoId, amb) {
  const k = nova(amb);
  await sql().query(`insert into chaves_api (mercado_id, prefixo, hash, ambiente) values ($1, $2, $3, $4)`, [mercadoId, k.slice(0, 12), sha256(k), amb]);
  return k;
}
const par = async id => ({ teste: await guardar(id, "teste"), producao: await guardar(id, "producao") });
const AVISO = "Guarde agora: as chaves não são mostradas de novo.";
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

module.exports = async (req, res) => {
  if (!admin(req)) return erro(res, 401, "nao_autorizado", "Não autorizado.");
  try {
    if (req.method === "GET") {
      /* catálogo da REGIÃO (mercados que ainda não têm conta; alimenta as sugestões do envio de vídeo) */
      if (req.query && req.query.regiao) {
        const r = await sql().query(`select id, nome, cidade, endereco, cnpj, fonte, ativo, (lat is not null) as tem_coordenadas, criado_em from mercados_regiao order by lower(cidade), lower(nome)`);
        return enviar(res, 200, { ok: true, dados: r });
      }
      if (req.query && req.query.precos) {
        const r = await sql().query(
          `select gtin, descricao, unidade, preco::float as preco, promocao_preco::float as promocao_preco, promocao_ate, ambiente, atualizado_em
             from precos where mercado_id = $1 order by ambiente, descricao nulls last limit 500`, [parseInt(req.query.precos, 10)]);
        return enviar(res, 200, { ok: true, dados: r });
      }
      const r = await sql().query(
        `select m.id, m.nome, m.cnpj, m.cidade, m.email, m.origem, m.ativo, m.criado_em, m.conta_id,
                (select c.email from mercado_contas c where c.id = m.conta_id) as conta_email,
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

    /* CRUD do catálogo da região: { regiao: { acao: "criar"|"editar"|"excluir"|"ativo", id?, nome, cidade, endereco, cnpj, ativo } } */
    if (b.regiao && typeof b.regiao === "object") {
      const g = b.regiao, ac = g.acao;
      const nome = String(g.nome || "").replace(/\s+/g, " ").trim().slice(0, 120), cidade = String(g.cidade || "").replace(/\s+/g, " ").trim().slice(0, 80);
      const endereco = g.endereco ? String(g.endereco).replace(/\s+/g, " ").trim().slice(0, 160) : null, cnpj = g.cnpj ? String(g.cnpj).replace(/\D/g, "") : null;
      const dup = e => /mercados_regiao_nome_idx|mercados_regiao_cnpj_key|duplicate key/i.test(String(e.message));
      if (ac === "criar" || ac === "editar") {
        if (nome.length < 2) return erro(res, 400, "nome", "Informe o nome do mercado.");
        if (cidade.length < 2) return erro(res, 400, "cidade", "Informe a cidade.");
        if (cnpj && cnpj.length !== 14) return erro(res, 400, "cnpj", "CNPJ deve ter 14 dígitos (ou ficar em branco).");
      }
      try {
        if (ac === "criar") {
          const r = await sql().query(`insert into mercados_regiao (nome, cidade, endereco, cnpj, fonte) values ($1, $2, $3, $4, 'manual') returning id`, [nome, cidade, endereco, cnpj]);
          return enviar(res, 201, { ok: true, id: r[0].id });
        }
        if (ac === "editar") { await sql().query(`update mercados_regiao set nome = $1, cidade = $2, endereco = $3, cnpj = $4 where id = $5`, [nome, cidade, endereco, cnpj, parseInt(g.id, 10)]); return enviar(res, 200, { ok: true }); }
        if (ac === "ativo") { await sql().query(`update mercados_regiao set ativo = $1 where id = $2`, [!!g.ativo, parseInt(g.id, 10)]); return enviar(res, 200, { ok: true }); }
        if (ac === "excluir") { await sql().query(`delete from mercados_regiao where id = $1`, [parseInt(g.id, 10)]); return enviar(res, 200, { ok: true }); }
      } catch (e) { if (dup(e)) return erro(res, 409, "duplicado", "Já existe um mercado com esse nome nessa cidade (ou esse CNPJ)."); throw e; }
      return erro(res, 400, "acao", "Ação inválida.");
    }

    if (b.mercadoId) {
      const id = parseInt(b.mercadoId, 10);
      const ex = await sql().query(`select id, nome from mercados where id = $1`, [id]);
      if (!ex.length) return erro(res, 404, "mercado", "Mercado não existe.");
      if (b.novaChave) return enviar(res, 201, { ok: true, mercadoId: id, chaves: await par(id), aviso: AVISO });
      /* redefine a senha da CONTA dona do mercado (sem e-mail de recuperação ainda): gera uma senha provisória, mostrada UMA vez */
      if (b.resetarSenha) {
        const c = await sql().query(`select conta_id from mercados where id = $1`, [id]);
        if (!c[0].conta_id) return erro(res, 400, "sem_conta", "Este mercado não tem conta de login (foi cadastrado pela API ou pelo admin).");
        const prov = crypto.randomBytes(9).toString("base64url");
        await sql().query(`update mercado_contas set senha_hash = $1 where id = $2`, [require("../_conta").hashSenha(prov), c[0].conta_id]);
        return enviar(res, 200, { ok: true, senhaProvisoria: prov, aviso: "Entregue ao mercado e peça para trocar a senha no portal. Não será mostrada de novo." });
      }
      if (b.revogarChave) {
        const r = await sql().query(`update chaves_api set revogada_em = now() where id = $1 and mercado_id = $2 and revogada_em is null returning id`, [parseInt(b.revogarChave, 10), id]);
        return r.length ? enviar(res, 200, { ok: true, revogada: r[0].id }) : erro(res, 404, "chave", "Chave não encontrada ou já revogada.");
      }
      if (typeof b.ativo === "boolean") {
        await sql().query(`update mercados set ativo = $1 where id = $2`, [b.ativo, id]);
        return enviar(res, 200, { ok: true, mercadoId: id, ativo: b.ativo });
      }
      if (b.editar && typeof b.editar === "object") {
        const e = b.editar, nome = String(e.nome || "").replace(/\s+/g, " ").trim(), cidade = String(e.cidade || "").replace(/\s+/g, " ").trim();
        const cnpj = e.cnpj ? String(e.cnpj).replace(/\D/g, "") : null, email = e.email ? String(e.email).trim().toLowerCase() : null;
        if (nome.length < 3 || nome.length > 120) return erro(res, 400, "nome", "Nome do mercado: 3 a 120 caracteres.");
        if (cidade.length < 2 || cidade.length > 80) return erro(res, 400, "cidade", "Informe a cidade.");
        if (cnpj && cnpj.length !== 14) return erro(res, 400, "cnpj", "CNPJ deve ter 14 dígitos (ou ficar em branco).");
        if (email && !EMAIL.test(email)) return erro(res, 400, "email", "E-mail inválido.");
        try {
          await sql().query(`update mercados set nome = $1, cidade = $2, cnpj = $3, email = $4 where id = $5`, [nome, cidade, cnpj, email, id]);
        } catch (err) {
          if (/mercados_cnpj_uq|duplicate key/i.test(String(err.message))) return erro(res, 409, "cnpj", "Já existe outro mercado com esse CNPJ.");
          throw err;
        }
        return enviar(res, 200, { ok: true, mercadoId: id });
      }
      if (b.excluirPreco && b.excluirPreco.gtin) {
        const amb = b.excluirPreco.ambiente === "teste" ? "teste" : "producao";
        const r = await sql().query(`delete from precos where mercado_id = $1 and gtin = $2 and ambiente = $3 returning gtin`, [id, String(b.excluirPreco.gtin), amb]);
        return r.length ? enviar(res, 200, { ok: true }) : erro(res, 404, "preco", "Preço não encontrado.");
      }
      if (b.excluir === true) {
        await sql().query(`delete from precos_historico where mercado_id = $1`, [id]);
        await sql().query(`delete from mercados where id = $1`, [id]); /* chaves_api e precos saem junto (cascade) */
        return enviar(res, 200, { ok: true, excluido: id });
      }
      return erro(res, 400, "acao", "Nada a fazer: informe editar, novaChave, revogarChave, ativo, excluirPreco ou excluir.");
    }

    if (!b.nome || !b.cidade) return erro(res, 400, "campos", "Informe nome e cidade.");
    let m;
    try {
      m = await sql().query(`insert into mercados (nome, cnpj, cidade, ibge, email) values ($1, $2, $3, $4, $5) returning id, nome, cidade`,
        [String(b.nome).slice(0, 120), b.cnpj ? String(b.cnpj).replace(/\D/g, "") : null, String(b.cidade).slice(0, 80), b.ibge || null, b.email ? String(b.email).trim().toLowerCase() : null]);
    } catch (err) {
      if (/mercados_cnpj_uq|duplicate key/i.test(String(err.message))) return erro(res, 409, "cnpj", "Já existe um mercado com esse CNPJ.");
      throw err;
    }
    enviar(res, 201, { ok: true, mercado: m[0], chaves: await par(m[0].id), aviso: AVISO });
  } catch (e) { erro(res, 500, "interno", "Erro interno."); }
};
