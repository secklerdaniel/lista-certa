/* Aba Produtos do admin: junta os preços de ofertas (folheto), coletas (vídeo/admin) e cupons numa lista só,
   mais o CRUD de ofertas avulsas e das listas de produtos (churrasco, cesta...). Chamado por api/admin/usuarios.js
   (mora lá por causa do limite de 12 funções). */
const { sql } = require("./_lib");
const ofertas = require("./_ofertas");
const IA = require("./_ia");

/* categorias dos folhetos (texto livre) -> as mesmas da IA/coletas, para filtrar tudo junto */
const CAT_OFERTA = { "açougue": "carnes", "hortifrúti": "hortifruti", "laticínios": "laticinios", "mercearia": "mercearia", "bebidas": "bebidas", "limpeza": "limpeza",
  "higiene": "higiene", "padaria": "padaria", "congelados": "congelados", "biscoitos": "mercearia", "frios e embutidos": "frios", "doces e sobremesas": "mercearia", "variedades": "outros" };
const txt = (v, n) => (v == null ? "" : String(v)).replace(/\s+/g, " ").trim().slice(0, n);

async function listar() {
  const q = s => sql().query(s);
  const [of, co, cu, listas] = await Promise.all([
    q(`select id, produto as nome, marca, quantidade as qtd, unidade as un, categoria, mercado, cidade, preco, valido_ate as ate, validade_obs as obs, criado_em as em from ofertas
        where coalesce(valido_ate >= current_date, criado_em > now() - interval '14 days') order by id desc limit 3000`),
    q(`select id, descricao as nome, categoria, mercado_nome as mercado, cidade, preco, promocao_preco as promo, origem, criado_em as em from coletas order by id desc limit 2000`),
    q(`select id, descricao as nome, categoria, mercado_nome as mercado, cidade, preco_unit as preco, unidade as un, qtd, criado_em as em from precos_cupom order by id desc limit 2000`),
    listasTodas(),
  ]);
  const num = v => (v == null ? null : Number(v));
  const linhas = [
    ...of.map(r => ({ fonte: "oferta", id: r.id, nome: r.nome, marca: r.marca, qtd: num(r.qtd), un: r.un, cat: CAT_OFERTA[(r.categoria || "").toLowerCase()] || (IA.CATEGORIAS.includes(r.categoria) ? r.categoria : null),
      catOriginal: r.categoria, mercado: r.mercado, cidade: r.cidade, preco: num(r.preco), ate: r.ate, obs: r.obs, em: r.em })),
    ...co.map(r => ({ fonte: "coleta", origem: r.origem, id: Number(r.id), nome: r.nome, cat: r.categoria, mercado: r.mercado, cidade: r.cidade, preco: num(r.preco), promo: num(r.promo), em: r.em })),
    ...cu.map(r => ({ fonte: "cupom", id: Number(r.id), nome: r.nome, cat: r.categoria, mercado: r.mercado, cidade: r.cidade, preco: num(r.preco), un: r.un, qtd: num(r.qtd), em: r.em })),
  ];
  return { linhas, listas };
}

/* ---------- oferta avulsa (criar / editar / excluir um preço de folheto) ---------- */
async function oferta(b) {
  if (b.acao === "excluir") { await sql().query(`delete from ofertas where id = $1`, [parseInt(b.id, 10) || 0]); return { status: 200 }; }
  const hoje = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
  const item = { mercado: b.mercado, cidade: b.cidade, categoria: b.categoria, produto_normalizado: b.produto, marca: b.marca || null,
    quantidade: b.quantidade ? Number(String(b.quantidade).replace(",", ".")) : null, unidade_medida: b.quantidade && b.unidade ? b.unidade : null,
    preco: b.preco, valido_de: null, valido_ate: b.valido_ate || null, observacao: b.observacao || null };
  if (b.acao === "criar") {
    const r = await ofertas.carregar([item], true);
    return r.status === 200 ? { status: 200 } : { status: r.status, msg: (r.rejeitados && r.rejeitados[0] && r.rejeitados[0].erro) || r.msg };
  }
  if (b.acao !== "editar") return { status: 400, msg: "Ação inválida." };
  const { ok, rejeitados } = ofertas.validar([item], hoje);
  if (!ok.length) return { status: 422, msg: (rejeitados[0] && rejeitados[0].erro) || "Oferta inválida." };
  const mapa = await ofertas.mapaOficial(), of = ofertas.oficial(mapa, ok[0][0], ok[0][1]), x = ok[0];
  await sql().query(`update ofertas set mercado=$1, cidade=$2, categoria=$3, produto=$4, marca=$5, quantidade=$6, unidade=$7, preco=$8, valido_ate=$9, validade_obs=$10 where id=$11`,
    [of ? of.nome : x[0], x[1], x[2], x[3], x[4], x[5], x[6], x[7], x[9], x[10], parseInt(b.id, 10) || 0]);
  return { status: 200 };
}

/* ---------- listas de produtos ---------- */
/* itens = [{ nome, termo, qtd }]  (termo = o que procurar nos nomes dos produtos; vazio = o próprio nome) */
let pronto = false;
async function tabela() {
  if (pronto) return;
  await sql().query(`create table if not exists listas_produtos (id serial primary key, nome text not null, descricao text, itens jsonb not null default '[]', criado_em timestamptz not null default now())`);
  pronto = true;
}
async function listasTodas() {
  await tabela();
  return sql().query(`select id, nome, descricao, itens from listas_produtos order by lower(nome)`);
}
function itensLimpos(l) {
  if (!Array.isArray(l)) return [];
  return l.slice(0, 100).map(i => ({ nome: txt(i && i.nome, 80), termo: txt(i && i.termo, 80), qtd: Math.min(999, Math.max(0.01, Number(String((i && i.qtd) || 1).replace(",", ".")) || 1)) })).filter(i => i.nome);
}
async function lista(b) {
  await tabela();
  if (b.acao === "excluir") { await sql().query(`delete from listas_produtos where id = $1`, [parseInt(b.id, 10) || 0]); return { status: 200 }; }
  const nome = txt(b.nome, 80);
  if (!nome) return { status: 400, msg: "Dê um nome à lista." };
  const itens = JSON.stringify(itensLimpos(b.itens)), desc = txt(b.descricao, 200) || null;
  if (b.acao === "criar") {
    const r = await sql().query(`insert into listas_produtos (nome, descricao, itens) values ($1,$2,$3::jsonb) returning id`, [nome, desc, itens]);
    return { status: 200, id: r[0].id };
  }
  if (b.acao === "editar") { await sql().query(`update listas_produtos set nome=$1, descricao=$2, itens=$3::jsonb where id=$4`, [nome, desc, itens, parseInt(b.id, 10) || 0]); return { status: 200 }; }
  return { status: 400, msg: "Ação inválida." };
}

module.exports = { listar, oferta, lista };
