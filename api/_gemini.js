/* Lê imagens de ofertas (posts do Instagram, folhetos) com o Gemini e devolve itens no formato da tabela ofertas, para REVISÃO.
   Não grava nada. Precisa da env GEMINI_API_KEY. Usado por api/admin/usuarios.js (aba Ofertas) e por scripts/ler-ofertas.js. */
const { CATEGORIAS } = require("./_ia");

const MODEL = "gemini-flash-latest";
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
  "Você lê imagens de ofertas de supermercados brasileiros publicadas no Instagram.",
  "O cabeçalho amarelo no topo traz o mercado e a cidade; o rodapé preto é de um agregador e deve ser ignorado.",
  "Preços podem vir com os centavos pequenos ao lado (ex.: 2 .48 = 2,48). Para produtos de hortifrúti, a unidade impressa (un/kg) é a unidade do preço.",
  "Extraia TODOS os produtos com preço legíveis. Nunca adivinhe nome, marca, tamanho ou preço; se não dá para ler, ignore o item.",
  "Preço é o valor de oferta em destaque. Itens por peso: preço por kg, quantidade 1, unidade kg.",
  "Se houver 'leve X pague Y' ou condição (ex.: só com cartão do clube), ponha a condição em 'validade' junto do texto de validade.",
].join("\n");

const espera = ms => new Promise(ok => setTimeout(ok, ms));

/* mime: image/jpeg|png|webp; base64: conteúdo sem o prefixo data:. Lança Error com .status (429 = cota, 502 = falha). */
async function lerImagem(mime, base64) {
  let r;
  for (let t = 0; t < 3; t++) { /* 503 (alta demanda) passa: tenta de novo; 429 é cota, repetir só gasta mais */
    r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY },
      body: JSON.stringify({
        contents: [{ parts: [{ text: INSTRUCAO }, { inlineData: { mimeType: mime, data: base64 } }] }],
        generationConfig: { temperature: 0, responseMimeType: "application/json", responseSchema: ESQUEMA },
      }),
    });
    if (r.status !== 503) break;
    await espera(4000 * (t + 1));
  }
  if (!r.ok) { const e = new Error(r.status === 429 ? "Cota do Gemini esgotada. Tente mais tarde." : `Gemini respondeu ${r.status}.`); e.status = r.status === 429 ? 429 : 502; throw e; }
  const j = await r.json();
  return normalizar(JSON.parse(j.candidates?.[0]?.content?.parts?.[0]?.text || "[]"));
}

function normalizar(lista) {
  const saida = [];
  for (const x of lista || []) {
    const preco = Math.round(Number(x.preco) * 100) / 100, produto = String(x.produto || "").trim();
    if (!produto || !(preco > 0)) continue;
    const qtd = Number(x.quantidade) > 0 ? Number(x.quantidade) : null;
    saida.push({
      mercado: String(x.mercado || "").trim(), cidade: String(x.cidade || "").trim(), categoria: CATEGORIAS.includes(x.categoria) ? x.categoria : null,
      produto_normalizado: produto, marca: String(x.marca || "").trim() || null, quantidade: qtd, unidade_medida: qtd && UNIDADES.includes(x.unidade) ? x.unidade : null,
      preco, valido_de: null, valido_ate: /^\d{4}-\d{2}-\d{2}$/.test(x.valido_ate) ? x.valido_ate : null, observacao: String(x.validade || "").trim() || null,
    });
  }
  return saida;
}

module.exports = { lerImagem, MODEL };
