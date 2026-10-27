/* Cria a coluna categoria em precos_cupom e coletas e classifica (IA) o que ainda está sem categoria.
   Rodar: node --env-file=../../.env.local scripts/categorizar.js   (pode repetir: só pega o que falta) */
const { sql } = require("../api/_lib");
const { categorizar } = require("../api/_ia");

(async () => {
  for (const t of ["precos_cupom", "coletas"]) {
    await sql().query(`alter table ${t} add column if not exists categoria text`);
    const falta = await sql().query(`select distinct lower(descricao) as d from ${t} where categoria is null`);
    const cats = await categorizar(falta.map(x => x.d), undefined, 30000);
    let n = 0;
    for (let i = 0; i < falta.length; i++) if (cats[i]) { await sql().query(`update ${t} set categoria = $1 where categoria is null and lower(descricao) = $2`, [cats[i], falta[i].d]); n++; }
    console.log(t, `${n}/${falta.length} descrições classificadas`);
  }
})().catch(e => { console.error(e.message); process.exit(1); });
