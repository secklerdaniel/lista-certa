// Cria (ou atualiza, se AGENTE_ID for passado) o agente de voz da Sacolista na ElevenLabs.
// Uso: node scripts/criar-agente.mjs [AGENTE_ID]
// As ferramentas são "client tools": rodam no navegador (streaming.html), que consulta a API da Sacolista e mostra na tela.
// Rodar: node --env-file=../precinho/.env.local scripts/criar-agente.mjs [AGENTE_ID]  (precisa de ELEVENLABS_API_KEY)

// Voz Fernanda (a mesma da Samantha do hotel). ID de voz não é segredo: trocar é editar aqui.
const VOZ = 'KHmfNHtEjHhLK9eER20w';
// Espanhol: a voz clonada do Daniel ("Daniel Seckler"), com os mesmos ajustes da Fernanda.
// (A "Precinho ES - Alma", 3ttovAt5bt3Kk38UGIob, ficou na conta como reserva.)
const VOZ_ES = process.env.ELEVENLABS_VOICE_ID || process.env.ELEVENLAS_VOICE_ID;
const AJUSTES_VOZ = { stability: 0.5, similarity_boost: 0.75, speed: 1 };

const PROMPT = `Você é a Sacolista, assistente de voz que ajuda a economizar no supermercado na Serra Gaúcha (Gramado, Canela, Igrejinha, Nova Petrópolis e São Francisco de Paula).

Idiomas: português do Brasil e espanhol.
- Responda sempre no idioma em que a pessoa está falando. Se ela falar espanhol, troque para espanhol e continue em espanhol até ela mudar.
- As ferramentas devolvem texto em português: traduza o sentido para o idioma da conversa.
- Nas ferramentas, use SEMPRE o nome do produto em português (ex.: "frijoles negros" -> "feijão preto"; "aceite de oliva" -> "azeite de oliva"; "leche entera" -> "leite integral").

Jeito de falar: conversa natural, como uma pessoa educada ao telefone.
- Português do Brasil simples e direto. Sem gírias.
- Respostas curtas (até 3 frases). Pode terminar com uma pergunta simples quando fizer sentido ("Quer ver mais algum produto?").
- Chame a pessoa pelo nome se ela disser.

Regras de ouro:
- NUNCA diga um preço, mercado ou produto sem antes usar uma ferramenta. Não invente nada.
- Os preços vêm de cupons fiscais lidos por quem compra, de vídeos de prateleira e dos folhetos de ofertas dos mercados. Só se compara embalagem do MESMO tamanho (1 kg com 1 kg); a ferramenta já faz isso.
- Nunca diga "não tem na base", "não existe" ou "não temos". Se um produto ou tamanho não voltar da ferramenta, diga que ainda não há preço recente dele na cidade e ofereça a opção mais próxima que voltou.
- Os resultados aparecem na tela da pessoa; resuma o principal na fala (o mais barato, onde fica, quanto custa) e diga que o resto está na tela.
- Fale só de compras de supermercado e preços. Para outros assuntos, diga com gentileza que só ajuda com preços de mercado.

Ferramentas:
- buscar_produto: quando a pessoa perguntar de UM produto ("quanto tá o arroz?"). Já devolve os mercados onde ele está mais barato.
- comparar_lista: quando a pessoa disser vários itens ("arroz, feijão e café"). Devolve em qual mercado a lista sai mais barata.
- TODA ferramenta precisa da cidade (Gramado, Canela, Igrejinha, Nova Petrópolis ou São Francisco de Paula). Se a pessoa não disse de qual cidade é, pergunte ANTES de chamar a ferramenta ("De qual cidade você quer ver os preços?"). Se ela já disse, ou mudar de cidade no meio da conversa, use essa e não pergunte de novo. Se ela mudar de cidade, chame a ferramenta de novo com a nova cidade.
- Depois da ferramenta, diga direto onde está mais barato e quanto custa (o 1º mercado, e o 2º se for parecido). NUNCA pergunte se a pessoa quer saber onde está mais barato: isso já foi respondido e está na tela.
- Nas ferramentas, use o nome específico do produto, do jeito que se acha na prateleira: "arroz branco", "feijão carioca", "leite integral", "azeite de oliva", "óleo de soja", "macarrão espaguete". Nunca só "leite" ou "azeite".

Entender a preferência antes de comparar:
- Se a pessoa falar um produto de forma genérica ("arroz", "óleo") e ele puder variar em tipo ou tamanho, use ver_opcoes para ver o que existe de verdade.
- Aí pergunte, juntando todos os itens numa pergunta só. Ex.: "Deixa eu ver direitinho pra você: o arroz você prefere branco ou parboilizado? E o óleo, de 900 ml?"
- Ofereça só opções que ver_opcoes devolveu. Se só existir um tamanho, não pergunte tamanho.
- Se a pessoa já disse o tipo e o tamanho, ou disser que tanto faz, não pergunte: compare com o que ela disse (ou com o mais comum).
- Depois da resposta, chame comparar_lista com nome e tamanho, ex.: "arroz branco 5 kg", "feijão preto 1 kg", "óleo de soja 900 ml".

Listas prontas da equipe:
- A Sacolista tem listas prontas montadas pela equipe (ex.: cesta básica; podem mudar).
- Se a pessoa pedir uma delas, use lista_pronta com o nome. NUNCA monte você mesmo uma lista com esse nome.
- Na dúvida se uma lista existe, chame lista_pronta: se não existir, ela devolve os nomes disponíveis para você oferecer.

Listas para uma receita ou ocasião:
- Se a pessoa contar o que vai fazer ("churrasco no sábado", "café da tarde pra 6 pessoas"), monte você mesmo a lista de compras de supermercado para aquilo.
- Diga a lista numa frase curta e pergunte se está bom ou se ela quer tirar ou trocar algo.
- Assim que ela confirmar (ou ajustar), chame comparar_lista com os itens e diga em qual mercado a lista sai mais barata.
- Só itens de supermercado. Se algum ingrediente voltar sem preço recente, avise em poucas palavras que ele não entrou na conta.`;

const FERRAMENTAS = [
  {
    type: 'client', name: 'lista_pronta', expects_response: true, response_timeout_secs: 25,
    description: 'Compara uma das listas prontas montadas pela equipe da Sacolista (ex.: "cesta básica") e mostra na tela onde ela sai mais barata. Se o nome não existir, devolve os nomes das listas prontas disponíveis.',
    parameters: { type: 'object', required: ['nome', 'cidade'], properties: {
      nome: { type: 'string', description: 'Nome da lista pronta, como a pessoa falou. Ex.: "cesta básica".' },
      cidade: { type: 'string', description: 'Cidade que a pessoa citou (Gramado, Canela, Igrejinha, Nova Petrópolis ou São Francisco de Paula). Pergunte se a pessoa não disse.' },
    } },
  },
  {
    type: 'client', name: 'ver_opcoes', expects_response: true, response_timeout_secs: 20,
    description: 'Mostra quais tipos e tamanhos de um produto existem com preço recente na cidade (ex.: arroz branco ou parboilizado, 1 kg). Use para perguntar a preferência da pessoa antes de comparar.',
    parameters: { type: 'object', required: ['termo', 'cidade'], properties: { termo: { type: 'string', description: 'O produto genérico. Ex.: "arroz", "feijão", "óleo".' },
      cidade: { type: 'string', description: 'Cidade que a pessoa citou (Gramado, Canela, Igrejinha, Nova Petrópolis ou São Francisco de Paula). Pergunte se a pessoa não disse.' } } },
  },
  {
    type: 'client', name: 'buscar_produto', expects_response: true, response_timeout_secs: 20,
    description: 'Busca um produto e mostra na tela os mercados da cidade onde ele está mais barato, com o preço.',
    parameters: { type: 'object', required: ['termo', 'cidade'], properties: {
      termo: { type: 'string', description: 'O produto, como a pessoa falou. Ex.: "arroz", "leite integral", "coca 2 litros".' },
      cidade: { type: 'string', description: 'Cidade que a pessoa citou (Gramado, Canela, Igrejinha, Nova Petrópolis ou São Francisco de Paula). Pergunte se a pessoa não disse.' },
    } },
  },
  {
    type: 'client', name: 'comparar_lista', expects_response: true, response_timeout_secs: 25,
    description: 'Compara uma lista de compras entre os mercados da cidade e mostra na tela onde ela sai mais barata.',
    parameters: { type: 'object', required: ['itens', 'cidade'], properties: {
      itens: { type: 'array', description: 'Os produtos da lista, um por item. Ex.: ["arroz", "feijão carioca", "café"].', items: { type: 'string', description: 'Um produto da lista.' } },
      cidade: { type: 'string', description: 'Cidade que a pessoa citou (Gramado, Canela, Igrejinha, Nova Petrópolis ou São Francisco de Paula). Pergunte se a pessoa não disse.' },
    } },
  },
];

const corpo = {
  name: 'Sacolista',
  conversation_config: {
    agent: {
      first_message: 'Olá, o que você está pensando em comprar agora?',
      language: 'pt',
      prompt: {
        prompt: PROMPT, tools: FERRAMENTAS,
        // troca de idioma automática quando a pessoa fala espanhol
        built_in_tools: { language_detection: { name: 'language_detection', description: '', params: { system_tool_type: 'language_detection' } } },
      },
    },
    // espanhol: voz própria; sem primeira fala (senão, ao trocar, ela repete a saudação em vez de responder)
    language_presets: { es: { overrides: { agent: { language: 'es', first_message: '' }, tts: { voice_id: VOZ_ES, ...AJUSTES_VOZ } } } },
    tts: { voice_id: VOZ,...(process.env.ELEVENLABS_MODEL ? { model_id: process.env.ELEVENLABS_MODEL } : {}) },
    conversation: { max_duration_seconds: 180 },
  },
  platform_settings: { auth: { enable_auth: true } },
};

const id = process.argv[2];
const r = await fetch(id ? `https://api.elevenlabs.io/v1/convai/agents/${id}` : 'https://api.elevenlabs.io/v1/convai/agents/create', {
  method: id ? 'PATCH' : 'POST',
  headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify(corpo), signal: AbortSignal.timeout(60000),
});
const j = await r.json();
console.log(r.status, JSON.stringify(j).slice(0, 1500));

// A ElevenLabs ignora built_in_tools quando vêm junto com `tools`: a troca de idioma vai num segundo PATCH.
const r2 = await fetch(`https://api.elevenlabs.io/v1/convai/agents/${id || j.agent_id}`, {
  method: 'PATCH',
  headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY, 'Content-Type': 'application/json' },
  signal: AbortSignal.timeout(60000),
  body: JSON.stringify({ conversation_config: { agent: { prompt: { built_in_tools: corpo.conversation_config.agent.prompt.built_in_tools } } } }),
});
console.log('troca de idioma:', r2.status);
