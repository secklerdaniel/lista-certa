/* Carrega ofertas de folheto (sem GTIN) na tabela "ofertas". Idempotente: apaga a mesma fonte antes de inserir. */
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, ".."); process.chdir(root);
fs.readFileSync(".env.local", "utf8").split("\n").forEach(l => { const m = l.match(/^(\w+)=(.*)$/); if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, ""); });
const { sql } = require(path.join(root, "api/_lib.js"));

const FONTE = "folheto-2026-10-22", D = "2026-10-22", D24 = "2026-10-24", ENQ = "Enquanto durarem os estoques";
const A = "Açougue", L = "Laticínios", M = "Mercearia", C = "Congelados", P = "Padaria", B = "Bebidas", BI = "Biscoitos", LI = "Limpeza", DS = "Doces e Sobremesas";
// [categoria, produto, marca, qtd, un, preco, de, ate]  (ate que não é data vira observação)
const G = [
 ["Mercado Drumm", "Gramado", [
  [A,"Carne Suína Nuca",null,1,"kg",19.9,D,D],[A,"Coxão de Dentro",null,1,"kg",49.9,D,D],[A,"Costela Suína",null,1,"kg",24.9,D,D],
  [L,"Queijo Mussarela Fatiado","Stefanello",300,"g",13.99,D,D],[M,"Café Solúvel","Iguaçu",200,"g",24.9,D,D],[L,"Leite Integral","Dalia",1,"l",4.59,D,D],
  [M,"Arroz Branco","Blue Ville",5,"kg",21.99,D,D],[M,"Extrato de Tomate","Elefante",300,"g",6.39,D,D],[P,"Pão de Forma","Pullman",480,"g",6.99,D,D],
  [C,"Empanado de Frango","Ave Serra",275,"g",5.99,D,D],[M,"Erva Mate","Schneider Naturale",1,"kg",10.99,D,D],[C,"Pizza Congelada","Sadia",460,"g",17.99,D,D],
  [C,"Steak de Frango","Perdigão",100,"g",1.69,D,D],[L,"Creme de Leite","Dalia",200,"g",2.49,D,D],[DS,"Doce de Leite","Mu-Mu",350,"g",8.99,D,D],
  [BI,"Biscoito Recheado","Trakinas",126,"g",3.29,D,D],[M,"Açúcar Cristal","União",1,"kg",4.49,D,D],[M,"Feijão Preto","Tozzo",1,"kg",6.99,D,D]]],
 ["Brombatti", "Gramado", [
  [A,"Coxa e Sobrecoxa de Frango",null,1,"kg",8.98,D,D],[A,"Costela Suína",null,1,"kg",23.98,D,D],[A,"Carne Moída Segunda",null,1,"kg",37.98,D,D],
  [A,"Coxão Mole",null,1,"kg",49.9,D,D],[A,"Coxão de Fora",null,1,"kg",48,D,D],[A,"Chuleta Bovina",null,1,"kg",42.9,D,D],
  [A,"Filé de Peito de Frango",null,1,"kg",17.9,D,D],[A,"Ponta de Peito Bovino",null,1,"kg",27.98,D,D],[A,"Vazio Bovino",null,1,"kg",44.98,D,D]]],
 ["Multi Serrano", "Canela", [
  [A,"Coxão de Fora",null,1,"kg",41.97,D,D],[A,"Filé de Peito de Frango",null,1,"kg",16.97,D,D],[A,"Paleta Suína",null,1,"kg",12.97,D,D],
  [A,"Chuleta Suína",null,1,"kg",16.97,D,D],[A,"Carne Moída Primeira",null,1,"kg",47.97,D,D],[A,"Coxão Mole",null,1,"kg",54.97,D,D],
  [C,"Coxinha da Asa de Frango","Pioneiro",700,"g",9.97,D,D],[A,"Moela de Frango","Seara",1,"kg",11.97,D,D],[C,"Carne Moída de Frango","Ave Serra",700,"g",13.97,D,D],
  [C,"Coxa e Sobrecoxa de Frango","Pioneiro",2,"kg",18.97,D,D],[C,"Filé de Peito de Frango","Pioneiro",2,"kg",34.87,D,D],[A,"Ossinho Suíno",null,1,"kg",7.97,D,D],
  [A,"Pezinho Suíno",null,1,"kg",9.97,D,D],[C,"Filé de Tilápia","Familitie",400,"g",19.97,D,D],[C,"Pizza Congelada","Multi",550,"g",12.99,D,D]]],
 ["Iskinão", "Canela", [[P,"Rosca de Polvilho","Própria",1,"un",5.99,null,null]]],
 ["Dia Após Dia", "Gramado", [
  [A,"Paleta Bovina",null,1,"kg",29.89,null,D],[A,"Agulha Bovina",null,1,"kg",26.99,null,D],[A,"Salsichão","Dalia",1,"kg",18.99,D,D24],
  [A,"Coxa e Sobrecoxa de Frango",null,1,"kg",9.89,D,D24],[A,"Costela Bovina",null,1,"kg",34.99,D,D24],[A,"Chuleta Bovina",null,1,"kg",39.99,D,D24],
  [A,"Carré Suíno",null,1,"kg",13.99,D,D24],[P,"Pão de Alho","Açoriana",300,"g",9.99,D,D24]]],
 ["Mercado Bella Safra", "Gramado", [
  [M,"Óleo de Soja","Vitaliv",900,"ml",7.99],[A,"Alcatra Bovina",null,1,"kg",54.99],[A,"Coxão Mole",null,1,"kg",49.99],[A,"Picanha Bovina","Montana",1,"kg",64.99],
  [A,"Paleta Bovina",null,1,"kg",39.99],[M,"Maionese","Hellmann's",200,"g",4.89],["Higiene","Papel Higiênico","Florax",12,"un",9.99],
  [LI,"Detergente Líquido","Limpol",500,"ml",2.49],[LI,"Amaciante de Roupas","Girando Sol",2,"l",9.99],[LI,"Sabão em Pó","Brilhante",800,"g",9.99],
  ["Frios e Embutidos","Salame Fatiado","Santa Clara",100,"g",8.79],[B,"Refrigerante Guaraná","Fruki",2,"l",8.99],[L,"Leite Condensado","Frimesa",395,"g",5.99],
  [M,"Macarrão / Massa","Redefort",400,"g",4.99],[C,"Batata Palito Congelada","Taji",1.5,"kg",15.99],[M,"Arroz Branco","Blue Ville",2,"kg",8.49],
  [M,"Farinha de Trigo","Redefort",5,"kg",16.99],[M,"Farinha de Trigo","Orquídea",1,"kg",3.69],[M,"Feijão Preto","Redefort",1,"kg",6.89],
  [M,"Café Torrado e Moído","Melitta",500,"g",27.99],[L,"Leite Integral","Santa Clara",1,"l",4.49],[BI,"Biscoito Salgado Cream Cracker","Germani",200,"g",3.99],
  [BI,"Biscoito Maria / Maizena","Germani",345,"g",5.49],[L,"Queijo Mussarela Fatiado","Ducateli",160,"g",6.99],[M,"Macarrão / Massa com Ovos","Germani",500,"g",3.29],
  [B,"Água Mineral Sem Gás","Redefort",500,"ml",0.99],[B,"Cerveja Pilsen","Schin",473,"ml",3.59],[L,"Requeijão Cremoso","Santa Clara",400,"g",13.99],
  [DS,"Doce de Leite","Tirol",350,"g",8.99],[L,"Bebida Láctea","Tirol",480,"g",4.49],[C,"Sorvete Pote","Trivialy",2,"l",29.99],
  [B,"Refrigerante Cola","Pepsi",2,"l",8.29],[B,"Chopp","Stier",1,"l",9.99],[M,"Macarrão Instantâneo","Germani",63,"g",1.59],["Ovos e Frios","Ovos Brancos",null,20,"un",10.99]].map(r => [...r, null, ENQ])],
 ["Brombatti", "Canela", [
  ["Hortifrúti","Maçã Fuji",null,1,"kg",7.89,"2026-10-20","2026-10-21"],["Hortifrúti","Maçã Gala",null,1,"kg",8.99,"2026-10-20","2026-10-21"],["Hortifrúti","Maçã Gala",null,1,"kg",3.39,"2026-10-20","2026-10-21"],
  [P,"Pão de Queijo Congelado","Excelsior",1,"kg",13.99,null,"Ofertas da Semana"],[L,"Queijo Mussarela Fatiado","Stefanello",300,"g",13.99,null,"Ofertas da Semana"],
  [C,"Empanado de Frango","Excelsior",300,"g",6.99,null,"2026-10-31"],[C,"Batata Palito Congelada","Uai",2,"kg",16.99,null,D24],
  [DS,"Morango Cravejado com Chocolate","Própria",6,"un",19.9,null,"Produção Quarta e Sexta-feira"]]],
 ["Super Berti", "Gramado", [
  ["Matinais","Cereal Matinal","Snow Flakes",230,"g",5.99],[BI,"Biscoito Maria / Maizena","Germani",345,"g",3.99],[M,"Molho de Tomate","Fugini",300,"g",1.39],
  [LI,"Amaciante de Roupas Concentrado","Downy",750,"ml",12.99],[LI,"Lava Roupas Líquido","Tixan Ypê",3,"l",21.99],["Matinais","Achocolatado em Pó","Chocolatto",560,"g",12.99],
  [B,"Cerveja Lager","Therezópolis",473,"ml",3.99],[B,"Refrigerante Cola","Pepsi",2,"l",8.29]].map(r => [...r, null, "2026-10-25"])],
 ["Super Berti", "Gramado", [["Higiene","Sabonete","Lux",85,"g",2.59],[M,"Massa de Tapioca","Rocha",500,"g",4.99]].map(r => [...r, null, "2026-10-25"])],
 ["Mercado Du Povão", "Canela", [
  [A,"Ponta de Peito",null,1,"kg",26.99],[A,"Agulha",null,1,"kg",27.99],[A,"Carne Moída",null,1,"kg",24.99],[A,"Coxa com Sobrecoxa",null,1,"kg",8.99],
  ["Hortifrúti","Abacaxi",null,1,"un",8.99],["Hortifrúti","Maçã",null,1,"kg",3.99],["Hortifrúti","Banana",null,1,"kg",3.99],["Hortifrúti","Tomate",null,1,"kg",12.99],
  [M,"Tempero em Pó","Sazón",1,"un",2.99],[M,"Açúcar Cristal","Euroçucar",1,"kg",3.99],[M,"Farinha de Trigo","Roseflor",5,"kg",19.99],[B,"Cerveja","Lokal",350,"ml",2.98],
  [M,"Feijão Preto","Colonial",1,"kg",4.99],[BI,"Bisnaga/Bolacha Recheada","Rancheiro",1,"un",1.99],[M,"Massa Parafuso","Santa Felicidade",500,"g",2.49],
  [LI,"Detergentes","Bilha Sul",500,"ml",2.49]].map(r => [...r, null, "domingo (25/10)"])],
 ["Rissul", "Gramado", [[B,"Espumante","Salton",750,"ml",29.9],[B,"Espumante","Salton",750,"ml",22.9],[B,"Espumante","Salton",750,"ml",25.9]].map(r => [...r, D, "2026-10-31"])],
 ["Mercado Paiol", "Canela", [
  [LI,"Papel Higiênico","Stylus",32,"un",29.95],[M,"Massa Espaguete","Farotti",500,"g",2.5],[BI,"Wafers","Isabela",100,"g",2.5],[M,"Arroz Parboilizado","Rozcato",5,"kg",18.99],
  [M,"Açúcar Cristal","Euroçucar",5,"kg",16.95],[M,"Farinha de Milho/Polenta","Zanin",1,"kg",1.99],[LI,"Papel Higiênico Rolão","Maxpet",300,"m",83],[M,"Amendoim","Bella Dica",400,"g",6.99],
  [M,"Farinha de Milho","Fritz Frida",1,"kg",2.99],[M,"Farinha de Trigo","Maria Inês",5,"kg",14.99],[L,"Leite UHT","Tirol",1,"l",4.75],[L,"Nata","Baky",300,"g",6.99],
  [A,"Salsicha","Cerrer",1,"kg",9.95],[C,"Pão de Queijo","Ghesla",1,"kg",19.95],[B,"Cachaça","3 Pipas",1,"l",5],[LI,"Amaciante","Downy",1,"l",17.99],
  ["Variedades","Chinelo Infantil",null,1,"un",29.95],["Variedades","Chinelo Adulto",null,1,"un",26.95]].map(r => [...r, D, ENQ])],
 ["Supermercado Semprebon", "Gramado", [
  [A,"Filé de Frango Resfriado",null,1,"kg",14.99],[A,"Chuleta",null,1,"kg",33.99],[M,"Ovos Vermelhos","Grings",20,"un",12.99],[B,"Guaraná","Antarctica",1,"l",3.99],
  [B,"Cerveja","Stella Artois",473,"ml",6.49],[L,"Leite Integral","Dalia",1,"l",4.89]].map(r => [...r, D, D])],
];

(async () => {
  const q = (s, p) => sql().query(s, p);
  await q(`create table if not exists ofertas (
    id serial primary key, mercado text not null, cidade text not null, categoria text, produto text not null, marca text,
    quantidade numeric, unidade text, preco numeric not null, valido_de date, valido_ate date, validade_obs text,
    fonte text, criado_em timestamptz not null default now())`);
  await q(`create index if not exists ofertas_cidade_produto on ofertas (lower(cidade), lower(produto))`);
  await q(`delete from ofertas where fonte = $1`, [FONTE]);
  let n = 0;
  for (const [mercado, cidade, itens] of G) for (const [cat, prod, marca, qtd, un, preco, de, ate] of itens) {
    const data = s => { const m = /^\d{4}-\d{2}-\d{2}$/.test(s || "") ? s : (s || "").match(/\((\d{2})\/(\d{2})\)/); return typeof m === "string" ? m : m ? `2026-${m[2]}-${m[1]}` : null; };
    await q(`insert into ofertas (mercado,cidade,categoria,produto,marca,quantidade,unidade,preco,valido_de,valido_ate,validade_obs,fonte) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [mercado, cidade, cat, prod, marca, qtd, un, preco, data(de), data(ate), ate && !data(ate) ? ate : null, FONTE]);
    n++;
  }
  const t = await q(`select mercado, cidade, count(*)::int n from ofertas where fonte=$1 group by 1,2 order by 3 desc`, [FONTE]);
  console.log("inseridas:", n); console.table(t);
})().catch(e => { console.error("FALHA", e); process.exit(1); });
