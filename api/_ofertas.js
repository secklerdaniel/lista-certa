/* Carga diária de ofertas (admin). Esquema: ver docs no painel interno > Ofertas.
   Regra: o lote enviado SUBSTITUI as ofertas dos mercados (mercado+cidade) que aparecem nele, salvo acrescentar=true. */
const { sql } = require("./_lib");

const UNIDADES = new Set(["kg", "g", "l", "ml", "un", "m", "dz"]);
const MAX = 2000;
const txt = (v, n) => (v == null ? "" : String(v)).replace(/\s+/g, " ").trim().slice(0, n);
const iso = v => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(v));

/* Um produto, um nome: tira o que é só classificação/qualidade ("Tipo 1", "Tradicional", "de Segunda", "Extra"...) e junta "Arroz" puro com "Arroz Branco".
   Serve para salvar (aqui) e para agrupar o que já existe (_produtos.listar). O que muda o produto de verdade (Parboilizado, Integral, Temperada) fica.
   ponytail: lista fixa de qualificadores; cresce quando aparecer outro. */
const QUALIF = /\s+(tipo\s*(?:1|2|i|ii)|tradicional|especial|extra|de\s+(?:primeira|segunda|1[aªº]?|2[aªº]?))(?=\s|$)/gi;
/* "Bovino" é a própria categoria; congelado/resfriado é estado, não produto (vai para a observação, ver estado()). */
const SOBRA = /\s+(bovin[oa]|congelad[oa]|resfriad[oa])(?=\s|$)/gi;
/* nomes diferentes do mesmo corte -> um nome (chave sem acento, minúscula) */
const SINONIMO = {
  "arroz": "Arroz Branco",
  "chuleta medalhao": "Chuleta", "chuleta bife ou medalhao": "Chuleta",
  "ponta de peito com osso": "Ponta de Peito",
  "coxa com sobrecoxa": "Coxa e Sobrecoxa",
  "coxao de dentro": "Coxão Mole", "coxao duro": "Coxão de Fora",
  "coxinha da asa de frango": "Coxinha da Asa",
  "linguica toscana": "Linguiça",
};
const nomeProduto = p => {
  const n = String(p || "").replace(QUALIF, "").replace(SOBRA, "").replace(/\s+/g, " ").trim();
  if (/^coxa (e|com) sobrecoxa/i.test(n)) return "Coxa e Sobrecoxa"; /* congelada ou não: a dona de casa já sabe */
  if (/^ponta de peito/i.test(n)) return "Ponta de Peito"; /* com osso, sem osso: é ponta de peito */
  if (/picanha/i.test(n)) return "Picanha"; /* picanha é picanha: medalhão, fatiada, bife... ponytail: pegaria "linguiça sabor picanha" se aparecer */
  return SINONIMO[sem(n)] || n;
};
const estado = p => { const m = String(p || "").match(/\b(congelad[oa]|resfriad[oa])\b/i); return m ? m[1][0].toUpperCase() + m[1].slice(1).toLowerCase() : null; };
function validar(lista, hoje) {
  const ok = [], rejeitados = [], avisos = [];
  lista.forEach((it, i) => {
    const rej = msg => rejeitados.push({ linha: i + 1, produto: it && it.produto_normalizado, erro: msg });
    if (!it || typeof it !== "object") return rej("item não é um objeto");
    const mercado = txt(it.mercado, 120), cidade = txt(it.cidade, 80), produto = nomeProduto(txt(it.produto_normalizado, 120));
    if (!mercado || !cidade || !produto) return rej("mercado, cidade e produto_normalizado são obrigatórios");
    const preco = typeof it.preco === "number" ? it.preco : parseFloat(String(it.preco).replace(",", "."));
    if (!(preco > 0 && preco < 100000)) return rej("preco deve ser número maior que zero");
    let qtd = null;
    if (it.quantidade != null) { qtd = Number(it.quantidade); if (!(qtd > 0 && qtd < 1e6)) return rej("quantidade deve ser número maior que zero ou null"); }
    const un = it.unidade_medida == null ? null : txt(it.unidade_medida, 4).toLowerCase();
    if (un && !UNIDADES.has(un)) return rej(`unidade_medida deve ser uma de: ${[...UNIDADES].join(", ")}`);
    let de = it.valido_de == null ? null : it.valido_de, ate = it.valido_ate == null ? null : it.valido_ate, obs = txt(it.observacao, 120) || null;
    const est = estado(it.produto_normalizado); if (est && !sem(obs || "").includes(sem(est))) obs = txt(est + (obs ? " · " + obs : ""), 120);
    if (de != null && !iso(de)) { avisos.push(`linha ${i + 1}: valido_de "${de}" não é AAAA-MM-DD; ignorado`); de = null; }
    if (ate != null && !iso(ate)) { obs = obs || txt(ate, 120); avisos.push(`linha ${i + 1}: valido_ate "${ate}" não é data; guardado como observação`); ate = null; }
    if (ate && ate < hoje) return rej(`valido_ate ${ate} já passou`);
    if (de && ate && ate < de) return rej("valido_ate anterior a valido_de");
    ok.push([mercado, cidade, txt(it.categoria, 60) || null, produto, txt(it.marca, 60) || null, qtd, un, Math.round(preco * 100) / 100, de, ate, obs]);
  });
  return { ok, rejeitados, avisos };
}

/* Nome oficial = o do catálogo da região (mercados_regiao), o mesmo que os cupons usam (por CNPJ). Variações de nome
   ("Supermercados Dia", "Super Berti") viram o nome do catálogo; mercado novo entra no catálogo (fonte 'folheto').
   Ignora acento, caixa, palavras como "supermercado"/"mercado" e a cidade no fim. Apelidos que a regra não pega vão em ALIAS.
   ponytail: ALIAS é mapa fixo no código; vira tabela no banco se crescer. */
const ALIAS = { "gramado|dia": "gramado|dia apos dia" };
const sem = s => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const chave = (nome, cidade) => {
  const c = sem(cidade).replace(/[^a-z0-9]+/g, " ").trim();
  let w = sem(nome).replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(x => !["supermercado", "supermercados", "super", "mercado", "mini", "de", "do", "da"].includes(x)).join(" ");
  if (w.endsWith(" " + c)) w = w.slice(0, -(c.length + 1));
  return c + "|" + w;
};
async function mapaOficial() {
  const cat = await sql().query(`select nome, cidade, cnpj from mercados_regiao where ativo order by id`);
  const mapa = new Map();
  cat.forEach(k => { const c = chave(k.nome, k.cidade); if (!mapa.has(c)) mapa.set(c, { nome: k.nome, cnpj: k.cnpj }); });
  return mapa;
}
const oficial = (mapa, nome, cidade) => { const c = chave(nome, cidade); return mapa.get(ALIAS[c] || c); };
async function oficiais(ok, avisos) {
  const mapa = await mapaOficial(), novos = new Map();
  ok.forEach(x => {
    const nome = (oficial(mapa, x[0], x[1]) || {}).nome;
    if (nome) { if (nome !== x[0]) { avisos.push(`mercado "${x[0]}" (${x[1]}) gravado como "${nome}"`); x[0] = nome; } }
    else novos.set(chave(x[0], x[1]), [x[0], x[1]]);
  });
  for (const [nome, cidade] of novos.values()) {
    await sql().query(`insert into mercados_regiao (nome, cidade, fonte) values ($1, $2, 'folheto') on conflict do nothing`, [nome, cidade]);
    avisos.push(`mercado novo "${nome}" (${cidade}) adicionado ao catálogo da região`);
  }
}

/* mesmo produto = mesmo nome, marca, quantidade e unidade (ignora acento, caixa e pontuação) */
const lim = t => sem(t || "").replace(/[^a-z0-9]+/g, " ").trim();
const chaveProd = (m, c, p, ma, q, u) => [lim(m), lim(c), lim(p), lim(ma), Number(q) || 0, u || ""].join("|");

/* modo: "produto" = troca só o MESMO produto no mesmo mercado e cidade (o resto fica); "mercado" (padrão) = troca todas as ofertas dos mercados do envio;
   acrescentar=true = só soma. */
async function carregar(corpo, acrescentar, modo) {
  const lista = Array.isArray(corpo) ? corpo : corpo && Array.isArray(corpo.itens) ? corpo.itens : null;
  if (!lista) return { status: 400, msg: 'Envie um array de ofertas (ou {"itens":[...]}).' };
  if (!lista.length) return { status: 400, msg: "A lista está vazia." };
  if (lista.length > MAX) return { status: 413, msg: `No máximo ${MAX} itens por envio.` };
  const hoje = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10); // data de Brasília
  const { ok, rejeitados, avisos } = validar(lista, hoje);
  if (!ok.length) return { status: 422, msg: "Nenhuma oferta válida.", rejeitados, avisos };
  await oficiais(ok, avisos);
  const c = i => ok.map(x => x[i]);
  let apagar = [];
  if (modo === "produto") {
    const novos = new Set(ok.map(x => chaveProd(x[0], x[1], x[3], x[4], x[5], x[6])));
    const pares = [...new Set(ok.map(x => x[0].toLowerCase() + "|" + x[1].toLowerCase()))];
    const ex = await sql().query(`select id, mercado, cidade, produto, marca, quantidade, unidade from ofertas where lower(mercado) || '|' || lower(cidade) = any($1::text[])`, [pares]);
    apagar = ex.filter(o => novos.has(chaveProd(o.mercado, o.cidade, o.produto, o.marca, o.quantidade, o.unidade))).map(o => o.id);
  }
  const r = await sql().query(
    `with entrada as (select * from unnest($1::text[],$2::text[],$3::text[],$4::text[],$5::text[],$6::numeric[],$7::text[],$8::numeric[],$9::date[],$10::date[],$11::text[])
         as t(mercado,cidade,categoria,produto,marca,quantidade,unidade,preco,valido_de,valido_ate,validade_obs)),
     del as (delete from ofertas where not $12::boolean and (lower(mercado), lower(cidade)) in (select lower(mercado), lower(cidade) from entrada) returning 1),
     ins as (insert into ofertas (mercado,cidade,categoria,produto,marca,quantidade,unidade,preco,valido_de,valido_ate,validade_obs,fonte)
         select *, 'admin' from entrada returning 1)
     select (select count(*) from ins)::int as inseridas, (select count(*) from del)::int as substituidas`,
    [c(0), c(1), c(2), c(3), c(4), c(5), c(6), c(7), c(8), c(9), c(10), acrescentar === true || modo === "produto"]);
  if (apagar.length) await sql().query(`delete from ofertas where id = any($1::int[])`, [apagar]); /* depois de inserir: se a carga falhar, nada se perde */
  const porMercado = {}; ok.forEach(x => { const k = x[0] + " · " + x[1]; porMercado[k] = (porMercado[k] || 0) + 1; });
  return { status: 200, inseridas: r[0].inseridas, substituidas: modo === "produto" ? apagar.length : r[0].substituidas, porMercado, rejeitados, avisos };
}

module.exports = { carregar, validar, mapaOficial, oficial, nomeProduto };
