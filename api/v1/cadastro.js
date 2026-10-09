/* POST /api/v1/cadastro  { nome, cidade, email, cnpj? }
   Cadastro ABERTO: qualquer mercado se cadastra e recebe as chaves (teste e produção) na hora, sem aprovação.
   Limite por IP; CNPJ (se informado) precisa ser válido e não pode já estar cadastrado.
   A equipe pode desativar qualquer mercado depois em /admin. */
const { sql, sha256, enviar, erro, corpo, crypto } = require("../_lib");

const LIMITE_DIA = 5;

function cnpjValido(c) {
  c = String(c || "").replace(/\D/g, "");
  if (c.length !== 14 || /^(\d)\1+$/.test(c)) return false;
  const dv = n => { let s = 0, p = n - 7; for (let i = 0; i < n; i++) { s += +c[i] * p--; if (p < 2) p = 9; } const r = s % 11; return r < 2 ? 0 : 11 - r; };
  return dv(12) === +c[12] && dv(13) === +c[13];
}
async function chave(mercadoId, amb) {
  const k = `lc_${amb === "teste" ? "test" : "live"}_${crypto.randomBytes(16).toString("hex")}`;
  await sql().query(`insert into chaves_api (mercado_id, prefixo, hash, ambiente) values ($1, $2, $3, $4)`, [mercadoId, k.slice(0, 12), sha256(k), amb]);
  return k;
}

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") { res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS"); res.setHeader("Access-Control-Allow-Headers", "Content-Type"); res.statusCode = 204; return res.end(); }
  if (req.method !== "POST") return erro(res, 405, "metodo", "Use POST.");
  const b = corpo(req) || {};
  const nome = typeof b.nome === "string" ? b.nome.replace(/\s+/g, " ").trim() : "";
  const cidade = typeof b.cidade === "string" ? b.cidade.replace(/\s+/g, " ").trim() : "";
  const email = typeof b.email === "string" ? b.email.trim().toLowerCase() : "";
  const cnpj = b.cnpj ? String(b.cnpj).replace(/\D/g, "") : null;
  if (nome.length < 3 || nome.length > 120) return erro(res, 400, "nome", "Informe o nome do mercado (3 a 120 caracteres).");
  if (cidade.length < 2 || cidade.length > 80) return erro(res, 400, "cidade", "Informe a cidade.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 160) return erro(res, 400, "email", "Informe um e-mail válido para contato.");
  if (cnpj && !cnpjValido(cnpj)) return erro(res, 400, "cnpj", "CNPJ inválido. Confira os 14 dígitos ou deixe em branco.");
  try {
    const ip = sha256(String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "?").split(",")[0].trim() + "|lc");
    const u = await sql().query(`select count(*)::int as n from uso_publico where ip_hash = $1 and tipo = 'cadastro' and em > now() - interval '1 day'`, [ip]);
    if (u[0].n >= LIMITE_DIA) return erro(res, 429, "limite", "Muitos cadastros deste endereço hoje. Tente amanhã ou fale com a equipe.");
    if (cnpj) {
      const ja = await sql().query(`select id from mercados where cnpj = $1`, [cnpj]);
      if (ja.length) return erro(res, 409, "cnpj_ja_cadastrado", "Esse CNPJ já está cadastrado. Para recuperar o acesso, fale com a equipe.");
    }
    await sql().query(`insert into uso_publico (ip_hash, tipo) values ($1, 'cadastro')`, [ip]);
    const m = await sql().query(`insert into mercados (nome, cnpj, cidade, email, origem) values ($1, $2, $3, $4, 'autocadastro') returning id, nome, cidade`, [nome.slice(0, 120), cnpj, cidade.slice(0, 80), email]);
    const chaves = { teste: await chave(m[0].id, "teste"), producao: await chave(m[0].id, "producao") };
    enviar(res, 201, {
      ok: true, mercado: m[0], chaves,
      aviso: "Guarde as chaves agora: elas não são mostradas de novo.",
      proximosPassos: ["Integre usando a chave de TESTE (ambiente separado, nada aparece para os consumidores).", "Quando estiver tudo certo, troque para a chave de PRODUÇÃO.", "Documentação: /docs"],
    });
  } catch (e) {
    erro(res, 500, "interno", "Erro interno. Tente de novo em instantes.");
  }
};
module.exports.cnpjValido = cnpjValido;
