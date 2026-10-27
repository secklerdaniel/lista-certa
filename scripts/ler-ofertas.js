/* Lê imagens de ofertas (posts do Instagram) com o Gemini e grava ofertas.json no formato do painel > Ofertas, para REVISÃO.
   Não grava no banco. Depois de conferir o JSON, envie pelo admin (ou pelo carregar de ofertas).
   Mercado e cidade vêm do cabeçalho de cada imagem (ex.: "Dia Após Dia / Gramado"), a validade vem da arte.
   Rodar: node --env-file=../../.env.local scripts/ler-ofertas.js <pasta-com-imagens> */
const fs = require("fs"), path = require("path");
const { CATEGORIAS } = require("../api/_ia");

const MODEL = "gemini-flash-latest";
const MIME = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };
const UNIDADES = ["kg", "g", "l", "ml", "un", "m", "dz"];

const ESQUEMA = {
  type: "ARRAY",
  items: {
    type: "OBJECT",
    properties: {
      mercado: { type: "STRING", description: "Nome do supermercado, do cabeçalho/logo da imagem (ex.: 'Dia Após Dia', 'Multi Serrano'). Ignore 'Sacolista'." },
      cidade: { type: "STRING", description: "Cidade do cabeçalho da imagem (Gramado ou Canela)." },
      produto: { type: "STRING", description: "Nome por extenso, sem marca e sem tamanho, capitalização normal. Ex.: 'Coxão Mole', 'Leite Integral'." },
      marca: { type: "STRING", description: "Marca se aparecer na imagem; senão vazio." },
      quantidade: { type: "NUMBER", description: "Quantidade da embalagem (1 para 1 kg, 500 para 500 g). 0 se não aparecer." },
      unidade: { type: "STRING", enum: UNIDADES },
      preco: { type: "NUMBER", description: "Preço de oferta em reais, em número. Ex.: 19.9" },
      categoria: { type: "STRING", enum: CATEGORIAS },
      valido_ate: { type: "STRING", description: "Último dia da oferta em AAAA-MM-DD, se a arte tiver data (se não tiver o ano, use 2026). Vazio se não houver." },
      validade: { type: "STRING", description: "Texto de validade/condição impresso (ex.: 'Enquanto durarem os estoques', 'Seg e ter'); vazio se não houver." },
    },
    required: ["mercado", "cidade", "produto", "valido_ate", "marca", "quantidade", "unidade", "preco", "categoria", "validade"],
  },
};

const INSTRUCAO = [
  "O cabeçalho amarelo no topo traz o mercado e a cidade; o rodapé preto é de um agregador e deve ser ignorado.",
  "Preços podem vir com os centavos pequenos ao lado (ex.: 2 .48 = 2,48). Para produtos de hortifrúti, a unidade impressa (un/kg) é a unidade do preço.",
  "Você lê imagens de ofertas de supermercados brasileiros publicadas no Instagram.",
  "Extraia TODOS os produtos com preço legíveis. Nunca adivinhe nome, marca, tamanho ou preço; se não dá para ler, ignore o item.",
  "Preço é o valor de oferta em destaque. Itens por peso: preço por kg, quantidade 1, unidade kg.",
  "Se houver 'leve X pague Y' ou condição (ex.: só com cartão do clube), ponha a condição em 'validade' junto do texto de validade.",
].join("\n");

async function ler(arquivo) {
  const parte = { inlineData: { mimeType: MIME[path.extname(arquivo).toLowerCase()], data: fs.readFileSync(arquivo).toString("base64") } };
  let r;
  for (let t = 0; t < 4; t++) { /* 503 passa: tenta de novo com espera (429 não: é cota, repetir só gasta mais) */
    r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY },
      body: JSON.stringify({
        contents: [{ parts: [{ text: INSTRUCAO }, parte] }],
        generationConfig: { temperature: 0, responseMimeType: "application/json", responseSchema: ESQUEMA },
      }),
    });
    if (r.status !== 503) break;
    await new Promise(ok => setTimeout(ok, 8000 * (t + 1)));
  }
  if (!r.ok) throw new Error(`gemini ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const j = await r.json();
  return JSON.parse(j.candidates?.[0]?.content?.parts?.[0]?.text || "[]");
}

(async () => {
  const [pasta] = process.argv.slice(2);
  if (!pasta) { console.error("Uso: node scripts/ler-ofertas.js <pasta>"); process.exit(1); }
  if (!process.env.GEMINI_API_KEY) { console.error("Falta GEMINI_API_KEY (use --env-file=../../.env.local)."); process.exit(1); }
  const arquivos = fs.readdirSync(pasta).filter(f => MIME[path.extname(f).toLowerCase()]).sort();
  const saida = [], falhas = [];
  for (const f of arquivos) {
    if (saida.length || falhas.length) await new Promise(ok => setTimeout(ok, 13000)); /* free tier: 5 req/min */
    try {
      const itens = await ler(path.join(pasta, f));
      for (const x of itens) {
        const preco = Math.round(Number(x.preco) * 100) / 100;
        if (!x.produto || !x.mercado || !x.cidade || !(preco > 0)) continue;
        saida.push({
          mercado: x.mercado.trim(), cidade: x.cidade.trim(), categoria: x.categoria, produto_normalizado: x.produto.trim(), marca: x.marca?.trim() || null,
          quantidade: x.quantidade > 0 ? x.quantidade : null, unidade_medida: x.quantidade > 0 ? x.unidade : null, preco,
          valido_de: null, valido_ate: /^\d{4}-\d{2}-\d{2}$/.test(x.valido_ate) ? x.valido_ate : null, observacao: x.validade?.trim() || null, _arquivo: f,
        });
      }
      console.log(`${f}: ${itens.length} itens`);
    } catch (e) { falhas.push(f); console.error(`${f}: ${e.message}`); }
  }
  const destino = path.join(pasta, "ofertas.json");
  fs.writeFileSync(destino, JSON.stringify(saida, null, 1));
  console.log(`\n${saida.length} ofertas -> ${destino}${falhas.length ? ` (falharam: ${falhas.join(", ")})` : ""}`);
})();
