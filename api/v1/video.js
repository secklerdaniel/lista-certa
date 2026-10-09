/* POST /api/v1/video  { frames: ["data:image/jpeg;base64,...", ...] }  (até 6 por chamada)
   Lê as etiquetas de preço das prateleiras com visão (OpenAI) e devolve os itens para REVISÃO.
   Não grava nada: quem confirma é a pessoa, em /api/v1/coletas.
   Público (sem chave), com limite por IP porque cada chamada custa dinheiro. Precisa de OPENAI_API_KEY. */
const { sql, sha256, enviar, erro, corpo, gtinValido } = require("../_lib");

const MODEL = "gpt-4o";
const MAX_FRAMES = 6, MAX_BYTES = 1_200_000, LIMITE_HORA = 24;

const FERRAMENTA = {
  type: "function",
  function: {
    name: "extrair_etiquetas",
    description: "Lista as etiquetas de preço de prateleira que dá para LER nas imagens.",
    parameters: {
      type: "object",
      properties: {
        etiquetas: {
          type: "array",
          items: {
            type: "object",
            properties: {
              imagem: { type: "integer", description: "Índice da imagem (começando em 0) em que a etiqueta aparece." },
              descricao: { type: "string", description: "Nome do produto como está impresso na etiqueta." },
              preco: { type: "number", description: "O preço PRINCIPAL da etiqueta (o grande), em reais. Nunca o preço por kg/litro em letra pequena." },
              preco_promocional: { type: "number", description: "Preço de oferta, se a etiqueta mostrar oferta/promoção. 0 se não houver." },
              gtin: { type: "string", description: "Código de barras SOMENTE se os dígitos estiverem impressos e legíveis na etiqueta. Senão vazio." },
              confianca: { type: "string", enum: ["alta", "media", "baixa"], description: "alta = nome e preço nítidos; baixa = chute." },
            },
            required: ["imagem", "descricao", "preco", "preco_promocional", "gtin", "confianca"],
          },
        },
      },
      required: ["etiquetas"],
    },
  },
};

const INSTRUCAO = [
  "Você lê etiquetas de preço de gôndola em supermercados brasileiros, a partir de quadros de um vídeo.",
  "Extraia SOMENTE etiquetas que você consegue ler com clareza. Se estiver borrada, cortada ou ilegível, ignore. Nunca adivinhe nome, preço ou código.",
  "O 'preco' é o valor grande da etiqueta para a embalagem. O texto pequeno 'R$/kg', 'preço por litro' ou 'unidade' NÃO é o preço.",
  "Etiquetas amarelas/vermelhas de oferta: o valor de oferta vai em 'preco_promocional' e o 'preco' é o valor normal, se aparecer; se só aparecer um valor, ponha-o em 'preco' e deixe a promoção 0.",
  "Não leia preços de produtos que não tenham etiqueta. A mesma etiqueta em quadros diferentes deve aparecer uma vez só.",
].join("\n");

async function limite(ip) {
  const r = await sql().query(`select count(*)::int as n from uso_publico where ip_hash = $1 and tipo = 'video' and em > now() - interval '1 hour'`, [ip]);
  if (r[0].n >= LIMITE_HORA) return false;
  await sql().query(`insert into uso_publico (ip_hash, tipo) values ($1, 'video')`, [ip]);
  return true;
}

function limpar(lista, nFrames) {
  const vistos = new Set(), saida = [];
  for (const e of lista || []) {
    const descricao = typeof e.descricao === "string" ? e.descricao.replace(/\s+/g, " ").trim().slice(0, 100) : "";
    const preco = Math.round(Number(e.preco) * 100) / 100;
    if (!descricao || !(preco > 0 && preco < 10000)) continue;
    let promo = Math.round(Number(e.preco_promocional) * 100) / 100;
    if (!(promo > 0 && promo < preco)) promo = null;
    const gtin = typeof e.gtin === "string" ? e.gtin.replace(/\D/g, "") : "";
    const chave = (gtinValido(gtin) ? gtin : descricao.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")) + "|" + preco;
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    saida.push({ descricao, preco, promocao: promo, gtin: gtinValido(gtin) ? gtin : null, confianca: ["alta", "media", "baixa"].includes(e.confianca) ? e.confianca : "baixa", imagem: Number.isInteger(e.imagem) && e.imagem >= 0 && e.imagem < nFrames ? e.imagem : null });
  }
  return saida;
}

async function lerEtiquetas(frames, fetchFn = fetch) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 25000);
  try {
    const r = await fetchFn("https://api.openai.com/v1/chat/completions", {
      method: "POST", signal: ctl.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: MODEL, temperature: 0,
        messages: [{ role: "user", content: [{ type: "text", text: INSTRUCAO + `\n\nSão ${frames.length} imagens, índices 0 a ${frames.length - 1}.` },
          ...frames.map(f => ({ type: "image_url", image_url: { url: f, detail: "high" } }))] }],
        tools: [FERRAMENTA], tool_choice: { type: "function", function: { name: "extrair_etiquetas" } },
      }),
    });
    if (!r.ok) throw new Error("openai_" + r.status);
    const j = await r.json();
    const args = j.choices && j.choices[0] && j.choices[0].message.tool_calls && j.choices[0].message.tool_calls[0].function.arguments;
    return limpar((JSON.parse(args || "{}")).etiquetas, frames.length);
  } finally { clearTimeout(t); }
}

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") { res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS"); res.setHeader("Access-Control-Allow-Headers", "Content-Type"); res.statusCode = 204; return res.end(); }
  if (req.method !== "POST") return erro(res, 405, "metodo", "Use POST.");
  if (!process.env.OPENAI_API_KEY) return erro(res, 503, "ia_indisponivel", "Leitura por IA indisponível no momento.");
  const b = corpo(req);
  const frames = b && Array.isArray(b.frames) ? b.frames : null;
  if (!frames || !frames.length) return erro(res, 400, "frames", 'Envie "frames": lista de imagens JPEG em base64 (data URL).');
  if (frames.length > MAX_FRAMES) return erro(res, 413, "frames_demais", `No máximo ${MAX_FRAMES} imagens por chamada.`);
  if (!frames.every(f => typeof f === "string" && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(f) && f.length < MAX_BYTES)) return erro(res, 400, "frames_invalidos", "Cada imagem deve ser JPEG em base64 com menos de ~900 KB.");
  try {
    const ip = sha256(String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "?").split(",")[0].trim() + "|lc");
    if (!(await limite(ip))) return erro(res, 429, "limite", "Muitos vídeos em pouco tempo. Tente de novo mais tarde.");
    const itens = await lerEtiquetas(frames);
    enviar(res, 200, { ok: true, total: itens.length, itens });
  } catch (e) {
    erro(res, e.name === "AbortError" ? 504 : 502, "ia", "Não consegui ler as imagens agora. Tente de novo.");
  }
};
module.exports.limpar = limpar;
module.exports.lerEtiquetas = lerEtiquetas;
