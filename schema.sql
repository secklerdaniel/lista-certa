-- Banco do Sacolista (Postgres, testado no Neon). Rodar uma vez num banco vazio:
--   psql "$DATABASE_URL" -f schema.sql
-- As tabelas listas_produtos e ofertas também são criadas sozinhas pelo código se faltarem.

create table if not exists mercado_contas (
  id serial primary key,
  email text not null unique,
  senha_hash text not null,                 -- scrypt
  criado_em timestamptz not null default now(),
  ultimo_acesso timestamptz not null default now()
);

create table if not exists mercados (
  id serial primary key,
  nome text not null,
  cnpj text,
  cidade text not null,
  ibge text,
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  email text,
  origem text not null default 'admin',
  conta_id integer references mercado_contas(id) on delete set null
);
create unique index if not exists mercados_cnpj_uq on mercados (cnpj) where cnpj is not null;
create index if not exists mercados_conta_idx on mercados (conta_id);

create table if not exists chaves_api (
  id serial primary key,
  mercado_id integer not null references mercados(id) on delete cascade,
  prefixo text not null,
  hash text not null unique,                -- sha256 da chave; a chave em si nunca é guardada
  ambiente text not null check (ambiente in ('teste', 'producao')),
  criada_em timestamptz not null default now(),
  revogada_em timestamptz
);

create table if not exists usuarios (
  id serial primary key,
  google_sub text not null unique,
  nome text not null,
  email text,
  foto text,
  criado_em timestamptz not null default now(),
  ultimo_acesso timestamptz not null default now(),
  bloqueado boolean not null default false
);

create table if not exists contribuicoes (
  id bigserial primary key,
  usuario_id integer not null references usuarios(id) on delete cascade,
  tipo text not null check (tipo in ('cupom', 'video')),
  mercado_nome text,
  cidade text,
  itens integer not null default 0,
  chave text unique,                        -- chave de acesso da NFC-e: 1 cupom = 1 ponto
  criado_em timestamptz not null default now()
);
create index if not exists contrib_usuario_idx on contribuicoes (usuario_id, criado_em desc);
create index if not exists contrib_cidade_idx on contribuicoes (cidade);

create table if not exists coletas (
  id bigserial primary key,
  mercado_nome text not null,
  cidade text not null,
  descricao text not null,
  gtin text,
  preco numeric not null,
  promocao_preco numeric,
  origem text not null default 'video',
  status text not null default 'pendente',
  ip_hash text,
  criado_em timestamptz not null default now(),
  usuario_id integer references usuarios(id) on delete set null,
  local_metros integer,
  contribuicao_id bigint references contribuicoes(id) on delete cascade,
  categoria text
);
create index if not exists coletas_cidade_idx on coletas (cidade, criado_em desc);

create table if not exists precos_cupom (
  id bigserial primary key,
  chave text not null,
  ordem integer not null,
  cnpj text not null,
  mercado_nome text,
  cidade text not null,
  descricao text not null,
  codigo_loja text,
  unidade text,
  qtd numeric,
  preco_unit numeric not null check (preco_unit > 0),
  emissao timestamptz,
  contribuicao_id bigint references contribuicoes(id) on delete cascade,
  criado_em timestamptz not null default now(),
  categoria text,
  unique (chave, ordem)
);
create index if not exists precos_cupom_busca_idx on precos_cupom (lower(cidade), emissao desc);
create index if not exists precos_cupom_cnpj_idx on precos_cupom (cnpj, lower(descricao), emissao desc);

create table if not exists precos (
  mercado_id integer not null references mercados(id) on delete cascade,
  ambiente text not null check (ambiente in ('teste', 'producao')),
  gtin text not null,
  descricao text,
  unidade text,
  preco numeric not null check (preco > 0),
  promocao_preco numeric,
  promocao_ate date,
  atualizado_em timestamptz not null default now(),
  recebido_em timestamptz not null default now(),
  origem text not null default 'api',
  primary key (mercado_id, ambiente, gtin)
);
create index if not exists precos_gtin_idx on precos (gtin) where ambiente = 'producao';

create table if not exists precos_historico (
  id bigserial primary key,
  mercado_id integer not null,
  ambiente text not null,
  gtin text not null,
  preco numeric not null,
  em timestamptz not null default now()
);
create index if not exists precos_hist_idx on precos_historico (mercado_id, gtin, em desc);

create table if not exists produtos (
  gtin text primary key,
  nome text not null,
  marca text,
  quantidade numeric,
  unidade text,
  categoria text,
  catalogo_id integer,
  fonte text not null default 'ia',
  resolvido_em timestamptz not null default now()
);

create table if not exists mercados_regiao (
  id serial primary key,
  nome text not null,
  cidade text not null,
  endereco text,
  lat double precision,
  lng double precision,
  cnpj text unique,
  fonte text not null default 'manual',
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);
create index if not exists mercados_regiao_cidade_idx on mercados_regiao (lower(cidade));
create unique index if not exists mercados_regiao_nome_idx on mercados_regiao (lower(nome), lower(cidade));

create table if not exists ofertas (
  id serial primary key,
  mercado text not null,
  cidade text not null,
  categoria text,
  produto text not null,
  marca text,
  quantidade numeric,
  unidade text,
  preco numeric not null,
  valido_de date,
  valido_ate date,
  validade_obs text,
  fonte text,
  criado_em timestamptz not null default now(),
  produto_original text
);
create index if not exists ofertas_cidade_produto on ofertas (lower(cidade), lower(produto));

create table if not exists listas_produtos (
  id serial primary key,
  nome text not null,
  descricao text,
  itens jsonb not null default '[]',        -- [{nome, termo, qtd}]
  criado_em timestamptz not null default now()
);

create table if not exists uso_publico (    -- limite de uso por IP (guarda só o hash)
  id bigserial primary key,
  ip_hash text not null,
  tipo text not null,
  em timestamptz not null default now()
);
create index if not exists uso_publico_idx on uso_publico (ip_hash, tipo, em desc);
