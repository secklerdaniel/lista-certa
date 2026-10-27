/* Lê imagens de ofertas (posts do Instagram) com o Gemini e grava ofertas.json no formato do painel > Ofertas, para REVISÃO.
   Não grava no banco. (A aba Ofertas do admin faz o mesmo direto no navegador: sobe as imagens, confere e salva.)
   Rodar: node --env-file=../../.env.local scripts/ler-ofertas.js <pasta-com-imagens> */
const fs = require("fs"), path = require("path");
const { lerImagem } = require("../api/_gemini");

const MIME = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };

(async () => {
  const [pasta] = process.argv.slice(2);
  if (!pasta) { console.error("Uso: node scripts/ler-ofertas.js <pasta>"); process.exit(1); }
  if (!process.env.GEMINI_API_KEY) { console.error("Falta GEMINI_API_KEY (use --env-file=../../.env.local)."); process.exit(1); }
  const arquivos = fs.readdirSync(pasta).filter(f => MIME[path.extname(f).toLowerCase()]).sort();
  const saida = [], falhas = [];
  for (const f of arquivos) {
    try {
      const itens = await lerImagem(MIME[path.extname(f).toLowerCase()], fs.readFileSync(path.join(pasta, f)).toString("base64"));
      itens.forEach(x => saida.push(Object.assign(x, { _arquivo: f })));
      console.log(`${f}: ${itens.length} itens`);
    } catch (e) { falhas.push(f); console.error(`${f}: ${e.message}`); }
  }
  const destino = path.join(pasta, "ofertas.json");
  fs.writeFileSync(destino, JSON.stringify(saida, null, 1));
  console.log(`\n${saida.length} ofertas -> ${destino}${falhas.length ? ` (falharam: ${falhas.join(", ")})` : ""}`);
})();
