/* GET /api/v1/proximos?lat=&lng=  → supermercados/lojas de alimentos num raio de ~1 km (dados do OpenStreetMap, via Overpass).
   Usado no envio de vídeo para sugerir "em qual mercado você está". A posição NÃO é guardada nem registrada. */
const { enviar, erro } = require("../_lib");

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

module.exports = async (req, res) => {
  if (req.method !== "GET") return erro(res, 405, "metodo", "Use GET.");
  const lat = Number(req.query && req.query.lat), lng = Number(req.query && req.query.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return erro(res, 400, "coordenadas", "Informe lat e lng válidos.");
  try {
    enviar(res, 200, { ok: true, raioMetros: RAIO_M, dados: organizar(await overpass(lat, lng), lat, lng) });
  } catch (e) {
    erro(res, 502, "mapa", "Não consegui consultar o mapa agora. Digite o nome do mercado.");
  }
};
module.exports.organizar = organizar;
module.exports.metros = metros;
