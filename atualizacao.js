/* =====================================================================
   FAIXA "NOVA ATUALIZACAO" — Seckler Digital
   Avisa quem esta com o app aberto que saiu uma versao nova, e atualiza
   com um toque. Instrucoes completas em atualizacao.html (mesma pasta).

   Instalar: copie este arquivo para a raiz publica do projeto e carregue
   com UMA linha, antes de </body>:
     <script src="/atualizacao.js" defer></script>
   Opcoes (atributos no <script>):
     data-intervalo="60"   segundos entre verificacoes (padrao 60)
     data-dev              verifica tambem em localhost (padrao: nao)
     data-versao="/api/versao"  endereco que devolve { v } e muda a CADA deploy; assim avisa ate
                           deploy que so mexe na API (sem isso, so avisa quando a PAGINA muda)
   ===================================================================== */
(function () {
  if (window.__atualizacao) return;

  var tag = document.currentScript;
  var INTERVALO = (tag && +tag.getAttribute("data-intervalo")) || 60;
  var DEV = !!(tag && tag.hasAttribute("data-dev"));
  var local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) || /\.(localhost|test)$/.test(location.hostname);

  /* ---------- faixa ---------- */
  var css =
    ".sd-atualiza{position:fixed;top:0;left:0;right:0;z-index:2147483000;background:#2f2f31;color:#fff;" +
    "text-align:center;padding:calc(10px + env(safe-area-inset-top)) 16px 10px;cursor:pointer;border:0;width:100%;" +
    "font-family:inherit;box-shadow:0 2px 12px rgba(0,0,0,.35);transform:translateY(-100%);transition:transform .35s ease}" +
    ".sd-atualiza.on{transform:none}" +
    ".sd-atualiza:focus-visible{outline:3px solid #f2c23c;outline-offset:-3px}" +
    ".sd-atualiza b{display:block;font-size:18px;font-weight:500;margin-bottom:3px}" +
    ".sd-atualiza span{display:block;font-size:15px;font-weight:400}" +
    ".sd-atualiza .m{display:none}" +
    "@media(max-width:767px){.sd-atualiza .d{display:none}.sd-atualiza .m{display:block}.sd-atualiza b{margin-bottom:4px}}" +
    "@media(prefers-reduced-motion:reduce){.sd-atualiza{transition:none}}";

  var faixa;
  function mostrar() {
    if (faixa) return;
    var st = document.createElement("style");
    st.textContent = css;
    document.head.appendChild(st);
    faixa = document.createElement("button");
    faixa.type = "button";
    faixa.className = "sd-atualiza";
    faixa.setAttribute("role", "status");
    faixa.innerHTML =
      "<b>Nova atualização do aplicativo ⚡</b>" +
      "<span class='d'>Clique aqui para obter a versão mais recente</span>" +
      "<span class='m'>Clique aqui para atualizar</span>";
    faixa.onclick = function () { location.reload(); };
    document.body.appendChild(faixa);
    requestAnimationFrame(function () { requestAnimationFrame(function () { faixa.classList.add("on"); }); });
  }

  /* ---------- deteccao ---------- */
  /* Assinatura da pagina = lista de scripts e folhas de estilo (Next, Vite e
     afins geram nomes com hash novo a cada deploy). Sem nenhum arquivo
     externo (HTML unico), vale o texto inteiro. Ignora dados que mudam sozinhos. */
  function assinatura(html) {
    var refs = [], re = /<(script|link)\b[^>]*>/gi, m, ref;
    while ((m = re.exec(html))) {
      if (m[1].toLowerCase() === "link" && !/rel=["']?stylesheet/i.test(m[0])) continue;
      ref = (m[0].match(/\b(?:src|href)=["']([^"']+)["']/i) || [])[1];
      if (!ref || /atualizacao\.js/.test(ref)) continue;
      if (/^(https?:)?\/\//i.test(ref) && ref.indexOf(location.host) < 0) continue;
      refs.push(ref);
    }
    var base = refs.length ? refs.sort().join("|") : html;
    var h = 5381;
    for (var i = 0; i < base.length; i++) h = ((h << 5) + h + base.charCodeAt(i)) | 0;
    return refs.length + ":" + h;
  }

  var url = location.pathname + location.search;
  var inicial = null, ocupado = false;
  var VERSAO = tag && tag.getAttribute("data-versao"), versaoInicial = null;

  function checar() {
    if (faixa || ocupado || document.hidden || !navigator.onLine) return;
    ocupado = true;
    if (VERSAO) {
      fetch(VERSAO, { cache: "no-store", credentials: "same-origin" })
        .then(function (r) { return r.ok ? r.json() : Promise.reject(); })
        .then(function (j) { if (j && j.v) { if (versaoInicial === null) versaoInicial = j.v; else if (j.v !== versaoInicial) mostrar(); } })
        .catch(function () {});
    }
    fetch(url, { cache: "no-store", credentials: "same-origin" })
      .then(function (r) { return r.ok ? r.text() : Promise.reject(); })
      .then(function (html) {
        var s = assinatura(html);
        if (inicial === null) inicial = s;
        else if (s !== inicial) mostrar();
      })
      .catch(function () {})
      .then(function () { ocupado = false; });
  }

  window.__atualizacao = { mostrar: mostrar, checar: checar };

  if (location.protocol === "file:" || (local && !DEV)) return;
  checar();
  setInterval(checar, INTERVALO * 1000);
  document.addEventListener("visibilitychange", function () { if (!document.hidden) checar(); });
  window.addEventListener("online", checar);
})();
