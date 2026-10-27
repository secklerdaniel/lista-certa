/* Utilidades públicas numa função só (o plano Hobby da Vercel limita a 12 funções por deploy).
   Os endereços públicos continuam os mesmos, via "rewrites" no vercel.json:
   GET /api/versao                    → { v }  id do deploy (a faixa "nova atualização" compara)
   GET /api/v1/cnpj?cnpj=             → dados públicos da Receita para preencher o cadastro
   GET /api/v1/proximos?lat=&lng=     → mercados num raio de ~1 km (OpenStreetMap); a posição NÃO é guardada */
const { sql, sha256, enviar, erro } = require("../_lib");
const { consultar } = require("../_cnpj");
const { cnpjValido } = require("../v1/cadastro");

/* ---------- versão ---------- */
function versao(req, res) {
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify({ v: process.env.VERCEL_DEPLOYMENT_ID || process.env.VERCEL_GIT_COMMIT_SHA || "local" }));
}

/* ---------- CNPJ ---------- */
async function cnpj(req, res) {
  const n = String((req.query && req.query.cnpj) || "").replace(/\D/g, "");
  if (!cnpjValido(n)) return erro(res, 400, "cnpj", "CNPJ inválido.");
  const ip = sha256(String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "?").split(",")[0].trim() + "|lc");
  const u = await sql().query(`select count(*)::int as n from uso_publico where ip_hash = $1 and tipo = 'cnpj' and em > now() - interval '1 hour'`, [ip]);
  if (u[0].n >= 40) return erro(res, 429, "limite", "Muitas consultas. Tente de novo mais tarde.");
  await sql().query(`insert into uso_publico (ip_hash, tipo) values ($1, 'cnpj')`, [ip]);
  const c = await consultar(n);
  if (!c) return erro(res, 502, "consulta", "Não consegui consultar a Receita agora. Preencha manualmente.");
  if (!c.encontrado) return enviar(res, 200, { ok: true, encontrado: false });
  enviar(res, 200, { ok: true, ...c });
}

/* ---------- mercados próximos ---------- */
const RAIO_M = 1000, MAX = 8;
const ENDPOINTS = ["https://overpass-api.de/api/interpreter", "https://overpass.openstreetmap.fr/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
const rad = x => x * Math.PI / 180;
function metros(a, b, c, d) {
  const R = 6371000, dLa = rad(c - a), dLo = rad(d - b);
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(rad(a)) * Math.cos(rad(c)) * Math.sin(dLo / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}
async function overpass(lat, lng, fetchFn = fetch) {
  const q = `[out:json][timeout:12];(nwr["shop"~"^(supermarket|convenience|greengrocer|wholesale|butcher|bakery|general)$"]["name"](around:${RAIO_M},${lat},${lng}););out center tags 60;`;
  let ultimo;
  for (const url of ENDPOINTS) {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 8000);
    try {
      const r = await fetchFn(url, { method: "POST", signal: ctl.signal, headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "Sacolista/1.0 (https://lista-certa-omega.vercel.app)" }, body: "data=" + encodeURIComponent(q) });
      if (!r.ok) { ultimo = new Error("overpass_" + r.status); continue; }
      return (await r.json()).elements || [];
    } catch (e) { ultimo = e; } finally { clearTimeout(t); }
  }
  throw ultimo || new Error("overpass");
}
function organizar(elementos, lat, lng) {
  const vistos = new Set(), saida = [];
  for (const e of elementos) {
    const nome = e.tags && e.tags.name ? String(e.tags.name).trim().slice(0, 80) : "";
    const la = e.lat ?? (e.center && e.center.lat), lo = e.lon ?? (e.center && e.center.lon);
    if (!nome || la == null || lo == null) continue;
    const d = metros(lat, lng, la, lo), chave = nome.toLowerCase() + "|" + Math.round(d / 40);
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    saida.push({ nome, metros: d, tipo: e.tags.shop });
  }
  return saida.sort((a, b) => a.metros - b.metros).slice(0, MAX);
}
/* mercados do nosso catálogo da região (cadastrados à mão pelo admin e descobertos pelos cupons), com distância se houver coordenadas */
async function doCatalogo(lat, lng) {
  return await sql().query(
    `select nome, endereco, cidade, round(6371000 * acos(least(1, cos(radians($1)) * cos(radians(lat)) * cos(radians(lng) - radians($2)) + sin(radians($1)) * sin(radians(lat)))))::int as metros
       from mercados_regiao where ativo and lat is not null and lng is not null
        and 6371000 * acos(least(1, cos(radians($1)) * cos(radians(lat)) * cos(radians(lng) - radians($2)) + sin(radians($1)) * sin(radians(lat)))) <= $3
      order by metros limit ${MAX}`, [lat, lng, 1500]);
}
const chaveNome = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
async function proximos(req, res) {
  const lat = Number(req.query && req.query.lat), lng = Number(req.query && req.query.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return erro(res, 400, "coordenadas", "Informe lat e lng válidos.");
  let lista = [];
  try { lista = (await doCatalogo(lat, lng)).map(r => ({ nome: r.nome, metros: r.metros, endereco: r.endereco, fonte: "catalogo" })); } catch (e) { /* segue só com o mapa */ }
  /* o catálogo vem primeiro; o mapa público (OpenStreetMap) completa quando há pouco por perto */
  if (lista.length < 3) {
    try {
      const vistos = new Set(lista.map(x => chaveNome(x.nome)));
      for (const x of organizar(await overpass(lat, lng), lat, lng)) if (!vistos.has(chaveNome(x.nome))) { vistos.add(chaveNome(x.nome)); lista.push({ ...x, fonte: "mapa" }); }
    } catch (e) { if (!lista.length) return erro(res, 502, "mapa", "Não consegui consultar o mapa agora. Digite o nome do mercado.", { detalhe: String(e && e.message || e).slice(0, 80) }); }
  }
  enviar(res, 200, { ok: true, raioMetros: RAIO_M, dados: lista.sort((a, b) => a.metros - b.metros).slice(0, MAX) });
}

/* GET /api/v1/regiao?cidade=  → mercados do catálogo da região (para sugerir nome no envio de vídeo) */
async function regiao(req, res) {
  const cidade = req.query && req.query.cidade ? String(req.query.cidade) : null;
  const r = await sql().query(`select nome, cidade, endereco from mercados_regiao where ativo ${cidade ? "and lower(cidade) = lower($1)" : ""} order by nome limit 300`, cidade ? [cidade] : []);
  enviar(res, 200, { ok: true, dados: r });
}

/* GET /api/v1/cupons?cidade=&dias=  → último preço de cada item, por mercado (CNPJ), vindo dos cupons fiscais lidos por todos */
async function cupons(req, res) {
  const cidade = req.query && req.query.cidade ? String(req.query.cidade) : null;
  const dias = Math.min(Math.max(parseInt(req.query && req.query.dias, 10) || 90, 1), 365);
  const r = await sql().query(
    `select distinct on (p.cnpj, lower(p.descricao)) p.cnpj, coalesce(g.nome, p.mercado_nome) as mercado, p.descricao, p.unidade, p.preco_unit::float as preco, p.categoria, p.emissao
       from precos_cupom p left join mercados_regiao g on g.cnpj = p.cnpj
      where ${cidade ? "lower(p.cidade) = lower($1) and " : ""}p.emissao > now() - interval '${dias} days'
      order by p.cnpj, lower(p.descricao), p.emissao desc limit 5000`, cidade ? [cidade] : []);
  /* vídeos de prateleira também são públicos (sem CNPJ: o mercado é identificado pelo nome) */
  const v = await sql().query(
    `select distinct on (lower(mercado_nome), lower(descricao)) null::text as cnpj, mercado_nome as mercado, cidade, descricao, 'UN' as unidade, coalesce(promocao_preco, preco)::float as preco, categoria, criado_em as emissao
       from coletas where ${cidade ? "lower(cidade) = lower($1) and " : ""}criado_em > now() - interval '${dias} days'
      order by lower(mercado_nome), lower(descricao), criado_em desc limit 2000`, cidade ? [cidade] : []);
  /* nome oficial do catálogo (e CNPJ) também para os vídeos: "Mercado Dia" e "Dia Após Dia" são um mercado só */
  const { mapaOficial, oficial } = require("../_ofertas"), mapa = await mapaOficial();
  v.forEach(x => { const g = oficial(mapa, x.mercado, x.cidade); if (g) { x.mercado = g.nome; x.cnpj = g.cnpj; } delete x.cidade; });
  /* ofertas de folheto (tabela ofertas, sem GTIN): valem até valido_ate; sem data, 14 dias */
  /* limpeza: apaga ofertas vencidas (ponytail: roda a cada consulta, é um delete barato; cron da Vercel só se passar das 12 funções do plano) */
  await sql().query(`delete from ofertas where coalesce(valido_ate < current_date, criado_em < now() - interval '14 days')`);
  /* pelo nome, a oferta se liga ao mesmo mercado do catálogo (e ao CNPJ), então funde com os cupons do mesmo mercado */
  const o = await sql().query(
    `select g.cnpj, coalesce(g.nome, f.mercado) as mercado, 'oferta' as tipo, concat_ws(' ', f.produto, f.marca, f.quantidade::float8::text, f.unidade) as descricao, 'UN' as unidade, f.preco::float as preco, null::text as categoria, coalesce(f.valido_de::timestamptz, f.criado_em) as emissao
       from ofertas f left join mercados_regiao g on lower(g.nome) = lower(f.mercado) and lower(g.cidade) = lower(f.cidade)
      where ${cidade ? "lower(f.cidade) = lower($1) and " : ""}coalesce(f.valido_ate >= current_date, f.criado_em > now() - interval '14 days') limit 2000`, cidade ? [cidade] : []);
  enviar(res, 200, { ok: true, dados: r.concat(v, o) });
}

module.exports = async (req, res) => {
  if (req.method !== "GET") return erro(res, 405, "metodo", "Use GET.");
  const acao = (req.query && req.query.acao) || "";
  try {
    if (acao === "versao") return versao(req, res);
    if (acao === "cnpj") return await cnpj(req, res);
    if (acao === "proximos") return await proximos(req, res);
    if (acao === "regiao") return await regiao(req, res);
    if (acao === "cupons") return await cupons(req, res);
    return erro(res, 404, "rota", "Rota não encontrada.");
  } catch (e) { return erro(res, 500, "interno", "Erro interno."); }
};
