/* GET /api/versao -> { v } muda a CADA deploy (id do deploy na Vercel). O atualizacao.js compara para avisar "nova versão". */
module.exports = (req, res) => {
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify({ v: process.env.VERCEL_DEPLOYMENT_ID || process.env.VERCEL_GIT_COMMIT_SHA || "local" }));
};
