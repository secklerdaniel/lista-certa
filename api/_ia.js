/* Resolve "nome sujo do ERP" -> produto limpo, com IA (OpenAI, padrão da casa: chat/completions + função).
   Precisa da env OPENAI_API_KEY; sem ela, não faz nada e o app cai no casamento por nome. */
const { sql } = require("./_lib");
const CATALOGO = require("./_catalogo");

const MODEL = "gpt-4o-mini";
const LOTE = 40;
const CATEGORIAS = ["mercearia", "laticinios", "hortifruti", "carnes", "bebidas", "limpeza", "higiene", "padaria", "frios", "congelados", "outros"];
const UNIDADES = ["g", "kg", "ml", "l", "un"];

const FERRAMENTA = {
  type: "function",
  function: {
    name: "classificar_produtos",
    description: "Para cada produto da lista, devolve o produto limpo e, se for o mesmo item do catálogo, o id dele.",
    parameters: {
      type: "object",
      properties: {
        produtos: {
          type: "array",
          items: {
            type: "object",
            properties: {
              indice: { type: "integer", description: "Índice do produto na lista recebida." },
              nome: { type: "string", description: "Nome limpo e legível, SEM marca e SEM tamanho. Ex.: 'Leite integral', 'Biscoito maria'." },
              marca: { type: "string", description: "Marca, ou vazio se não houver/for incerta." },
              quantidade: { type: "number", description: "Quantidade de UMA unidade vendida (ex.: 1 para 1 L, 500 para 500 g). 0 se desconhecida." },
              unidade: { type: "string", enum: UNIDADES, description: "Unidade da quantidade. 'un' para itens contados." },
              categoria: { type: "string", enum: CATEGORIAS },
              catalogo_id: { type: "integer", description: "id do item do catálogo SOMENTE se for o mesmo tipo de produto E a mesma embalagem/tamanho do catálogo (marca é irrelevante). Se houver dúvida, -1." },
            },
            required: ["indice", "nome", "marca", "quantidade", "unidade", "categoria", "catalogo_id"],
          },
        },
      },
      required: ["produtos"],
    },
  },
};

function prompt(itens) {
  return [
    "Você normaliza descrições de produtos de supermercado brasileiro vindas de sistemas de PDV/ERP (abreviadas, em caixa alta, com marca e tamanho misturados).",
    "Regras:",
    "- 'nome' sem marca e sem tamanho, em português, capitalização normal.",
    "- 'catalogo_id' só quando for o MESMO tipo de produto e o MESMO tamanho/embalagem do catálogo (marca não importa). Caixa com 12 unidades, tamanho diferente ou dúvida => -1.",
    "- Item vendido por peso (kg) só casa com item de catálogo em kg.",
    "- Nunca invente marca; na dúvida, deixe vazia.",
    "",
    "CATÁLOGO (id | nome | embalagem):",
    ...CATALOGO.map(c => `${c[0]} | ${c[1]} | ${c[2]}`),
    "",
    "PRODUTOS (índice | gtin | descrição | unidade comercial):",
    ...itens.map((x, i) => `${i} | ${x.gtin} | ${x.descricao || "(sem descrição)"} | ${x.unidade || "UN"}`),
  ].join("\n");
}

async function chamar(itens, fetchFn = fetch) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 20000);
  try {
    const r = await fetchFn("https://api.openai.com/v1/chat/completions", {
      method: "POST", signal: ctl.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({ model: MODEL, temperature: 0, messages: [{ role: "user", content: prompt(itens) }], tools: [FERRAMENTA], tool_choice: { type: "function", function: { name: "classificar_produtos" } } }),
    });
    if (!r.ok) return [];
    const j = await r.json();
    const args = j.choices && j.choices[0] && j.choices[0].message.tool_calls && j.choices[0].message.tool_calls[0].function.arguments;
    return (JSON.parse(args || "{}").produtos) || [];
  } finally { clearTimeout(t); }
}

/* valida o que a IA devolveu: id inventado cai, unidade/categoria fora da lista caem */
function limpar(p, item) {
  const nome = typeof p.nome === "string" ? p.nome.trim().slice(0, 80) : "";
  if (!nome || !item) return null;
  const cat = Number.isInteger(p.catalogo_id) && CATALOGO.some(c => c[0] === p.catalogo_id) ? p.catalogo_id : null;
  return {
    gtin: item.gtin, nome,
    marca: typeof p.marca === "string" && p.marca.trim() ? p.marca.trim().slice(0, 60) : null,
    quantidade: Number.isFinite(p.quantidade) && p.quantidade > 0 ? p.quantidade : null,
    unidade: UNIDADES.includes(p.unidade) ? p.unidade : null,
    categoria: CATEGORIAS.includes(p.categoria) ? p.categoria : "outros",
    catalogo_id: cat,
  };
}

/* resolve até LOTE produtos ainda sem cadastro em `produtos` (os novos + o que ficou pendente) */
async function resolverPendentes(fetchFn) {
  if (!process.env.OPENAI_API_KEY && !fetchFn) return { resolvidos: 0, motivo: "sem_chave" };
  const pend = await sql().query(
    `select p.gtin, max(p.descricao) as descricao, max(p.unidade) as unidade
       from precos p left join produtos pr on pr.gtin = p.gtin
      where pr.gtin is null and p.ambiente = 'producao' group by p.gtin limit ${LOTE}`);
  if (!pend.length) return { resolvidos: 0 };
  const saida = (await chamar(pend, fetchFn)).map(p => limpar(p, pend[p.indice])).filter(Boolean);
  for (const s of saida) {
    await sql().query(
      `insert into produtos (gtin, nome, marca, quantidade, unidade, categoria, catalogo_id) values ($1,$2,$3,$4,$5,$6,$7)
       on conflict (gtin) do nothing`, [s.gtin, s.nome, s.marca, s.quantidade, s.unidade, s.categoria, s.catalogo_id]);
  }
  return { resolvidos: saida.length, pendentesNaFila: pend.length - saida.length };
}

/* Só a categoria, a partir da descrição do cupom/etiqueta (sem GTIN). Devolve um array do mesmo tamanho; null onde não classificou
   (sem chave, falha ou lote que não respondeu). Quem chama grava null e o script scripts/categorizar.js completa depois. */
const FERR_CAT = {
  type: "function",
  function: {
    name: "categorizar",
    description: "Categoria de cada produto da lista.",
    parameters: { type: "object", properties: { itens: { type: "array", items: { type: "object",
      properties: { indice: { type: "integer" }, categoria: { type: "string", enum: CATEGORIAS } }, required: ["indice", "categoria"] } } }, required: ["itens"] },
  },
};
async function categorizar(descs, fetchFn = fetch, limiteMs = 8000) {
  const out = descs.map(() => null);
  if (!process.env.OPENAI_API_KEY && fetchFn === fetch) return out;
  for (let i = 0; i < descs.length; i += 100) {
    const lote = descs.slice(i, i + 100), ctl = new AbortController(), t = setTimeout(() => ctl.abort(), limiteMs);
    try {
      const r = await fetchFn("https://api.openai.com/v1/chat/completions", {
        method: "POST", signal: ctl.signal,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
        body: JSON.stringify({ model: MODEL, temperature: 0, tools: [FERR_CAT], tool_choice: { type: "function", function: { name: "categorizar" } },
          messages: [{ role: "user", content: "Classifique cada descrição de produto de supermercado brasileiro (abreviada, em caixa alta) em UMA categoria. Use 'outros' só se nenhuma servir.\n" + lote.map((d, k) => `${k} | ${d}`).join("\n") }] }),
      });
      if (!r.ok) continue;
      const j = await r.json(), a = j.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
      for (const x of JSON.parse(a || "{}").itens || []) if (CATEGORIAS.includes(x.categoria) && lote[x.indice] != null) out[i + x.indice] = x.categoria;
    } catch (e) { /* fica null */ } finally { clearTimeout(t); }
  }
  return out;
}

module.exports = { resolverPendentes, limpar, prompt, categorizar, CATEGORIAS };
