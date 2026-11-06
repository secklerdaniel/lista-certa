# Sacolista

Comparador de preços de mercado para Gramado, Canela, Igrejinha, Nova Petrópolis e São Francisco de Paula.
A pessoa monta a lista de compras e o app mostra em qual mercado ela sai mais barata, e quando vale comprar
um pouco em cada um (divisão em até 3 mercados). Os preços vêm de quem compra (cupom fiscal e vídeo de
prateleira), do folheto dos mercados e da API que os próprios mercados podem usar.

Feito por Seckler Digital. Antigo nome de trabalho: Lista Certa (a pasta e o repositório ainda usam esse nome).

## Como é feito

Sem build e sem framework: páginas HTML estáticas na raiz + funções serverless em `api/` (Node, CommonJS),
hospedado na **Vercel**, banco **Postgres** (Neon). Só duas dependências: `@neondatabase/serverless` e `jose`.

| Arquivo | O que é |
|---|---|
| `index.html` | Landing |
| `app.html` | O app (`/app`): lista, comparação por cidade, aba Contribuir |
| `mercado.html` | Portal do mercado (`/mercado`): conta, chaves da API, envio de preços |
| `cadastro.html`, `api-docs.html`, `openapi.json` | Cadastro só-API e documentação (`/cadastro`, `/docs`) |
| `streaming.html` | Agente de voz (`/streaming`), ElevenLabs |
| `adminklm08.html` | Painel admin (`/adminklm08`): mercados, usuários, coletas, região, ofertas, produtos, listas |
| `grupo.html`, `termos.html`, `privacidade.html`, `404.html` | Páginas de apoio |
| `api/` | Funções serverless. Arquivos que começam com `_` são módulos internos, não viram rota |
| `schema.sql` | Todas as tabelas do banco |
| `scripts/` | Cargas e manutenção, rodados na sua máquina (ver abaixo) |

## Rodando do zero

1. **Banco**: crie um Postgres (Neon, plano grátis serve) e rode `psql "$DATABASE_URL" -f schema.sql`.
2. **Vercel**: importe o repositório (deploy automático a cada push na `main`) e cadastre as variáveis abaixo.
3. **Google login** (usuários do app): crie um *Client ID* OAuth do tipo "Aplicativo da Web" no Google Cloud,
   autorize o seu domínio em *Origens JavaScript autorizadas*, publique a tela de consentimento e troque o ID em
   `api/_config.js`. O client secret **não** é usado (fluxo de ID token).
4. **Agente de voz** (opcional): `node --env-file=.env.local scripts/criar-agente.mjs` cria o agente na sua conta
   ElevenLabs; troque o ID `AGENTE` em `api/util/[acao].js`.

Para testar localmente: `npx vercel dev` com um `.env.local`. O `.gitignore` já ignora `.env*`: **nunca** commite chaves.

### Variáveis de ambiente

| Variável | Obrigatória | Para quê |
|---|---|---|
| `DATABASE_URL` | sim | Conexão Postgres. O segredo do cookie de sessão é derivado dela: trocar o banco desconecta todo mundo |
| `ADMIN_KEY` | sim | Chave do painel admin (header `x-admin-key`). Use algo longo e aleatório |
| `CRON_SECRET` | recomendada | Autentica o cron diário de limpeza (`/api/util/limpeza`); a Vercel envia sozinha se a env existir |
| `OPENAI_API_KEY` | sim | Padroniza nome de produto por GTIN e lê etiquetas do vídeo |
| `GEMINI_API_KEY` | sim | Lê imagens de folheto na aba Ofertas do admin e em `scripts/ler-ofertas.js` |
| `ELEVENLABS_API_KEY` | não | Só para `scripts/criar-agente.mjs` e para o link assinado do agente de voz (`/api/agente`) |
| `ELEVENLABS_VOICE_ID`, `ELEVENLABS_MODEL` | não | Voz e modelo do agente |

### Painel admin

Abra `/adminklm08`: a página entra sozinha, com o token `TOKEN_PAINEL` de `api/_lib.js` (o endereço da página é o
segredo). A `ADMIN_KEY` também vale. **Troque o `TOKEN_PAINEL` por um valor seu** antes de usar em produção.
O painel só consulta e apaga coletas; não há aprovação de coletas pela equipe (decisão de produto).

## Regras que não podem quebrar

- **Comparar só embalagem do mesmo tamanho** (1 kg com 1 kg). Marcas diferentes podem; **nunca** preço por kg/litro
  entre produtos ou marcas diferentes. Item sem tamanho conhecido fica de fora. Mercado sem o item = "faltando".
  Ranking: menos itens faltando, depois menor total.
- A divisão em 3 mercados só aparece se render pelo menos R$ 1 a mais que a de 2.
- **Anúncio pago nunca mexe no ranking de "mais barato"** nem nas artes de "onde comprar". Se misturar, o app perde a credibilidade.
- **CPF do cupom nunca é lido nem guardado.** O cupom entra pela chave da NFC-e (consulta ao portal da Fazenda do RS);
  1 cupom = 1 ponto, por chave.
- O vídeo de prateleira **não sobe**: os quadros são extraídos no aparelho, a IA lê as etiquetas, a pessoa revisa e só
  ao confirmar vira coleta.
- Mercados da comparação que não vieram de cupom, vídeo ou API são **ilustrativos** na landing. Não apresente como preço real.
- Não guarde dados do Google Maps (os termos proíbem). O catálogo de mercados da região é cadastrado à mão ou vem do OpenStreetMap.

## Scripts

Rodam na sua máquina com `node --env-file=.env.local scripts/<arquivo>`:

| Script | Faz |
|---|---|
| `carregar-ofertas.js`, `subir-ofertas.js` | Carga de ofertas de folheto (JSON) no banco |
| `ler-ofertas.js` | Lê imagens de ofertas com Gemini e gera o JSON para revisar |
| `categorizar.js` | Categoriza produtos |
| `semear-mercados-regiao.js` | Cadastra o catálogo de mercados da região |
| `criar-agente.mjs` | Cria/atualiza o agente de voz na ElevenLabs |

## Dados e privacidade

O app segue a LGPD (ver `privacidade.html` e `termos.html`). Usuários entram com Google; o nome público de uma
coleta é primeiro nome + inicial. Cada pessoa pode editar o nome, excluir coletas e excluir a conta. Contas de mercado
usam e-mail e senha (hash scrypt) e não têm recuperação por e-mail: o admin gera uma senha provisória.
O uso público é limitado por IP, guardando só o hash.

## Pendências conhecidas

- Verificar preços de mercado novo antes de aparecerem publicamente.
- E-mail de recuperação de senha de mercado.
- Parte da ligação GTIN → produto ainda fica guardada por aparelho.
- O vídeo de prateleira só foi testado com etiquetas desenhadas; falta testar com gôndola real.
