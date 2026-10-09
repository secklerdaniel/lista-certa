/* Conta do MERCADO: e-mail + senha, separada dos usuários do app (que entram com o Google).
   Senha guardada só como hash (scrypt, com sal). Sessão em cookie próprio (lc_mkt), HttpOnly e assinado. */
const crypto = require("crypto");
const { sql } = require("./_lib");
const A = require("./_auth");

const DIAS = 30, N = 16384;

function hashSenha(senha) {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(senha, salt, 64, { N, r: 8, p: 1 });
  return `scrypt$${salt.toString("base64url")}$${h.toString("base64url")}`;
}
function confere(senha, guardado) {
  const [tipo, salt, h] = String(guardado || "").split("$");
  if (tipo !== "scrypt" || !salt || !h) return false;
  const esp = Buffer.from(h, "base64url");
  const got = crypto.scryptSync(senha, Buffer.from(salt, "base64url"), esp.length, { N, r: 8, p: 1 });
  return got.length === esp.length && crypto.timingSafeEqual(got, esp);
}
function cookie(req, nome) {
  const m = (req.headers.cookie || "").split(/;\s*/).find(x => x.startsWith(nome + "="));
  return m ? m.slice(nome.length + 1) : null;
}
function abrir(res, contaId) {
  const tok = A.assinar({ cid: contaId, k: "m", exp: Math.floor(Date.now() / 1000) + DIAS * 86400 });
  res.setHeader("Set-Cookie", `lc_mkt=${tok}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${DIAS * 86400}`);
}
function fechar(res) { res.setHeader("Set-Cookie", "lc_mkt=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0"); }
async function conta(req) {
  const p = A.ler(cookie(req, "lc_mkt"));
  if (!p || p.k !== "m") return null;
  const r = await sql().query(`select id, email from mercado_contas where id = $1`, [p.cid]);
  return r[0] || null;
}
const senhaOk = s => typeof s === "string" && s.length >= 8 && s.length <= 72;

module.exports = { hashSenha, confere, abrir, fechar, conta, senhaOk };
