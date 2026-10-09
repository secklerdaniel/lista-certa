/* Semeia o catálogo da região com a lista que o Daniel levantou à mão (nome + endereço de rua).
   Coordenadas, quando possível, vêm do OpenStreetMap (Nominatim), nunca do Google. */
const fs = require("fs"), path = require("path");
const root = "C:/Users/Daniel/.openclaw/workspace/apps/lista-allan"; process.chdir(root);
fs.readFileSync(".env.local", "utf8").split("\n").forEach(l => { const m = l.match(/^(\w+)=(.*)$/); if (m) process.env[m[1]] = m[2]; });
const { sql } = require(path.join(root, "api/_lib.js"));

const LISTA = [
  { nome: "Rissul", cidade: "Gramado", rua: "R. João Pessoa", num: "417" },
  { nome: "Mercado e Açougue Ponto Certo", cidade: "Gramado", rua: "R. Francisco Comiotto", num: "52" },
  { nome: "Mercado Stahl - Floresta", cidade: "Gramado", rua: "R. Tristão de Oliveira", num: "301" },
  { nome: "Supermercados Dia Após Dia Gramado", cidade: "Gramado", rua: "R. Tristão de Oliveira", num: "239", cnpj: "67971553000162" }, // CNPJ visto no cupom fiscal da loja
  { nome: "Sabor da Floresta", cidade: "Gramado", rua: "R. Tristão de Oliveira", num: "388" },
  { nome: "Supermercado Berti", cidade: "Gramado", rua: "R. São Pedro", num: "835" },
  { nome: "Mercado Piratini", cidade: "Gramado", rua: "R. Guilherme Dal Ri", num: "659" },
];
const dorme = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  for (const m of LISTA) {
    let lat = null, lng = null;
    try {
      const q = encodeURIComponent(`${m.rua} ${m.num}, ${m.cidade}, RS, Brasil`);
      const r = await fetch(`https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=1&countrycodes=br`, { headers: { "User-Agent": "ListaCerta/1.0 (seed manual; https://lista-certa-omega.vercel.app)" } });
      const j = await r.json();
      if (j[0]) { lat = +j[0].lat; lng = +j[0].lon; }
    } catch (e) { /* sem coordenadas, tudo bem */ }
    await dorme(1200); // política do Nominatim: 1 consulta por segundo
    const endereco = `${m.rua}, ${m.num}`;
    await sql().query(
      `insert into mercados_regiao (nome, cidade, endereco, lat, lng, cnpj, fonte) values ($1, $2, $3, $4, $5, $6, 'manual')
       on conflict (lower(nome), lower(cidade)) do update set endereco = excluded.endereco, lat = coalesce(excluded.lat, mercados_regiao.lat), lng = coalesce(excluded.lng, mercados_regiao.lng), cnpj = coalesce(excluded.cnpj, mercados_regiao.cnpj)`,
      [m.nome, m.cidade, endereco, lat, lng, m.cnpj || null]);
    console.log(m.nome.padEnd(38), endereco.padEnd(28), lat ? `${lat.toFixed(5)}, ${lng.toFixed(5)}` : "(sem coordenadas)");
  }
  console.log("total no catálogo:", (await sql().query("select count(*)::int n from mercados_regiao"))[0].n);
})().catch(e => console.error("FALHA", e));
