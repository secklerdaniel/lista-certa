/* Sobe para a tabela "ofertas" o ofertas.json que o scripts/ler-ofertas.js gerou (a mesma carga da aba Ofertas do admin).
   Padrão: modo "produto" — troca só o MESMO produto (mercado, cidade, nome, marca e tamanho); o resto do mercado fica.
   Rodar: node --env-file=.env.local scripts/subir-ofertas.js <ofertas.json> [--mercado|--acrescentar]
   Conferir a regra de cidade sem subir nada: node scripts/subir-ofertas.js --teste */
const fs = require("fs");

/* Arte de rede sai com uma cidade por loja ("Gramado e Canela"): vira uma oferta para cada. */
const cidades = c => String(c || "").split(/\s+e\s+|\s*[\/,]\s*/).map(s => s.trim()).filter(Boolean);

if (process.argv.includes("--teste")) {
  const a = require("assert");
  a.deepStrictEqual(cidades("Gramado e Canela"), ["Gramado", "Canela"]);
  a.deepStrictEqual(cidades("Gramado/Canela"), ["Gramado", "Canela"]);
  a.deepStrictEqual(cidades("Gramado"), ["Gramado"]);
  a.deepStrictEqual(cidades(""), []);
  return console.log("ok");
}

(async () => {
  const [arquivo] = process.argv.slice(2).filter(a => !a.startsWith("--"));
  if (!arquivo) { console.error("Uso: node --env-file=.env.local scripts/subir-ofertas.js <ofertas.json>"); process.exit(1); }
  if (!process.env.DATABASE_URL) { console.error("Falta DATABASE_URL (use --env-file=.env.local)."); process.exit(1); }
  const { carregar } = require("../api/_ofertas");

  const lista = [];
  for (const { _arquivo, ...o } of JSON.parse(fs.readFileSync(arquivo, "utf8")))
    for (const cidade of cidades(o.cidade)) lista.push({ ...o, cidade });

  const modo = process.argv.includes("--mercado") ? "mercado" : "produto";
  const r = await carregar(lista, process.argv.includes("--acrescentar"), modo);
  if (r.status !== 200) { console.error(r.status, r.msg); console.error(r.rejeitados); process.exit(1); }
  console.log(`modo ${modo}: ${r.inseridas} inseridas, ${r.substituidas} substituídas`);
  console.table(r.porMercado);
  (r.rejeitados || []).forEach(x => console.error(`rejeitada linha ${x.linha} (${x.produto}): ${x.erro}`));
  (r.avisos || []).forEach(x => console.warn("aviso:", x));
})().catch(e => { console.error("FALHA", e); process.exit(1); });
