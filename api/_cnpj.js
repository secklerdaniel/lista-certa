/* Consulta pública de CNPJ (BrasilAPI, dados da Receita). Se a consulta falhar, devolve null e o cadastro segue sem ela. */
const titulo = s => String(s || "").toLowerCase().replace(/(^|[\s.\-/(])(\S)/g, (a, b, c) => b + c.toUpperCase()).replace(/ (De|Da|Do|Dos|Das|E) /g, x => x.toLowerCase()).trim();
const semSufixo = s => String(s || "").replace(/\b(LTDA|EIRELI|EPP|ME|MEI|S\/?A|S\.A\.)\b\.?/gi, "").replace(/\s+/g, " ").trim();

async function consultar(cnpj, fetchFn = fetch) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 6000);
  try {
    const r = await fetchFn(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, { signal: ctl.signal, headers: { "User-Agent": "ListaCerta/1.0 (https://lista-certa-omega.vercel.app)" } });
    if (r.status === 404) return { encontrado: false };
    if (!r.ok) return null;
    const j = await r.json();
    const situacao = String(j.descricao_situacao_cadastral || "").toUpperCase();
    return {
      encontrado: true,
      nome: titulo(semSufixo(j.nome_fantasia) || semSufixo(j.razao_social)),
      razaoSocial: j.razao_social || null,
      cidade: titulo(j.municipio), uf: j.uf || null,
      situacao: situacao || null, ativa: situacao === "ATIVA",
    };
  } catch (e) { return null; } finally { clearTimeout(t); }
}

/* só barra quando a Receita CONFIRMA que o CNPJ não está ativo; consulta fora do ar ou CNPJ não encontrado não bloqueia */
async function verificarAtivo(cnpj) {
  const c = await consultar(cnpj);
  if (c && c.encontrado && !c.ativa) return `Esse CNPJ não está ativo na Receita (situação: ${c.situacao || "desconhecida"}).`;
  return null;
}

module.exports = { consultar, verificarAtivo, titulo };
