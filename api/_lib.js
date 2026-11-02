/* utilitários comuns da API (arquivo com _ não vira rota na Vercel) */
const crypto = require("crypto");
const { neon } = require("@neondatabase/serverless");

let _sql;
const sql = () => (_sql = _sql || neon(process.env.DATABASE_URL));

const sha256 = s => crypto.createHash("sha256").update(s).digest("hex");

function enviar(res, status, corpo) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.end(JSON.stringify(corpo));
}
const erro = (res, status, codigo, msg, extra) => enviar(res, status, { ok: false, erro: codigo, msg, ...extra });

function corpo(req) {
  const b = req.body;
  if (b && typeof b === "object") return b;
  try { return JSON.parse(b || "{}"); } catch (e) { return null; }
}

/* GTIN-8/12/13/14 com dígito verificador (GS1, módulo 10) */
function gtinValido(g) {
  if (typeof g !== "string" || !/^\d+$/.test(g) || ![8, 12, 13, 14].includes(g.length)) return false;
  let soma = 0;
  for (let i = g.length - 2, p = 3; i >= 0; i--, p = p === 3 ? 1 : 3) soma += +g[i] * p;
  return (10 - (soma % 10)) % 10 === +g[g.length - 1];
}

/* chave do mercado: "Authorization: Bearer lc_live_..." ou "X-API-Key" */
async function autenticar(req) {
  const h = req.headers.authorization || "";
  const k = (h.startsWith("Bearer ") ? h.slice(7) : req.headers["x-api-key"] || "").trim();
  if (!/^lc_(live|test)_[0-9a-f]{32}$/.test(k)) return null;
  const r = await sql().query(
    `select m.id, m.nome, m.cidade, c.ambiente from chaves_api c join mercados m on m.id = c.mercado_id
     where c.hash = $1 and c.revogada_em is null and m.ativo`, [sha256(k)]);
  return r[0] || null;
}

/* Admin: header "x-admin-key" tem que bater com a env ADMIN_KEY (sem ela, ninguém entra). */
function admin(req) {
  const dado = String(req.headers["x-admin-key"] || "");
  const k = process.env.ADMIN_KEY;
  return !!k && crypto.timingSafeEqual(Buffer.from(sha256(k)), Buffer.from(sha256(dado)));
}

module.exports = { sql, sha256, enviar, erro, corpo, gtinValido, autenticar, admin, crypto };
