/* Login com Google (Google Identity Services) + sessão própria em cookie assinado.
   O navegador recebe um ID token do Google; aqui ele é VERIFICADO (assinatura, emissor, público, validade)
   e vira um cookie HttpOnly. O segredo do cookie é derivado da DATABASE_URL (não precisa de env extra). */
const crypto = require("crypto");
const { sql, sha256 } = require("./_lib");

/* Client ID público (não é segredo) — o mesmo da tela "Credenciais" do Google Cloud */
const clientId = () => process.env.GOOGLE_CLIENT_ID || require("./_config").googleClientId || "";

const segredo = () => sha256((process.env.DATABASE_URL || "") + "|lc-sessao");
const DIAS = 60;

function assinar(p) {
  const c = Buffer.from(JSON.stringify(p)).toString("base64url");
  return c + "." + crypto.createHmac("sha256", segredo()).update(c).digest("base64url");
}
function ler(tok) {
  if (!tok || typeof tok !== "string") return null;
  const [c, m] = tok.split(".");
  if (!c || !m) return null;
  const esp = crypto.createHmac("sha256", segredo()).update(c).digest("base64url");
  const a = Buffer.from(m), b = Buffer.from(esp);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(c, "base64url").toString());
    return p.exp && p.exp > Date.now() / 1000 ? p : null;
  } catch (e) { return null; }
}
function cookie(req, nome) {
  const m = (req.headers.cookie || "").split(/;\s*/).find(x => x.startsWith(nome + "="));
  return m ? m.slice(nome.length + 1) : null;
}
function abrirSessao(res, uid) {
  res.setHeader("Set-Cookie", `lc_sess=${assinar({ uid, exp: Math.floor(Date.now() / 1000) + DIAS * 86400 })}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${DIAS * 86400}`);
}
function fecharSessao(res) { res.setHeader("Set-Cookie", "lc_sess=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0"); }

/* "Daniel Seckler" -> "Daniel S." */
function nomeCurto(nome) {
  const p = String(nome || "").trim().split(/\s+/).filter(Boolean);
  if (!p.length) return "Anônimo";
  return p.length > 1 ? `${p[0]} ${p[p.length - 1][0].toUpperCase()}.` : p[0];
}

async function usuario(req) {
  const p = ler(cookie(req, "lc_sess"));
  if (!p) return null;
  const r = await sql().query(`select id, nome, email, foto from usuarios where id = $1`, [p.uid]);
  return r[0] || null;
}
async function pontos(uid) {
  const r = await sql().query(`select count(*)::int as n from contribuicoes where usuario_id = $1`, [uid]);
  return r[0].n;
}
const nivel = n => (n > 20 ? "ouro" : n > 10 ? "prata" : "bronze");

/* valida o ID token do Google; `jwks` pode ser trocado em teste */
async function verificarGoogle(idToken, jwks) {
  const id = clientId();
  if (!id) throw new Error("sem_client_id");
  const { jwtVerify, createRemoteJWKSet } = await import("jose");
  const chaves = jwks || createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
  const { payload } = await jwtVerify(idToken, chaves, { issuer: ["https://accounts.google.com", "accounts.google.com"], audience: id });
  if (!payload.sub) throw new Error("sem_sub");
  return { sub: payload.sub, nome: payload.name || payload.given_name || "Usuário", email: payload.email || null, foto: payload.picture || null };
}

module.exports = { clientId, abrirSessao, fecharSessao, usuario, pontos, nivel, nomeCurto, verificarGoogle, assinar, ler };
