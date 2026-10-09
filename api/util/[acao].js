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
const ENDPOINTS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
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
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 12000);
    try {
      const r = await fetchFn(url, { method: "POST", signal: ctl.signal, headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "ListaCerta/1.0 (https://lista-certa-omega.vercel.app)" }, body: "data=" + encodeURIComponent(q) });
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
async function proximos(req, res) {
  const lat = Number(req.query && req.query.lat), lng = Number(req.query && req.query.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return erro(res, 400, "coordenadas", "Informe lat e lng válidos.");
  try { enviar(res, 200, { ok: true, raioMetros: RAIO_M, dados: organizar(await overpass(lat, lng), lat, lng) }); }
  catch (e) { erro(res, 502, "mapa", "Não consegui consultar o mapa agora. Digite o nome do mercado."); }
}

module.exports = async (req, res) => {
  if (req.method !== "GET") return erro(res, 405, "metodo", "Use GET.");
  const acao = (req.query && req.query.acao) || "";
  try {
    if (acao === "versao") return versao(req, res);
    if (acao === "cnpj") return await cnpj(req, res);
    if (acao === "proximos") return await proximos(req, res);
    return erro(res, 404, "rota", "Rota não encontrada.");
  } catch (e) { return erro(res, 500, "interno", "Erro interno."); }
};
