// Seeds realistas (Fonte Única) — Sem marcas de terceiros, valores em centavos, estoque derivado de lotes (FEFO)
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { env } from "../config/env.js";
import { all, get, run, sincronizarEstoqueProduto, tx } from "./conexao.js";
import { agoraSP, hashSha256, hojeSP, somarDias } from "../utils/comum.js";

export const SENHA_DEMO = "Associadas@2026";
export const TOKEN_DEMO_MARIA = "demo_token_maria_losartana_30d";

function svgProdutoDataUri(corFundo, corBorda, _emoji, selo) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 140"><rect width="240" height="140" rx="18" fill="${corFundo}" stroke="${corBorda}" stroke-width="2"/><g transform="translate(36, 44)" fill="none" stroke="${corBorda}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="8" width="44" height="36" rx="8"/><path d="M16 8V4h16v4"/><path d="M24 19v14M17 26h14"/></g><rect x="104" y="46" width="112" height="48" rx="10" fill="#FFFFFF" opacity="0.95"/><text x="160" y="75" font-family="Inter, sans-serif" font-size="13" font-weight="bold" fill="#047857" text-anchor="middle">${selo}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export function bancoVazio() {
  return get("SELECT COUNT(*) AS n FROM farmacias").n === 0;
}

export function popularSeeds() {
  if (env.isProd || !env.DEMO_MODE) {
    throw new Error("popularSeeds() é proibido fora do DEMO_MODE ou em NODE_ENV=production.");
  }

  const hoje = hojeSP();
  const agora = agoraSP();
  const mesAtual = hoje.slice(0, 7);
  const hash = bcrypt.hashSync(SENHA_DEMO, 10);

  tx(() => {
    const f1 = run(
      `INSERT INTO farmacias (slug, razao_social, nome_fantasia, cnpj, afe_anvisa, licenca_sanitaria, horario_funcionamento,
        endereco_completo, farmaceutico_rt_nome, farmaceutico_rt_crf, dpo_email, telefone_sac, dominio_proprio,
        telefone_whatsapp, google_maps_review_url, chave_pix, cashback_pct, cashback_teto_pedido_pct,
        pedido_minimo_centavos, taxa_entrega_centavos, taxa_marketplace_ref_pct, modo_whatsapp, plano_ativo, meta_mensal_centavos, mes_referencia_vendas, criado_em)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      "associadas-centro",
      "Drogaria Centro Saúde Ltda.",
      "Farmácias Associadas — Unidade Centro (Demo)",
      "12345678000190",
      "AFE/ANVISA nº 7.48291.3",
      "Licença Sanitária Municipal nº 2026/009412-PR",
      "Seg a Sáb das 08h às 22h | Dom e Feriados das 09h às 20h",
      "Rua XV de Novembro, 480 — Centro — Curitiba/PR — CEP 80020-310",
      "Fernanda Lima",
      "CRF-PR 21.457",
      "privacidade@associadascentro.com.br",
      "0800-770-4100",
      "associadascentro.com.br",
      "41999990000",
      "https://g.page/r/associadas-centro/review",
      "12345678000190",
      5.0,
      30.0,
      0,
      0,
      22.0,
      "SEGURO_1_CLIQUE",
      "PRO_IA",
      18000000,
      mesAtual,
      agora
    ).lastInsertRowid;

    const f2 = run(
      `INSERT INTO farmacias (slug, razao_social, nome_fantasia, cnpj, endereco_completo, farmaceutico_rt_nome, farmaceutico_rt_crf,
        dpo_email, telefone_whatsapp, plano_ativo, meta_mensal_centavos, mes_referencia_vendas, criado_em)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      "associadas-batel",
      "Drogaria Batel Saúde Ltda.",
      "Farmácias Associadas — Unidade Batel (Demo)",
      "98765432000110",
      "Av. do Batel, 1200 — Curitiba/PR — CEP 80420-090",
      "Paulo Mendes",
      "CRF-PR 18.002",
      "dpo@associadasbatel.com.br",
      "41988880000",
      "ESSENCIAL",
      12000000,
      mesAtual,
      agora
    ).lastInsertRowid;

    const U = (fid, nome, email, cpf, cargo, crf, metaC, vendasC, comC) =>
      run(
        `INSERT INTO usuarios (farmacia_id,nome,email,cpf,senha_hash,cargo,crf_uf,meta_individual_centavos,vendas_mes_centavos,comissao_acum_centavos,criado_em)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        fid, nome, email, cpf, hash, cargo, crf, metaC, vendasC, comC, agora
      ).lastInsertRowid;

    U(f1, "Ricardo Almeida (Diretor)", "dono@associadas.demo", "11122233344", "DIRETOR", null, 0, 0, 0);
    const farm = U(f1, "Fernanda Lima (Farmacêutico(a) RT)", "farmaceutica@associadas.demo", "22233344455", "FARMACEUTICO", "CRF-PR 21.457", 3500000, 2840000, 41000);
    const b1 = U(f1, "Juliana Costa", "balconista@associadas.demo", "33344455566", "BALCONISTA", null, 2800000, 2695000, 84250);
    U(f1, "Marcos Pereira", "marcos@associadas.demo", "44455566677", "BALCONISTA", null, 2500000, 2132000, 56420);
    U(f1, "Bruna Oliveira", "bruna@associadas.demo", "55566677788", "BALCONISTA", null, 2500000, 1894000, 41800);
    U(f2, "Diretor Unidade Batel", "dono.batel@associadas.demo", "66677788899", "DIRETOR", null, 0, 0, 0);

    const P = ({
      fid,
      ean,
      nome,
      pa = null,
      conc = null,
      forma = null,
      tipoMed = "NAO_MEDICAMENTO",
      lab,
      cat,
      custoC,
      vendaC,
      promoC = null,
      receita = 0,
      vitrine = 0,
      emoji = "💊",
      seloImg,
      desc = null,
      tags = null,
    }) => {
      const img = svgProdutoDataUri(
        promoC ? "#FFF1E6" : "#E5F6F5",
        promoC ? "#EA6607" : "#00A19A",
        emoji,
        seloImg
      );
      return run(
        `INSERT INTO produtos (farmacia_id,ean_gtin,nome_comercial,principio_ativo,concentracao,forma_farmaceutica,tipo_medicamento,laboratorio,categoria,preco_custo_centavos,preco_venda_centavos,preco_promo_centavos,exige_receita,pendente_classificacao,exibir_na_vitrine,estoque_total,imagem_emoji,imagem_url,descricao_ia_seo,tags_busca_ia,criado_em)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,0,?,?,?,?,?)`,
        fid, ean, nome, pa, conc, forma, tipoMed, lab, cat, custoC, vendaC, promoC, receita, vitrine, emoji, img, desc, tags, agora
      ).lastInsertRowid;
    };

    const p = {};
    // Medicamentos de Uso Contínuo (com concentração, forma farmacêutica e tipo_medicamento explícitos — Lei 9.787/99)
    p.losartanaRef = P({
      fid: f1, ean: "7891058001155", nome: "Losartana Referência Original 50mg c/ 30 comp.",
      pa: "losartana", conc: "50mg", forma: "COMPRIMIDO", tipoMed: "REFERENCIA",
      lab: "LabCardio Ref", cat: "REFERENCIA", custoC: 5800, vendaC: 8490, receita: 1, vitrine: 0, seloImg: "50mg REF",
    });
    p.losartanaGen = P({
      fid: f1, ean: "7896004703398", nome: "Losartana Potássica 50mg c/ 30 comp. (Genérico)",
      pa: "losartana", conc: "50mg", forma: "COMPRIMIDO", tipoMed: "GENERICO",
      lab: "BioGenéricos Brasil", cat: "GENERICO_ALTA_MARGEM", custoC: 420, vendaC: 1990, receita: 1, vitrine: 0, seloImg: "GENÉRICO",
    });
    p.losartana100Ref = P({
      fid: f1, ean: "7891058001199", nome: "Losartana Referência Original 100mg c/ 30 comp.",
      pa: "losartana", conc: "100mg", forma: "COMPRIMIDO", tipoMed: "REFERENCIA",
      lab: "LabCardio Ref", cat: "REFERENCIA", custoC: 7900, vendaC: 11990, receita: 1, vitrine: 0, seloImg: "100mg REF",
    });
    p.metforminaRef = P({
      fid: f1, ean: "7891058015206", nome: "Metformina XR Referência 500mg c/ 30 comp.",
      pa: "metformina", conc: "500mg", forma: "COMPRIMIDO_XR", tipoMed: "REFERENCIA",
      lab: "GlicoLab Ref", cat: "REFERENCIA", custoC: 1450, vendaC: 2490, receita: 1, vitrine: 0, seloImg: "500mg XR",
    });
    p.metforminaGen = P({
      fid: f1, ean: "7896422504812", nome: "Cloridrato de Metformina XR 500mg c/ 30 comp. (Genérico)",
      pa: "metformina", conc: "500mg", forma: "COMPRIMIDO_XR", tipoMed: "GENERICO",
      lab: "BioGenéricos Brasil", cat: "GENERICO_ALTA_MARGEM", custoC: 310, vendaC: 1390, receita: 1, vitrine: 0, seloImg: "GENÉRICO",
    });
    p.rosuvaRef = P({
      fid: f1, ean: "7896206401290", nome: "Rosuvastatina Referência 10mg c/ 30 comp.",
      pa: "rosuvastatina", conc: "10mg", forma: "COMPRIMIDO", tipoMed: "REFERENCIA",
      lab: "LipidLab Ref", cat: "REFERENCIA", custoC: 9200, vendaC: 13990, receita: 1, vitrine: 0, seloImg: "10mg REF",
    });
    p.rosuvaGen = P({
      fid: f1, ean: "7896112440147", nome: "Rosuvastatina Cálcica 10mg c/ 30 comp. (Genérico)",
      pa: "rosuvastatina", conc: "10mg", forma: "COMPRIMIDO", tipoMed: "GENERICO",
      lab: "EuroGen Farma", cat: "GENERICO_ALTA_MARGEM", custoC: 1100, vendaC: 4490, receita: 1, vitrine: 0, seloImg: "GENÉRICO",
    });
    p.levoRef = P({
      fid: f1, ean: "7891106000932", nome: "Levotiroxina Sódica 50mcg c/ 30 comp.",
      pa: "levotiroxina", conc: "50mcg", forma: "COMPRIMIDO", tipoMed: "REFERENCIA",
      lab: "EndoFarma", cat: "CONTINUO", custoC: 890, vendaC: 1690, receita: 1, vitrine: 0, seloImg: "50mcg",
    });
    p.anlodGen = P({
      fid: f1, ean: "7896714213214", nome: "Besilato de Anlodipino 5mg c/ 30 comp. (Genérico)",
      pa: "anlodipino", conc: "5mg", forma: "COMPRIMIDO", tipoMed: "GENERICO",
      lab: "BioGenéricos Brasil", cat: "GENERICO_ALTA_MARGEM", custoC: 240, vendaC: 1490, receita: 1, vitrine: 0, seloImg: "GENÉRICO",
    });
    p.anlodRef = P({
      fid: f1, ean: "7891268102345", nome: "Anlodipino Referência 5mg c/ 30 comp.",
      pa: "anlodipino", conc: "5mg", forma: "COMPRIMIDO", tipoMed: "REFERENCIA",
      lab: "PressLab Ref", cat: "REFERENCIA", custoC: 3800, vendaC: 5990, receita: 1, vitrine: 0, seloImg: "5mg REF",
    });

    // Vitrine Digital (Venda Livre — Conformidade RDC 44/2009 — Descrições factuais sem alegações terapêuticas)
    p.vitC = P({
      fid: f1, ean: "7896015514208", nome: "Vitamina C Efervescente 1g + Zinco c/ 10 tubos",
      pa: "acido ascorbico", conc: "1g", forma: "COMPRIMIDO_EFERVESCENTE", tipoMed: "NAO_MEDICAMENTO",
      lab: "Associadas Nutri", cat: "VITAMINAS", custoC: 750, vendaC: 2290, promoC: 1690, receita: 0, vitrine: 1, emoji: "🍊", seloImg: "VIT C 1g",
      desc: "Suplemento alimentar em comprimidos efervescentes com 1g de Vitamina C e Zinco. Sabor laranja sem adição de açúcares.",
      tags: "vitamina c,efervescente,zinco,suplemento",
    });
    p.vitD = P({
      fid: f1, ean: "7898040322134", nome: "Vitamina D3 Colecalciferol 2.000UI c/ 60 cápsulas",
      pa: "colecalciferol", conc: "2000ui", forma: "CAPSULA", tipoMed: "NAO_MEDICAMENTO",
      lab: "Associadas Nutri", cat: "VITAMINAS", custoC: 1500, vendaC: 3990, receita: 0, vitrine: 1, emoji: "☀️", seloImg: "VIT D3",
      desc: "Suplemento alimentar de Vitamina D3 (2.000 UI por cápsula). Embalagem com 60 cápsulas gelatinosas.",
      tags: "vitamina d,colecalciferol,capsulas",
    });
    p.omega = P({
      fid: f1, ean: "7896094902514", nome: "Ômega 3 EPA/DHA 1000mg c/ 120 cápsulas",
      pa: "oleo de peixe", conc: "1000mg", forma: "CAPSULA", tipoMed: "NAO_MEDICAMENTO",
      lab: "Associadas Nutri", cat: "VITAMINAS", custoC: 2800, vendaC: 7490, promoC: 5890, receita: 0, vitrine: 1, emoji: "🐟", seloImg: "ÔMEGA 3",
      desc: "Suplemento alimentar de óleo de peixe em cápsulas de 1000mg contendo EPA e DHA. Frasco com 120 unidades.",
      tags: "omega 3,epa,dha,oleo de peixe",
    });
    p.cerave = P({
      fid: f1, ean: "3337875597180", nome: "Loção Hidratante Corporal & Facial Ceramidas 473ml",
      lab: "DermoClin Associadas", cat: "DERMOCOSMETICOS", custoC: 6200, vendaC: 10990, receita: 0, vitrine: 1, emoji: "🧴", seloImg: "DERMO 473ml",
      desc: "Loção hidratante de uso diário com ceramidas e ácido hialurônico para pele seca. Embalagem de 473ml.",
      tags: "hidratante,pele seca,ceramidas,dermocosmetico",
    });
    p.laroche = P({
      fid: f1, ean: "3337875546430", nome: "Protetor Solar Facial FPS 60 Toque Seco 40g",
      lab: "DermoClin Associadas", cat: "DERMOCOSMETICOS", custoC: 4800, vendaC: 8990, receita: 0, vitrine: 1, emoji: "🌞", seloImg: "FPS 60",
      desc: "Protetor solar facial FPS 60 com acabamento toque seco. Bisnaga de 40g.",
      tags: "protetor solar,fps 60,rosto,toque seco",
    });
    p.fralda = P({
      fid: f1, ean: "7500435141710", nome: "Fralda Infantil Descartável Tam. G c/ 46 unidades",
      lab: "BabyCare Associadas", cat: "INFANTIL", custoC: 5200, vendaC: 7990, receita: 0, vitrine: 1, emoji: "👶", seloImg: "TAM. G 46u",
      desc: "Fralda descartável infantil tamanho G (9 a 12,5 kg) com barreiras laterais. Pacote com 46 unidades.",
      tags: "fralda,bebe,infantil",
    });
    p.shampoo = P({
      fid: f1, ean: "7891024132807", nome: "Shampoo Anticaspa Uso Diário Mentolado 400ml",
      lab: "Associadas Care", cat: "PERFUMARIA", custoC: 1400, vendaC: 2990, receita: 0, vitrine: 1, emoji: "🧼", seloImg: "SHAMPOO",
      desc: "Shampoo para higiene diária do couro cabeludo. Frasco de 400ml.",
      tags: "shampoo,caspa,higiene,cabelo",
    });
    p.creme = P({
      fid: f1, ean: "7891010604479", nome: "Creme Dental Dentes Sensíveis c/ Flúor 100g",
      lab: "OralCare Associadas", cat: "PERFUMARIA", custoC: 1300, vendaC: 2790, receita: 0, vitrine: 1, emoji: "🦷", seloImg: "DENTAL",
      desc: "Creme dental com flúor para higiene bucal diária de dentes sensíveis. Bisnaga de 100g.",
      tags: "creme dental,sensibilidade,dentes",
    });
    p.whey = P({
      fid: f1, ean: "7898596080018", nome: "Suplemento Colágeno Tipo II + Magnésio c/ 60 cápsulas",
      lab: "Associadas Senior", cat: "VITAMINAS", custoC: 2400, vendaC: 6490, receita: 0, vitrine: 1, emoji: "💪", seloImg: "COLÁGENO",
      desc: "Suplemento alimentar em cápsulas contendo Colágeno Tipo II (40mg) e Magnésio. Frasco com 60 cápsulas.",
      tags: "colageno,magnesio,suplemento",
    });
    p.dipirona = P({
      fid: f1, ean: "7896422503310", nome: "Dipirona Monoidratada 1g c/ 10 comp. (MIP)",
      pa: "dipirona", conc: "1g", forma: "COMPRIMIDO", tipoMed: "MIP",
      lab: "BioGenéricos Brasil", cat: "CONVENIENCIA", custoC: 210, vendaC: 990, receita: 0, vitrine: 1, emoji: "🩹", seloImg: "MIP 1g",
      desc: "Medicamento Isento de Prescrição (MIP) — Dipirona Monoidratada 1g. Não use este medicamento em caso de gravidez ou alergia à dipirona. Persistindo os sintomas, o médico deverá ser consultado.",
      tags: "dor,febre,dipirona",
    });

    // Produto tarjado para testar trava ANVISA RDC 44/2009
    p.amoxi = P({
      fid: f1, ean: "7896004713656", nome: "Amoxicilina Tri-Hidratada 500mg c/ 21 cápsulas",
      pa: "amoxicilina", conc: "500mg", forma: "CAPSULA", tipoMed: "GENERICO",
      lab: "BioGenéricos Brasil", cat: "REFERENCIA", custoC: 1200, vendaC: 3490, receita: 1, vitrine: 0, seloImg: "TARJADO",
    });

    // Produto exclusivo da Loja 2 (Batel)
    const pBatel = P({
      fid: f2, ean: "7896015514208", nome: "Vitamina C 1g (Loja Batel)",
      pa: "acido ascorbico", conc: "1g", forma: "COMPRIMIDO_EFERVESCENTE",
      lab: "Batel", cat: "VITAMINAS", custoC: 750, vendaC: 1990, receita: 0, vitrine: 1, emoji: "🍊", seloImg: "BATEL",
    });

    // Lotes de Estoque (Fonte Única do Estoque Total via FEFO)
    const L = (fid, prod, lote, qtd, custoC, dias, acao = "NENHUMA", desc = 0, com = 0, salvas = 0) => {
      run(
        `INSERT INTO lotes_estoque (farmacia_id,produto_id,numero_lote,nota_fiscal_ref,quantidade_atual,custo_unitario_centavos,data_validade,acao_queima_ativa,desconto_aplicado_pct,comissao_extra_balconista_pct,unidades_salvas,criado_em)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        fid, prod, lote, "NFe 35.221", qtd, custoC, somarDias(hoje, dias), acao, desc, com, salvas, agora
      );
      sincronizarEstoqueProduto(prod);
    };

    L(f1, p.vitC, "VC2611A", 24, 750, 18, "COMBO_RELAMPAGO", 25, 6, 14);
    L(f1, p.vitC, "VC2705B", 56, 750, 240, "NENHUMA", 0, 0, 0);
    L(f1, p.omega, "OM8812", 10, 2800, 26, "DESTAQUE_VITRINE", 20, 5, 8);
    L(f1, p.omega, "OM9100", 25, 2800, 300, "NENHUMA", 0, 0, 0);
    L(f1, p.cerave, "CV0042", 6, 6200, 48, "NENHUMA", 0, 0, 3);
    L(f1, p.cerave, "CV0099", 16, 6200, 320, "NENHUMA", 0, 0, 0);
    L(f1, p.whey, "CL5521", 8, 2400, 54, "COMISSAO_BONUS_EQUIPE", 0, 6, 5);
    L(f1, p.whey, "CL5900", 20, 2400, 290, "NENHUMA", 0, 0, 0);
    L(f1, p.laroche, "LR7790", 9, 4800, 81, "NENHUMA", 0, 0, 0);
    L(f1, p.laroche, "LR8100", 9, 4800, 310, "NENHUMA", 0, 0, 0);
    L(f1, p.vitD, "VD1102", 15, 1500, 87, "NENHUMA", 0, 0, 0);
    L(f1, p.vitD, "VD1900", 35, 1500, 360, "NENHUMA", 0, 0, 0);
    L(f1, p.losartanaRef, "LRF100", 40, 5800, 380);
    L(f1, p.losartanaGen, "LS4410", 180, 420, 410);
    L(f1, p.losartana100Ref, "LRF101", 25, 7900, 380);
    L(f1, p.metforminaRef, "MRF200", 60, 1450, 390);
    L(f1, p.metforminaGen, "MGN201", 150, 310, 400);
    L(f1, p.rosuvaRef, "RRF300", 25, 9200, 350);
    L(f1, p.rosuvaGen, "RGN301", 90, 1100, 420);
    L(f1, p.levoRef, "LVF400", 70, 890, 340);
    L(f1, p.anlodGen, "AGN500", 120, 240, 430);
    L(f1, p.anlodRef, "ARF501", 20, 3800, 360);
    L(f1, p.fralda, "PF3001", 30, 5200, 520);
    L(f1, p.shampoo, "SH4001", 40, 1400, 480);
    L(f1, p.creme, "CR5001", 60, 1300, 460);
    L(f1, p.dipirona, "DP6001", 100, 210, 500);
    L(f1, p.amoxi, "AM7001", 40, 1200, 300);
    L(f2, pBatel, "BT1001", 10, 750, 300);

    // Clientes + Movimentações de Cashback com validade_em futura
    const C = (nome, tel, end, cep, cbCentavos, gastoCentavos) => {
      const cid = run(
        `INSERT INTO clientes (farmacia_id,nome,telefone_whatsapp,endereco_entrega,cep,saldo_cashback_centavos,total_gasto_centavos,lgpd_consentimento_saude_em,lgpd_optin_comunicacao_em,lgpd_consentimento_canal,criado_em)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        f1, nome, tel, end, cep, cbCentavos, gastoCentavos, agora, agora, "PRESENCIAL_BALCAO", agora
      ).lastInsertRowid;
      if (cbCentavos > 0) {
        run(
          `INSERT INTO movimentacoes_cashback (farmacia_id, cliente_id, pedido_id, tipo, valor_centavos, validade_em, criado_em)
           VALUES (?,?,NULL,'CREDITO',?,?,?)`,
          f1, cid, cbCentavos, somarDias(hoje, 90), agora
        );
      }
      return cid;
    };

    const c = [
      C("Dona Maria Aparecida Souza", "5541991110001", "Rua Marechal Deodoro, 210, Apto 42 — Centro", "80020-320", 1450, 184000),
      C("Sr. José Carlos Ferreira", "5541991110002", "Av. Sete de Setembro, 3300 — Rebouças", "80230-010", 620, 96000),
      C("Dona Antônia Ribeiro", "5541991110003", "Rua Emiliano Perneta, 88 — Centro", "80010-050", 980, 231000),
      C("Carlos Henrique Dias", "5541991110004", "Rua Visconde de Guarapuava, 1500 — Centro", "80060-060", 0, 54000),
      C("Luiza Martins", "5541991110005", "Rua Comendador Araújo, 600 — Batel", "80420-000", 2400, 312000),
      C("Sr. Sebastião Nunes", "5541991110006", "Rua André de Barros, 45 — Centro", "80010-080", 500, 78000),
      C("Helena Prado", "5541991110007", "Rua Desembargador Westphalen, 900 — Rebouças", "80230-100", 1150, 129000),
      C("Roberto Lima", "5541991110008", "Rua Saldanha Marinho, 1200 — Centro", "80430-150", 0, 43000),
    ];

    // Tratamentos de Uso Contínuo (Token guardado como hash SHA-256 + validade da receita)
    const T = (ci, prod, dur, diasAtras, status, valorC = 0, tokenClaro = null, diasValidadeReceita = 90) => {
      const ultima = somarDias(hoje, -diasAtras);
      const rawToken = tokenClaro || crypto.randomBytes(24).toString("base64url");
      const tokenHash = hashSha256(rawToken);
      run(
        `INSERT INTO tratamentos_continuos (farmacia_id,cliente_id,produto_id,duracao_dias,dias_antecedencia_alerta,data_ultima_compra,data_disparo_whatsapp,receita_valida_ate,status_recompra,valor_recuperado_centavos,confirmado_em,token_recompra_hash,token_expira_em,cadastrado_por,criado_em)
         VALUES (?,?,?,?,5,?,?,?,?,?,?,?,?,?,?)`,
        f1,
        c[ci],
        prod,
        dur,
        ultima,
        somarDias(ultima, dur - 5),
        somarDias(hoje, diasValidadeReceita),
        status,
        valorC,
        status === "RECOMPRA_CONFIRMADA" ? agora : null,
        tokenHash,
        somarDias(hoje, 7),
        b1,
        agora
      );
    };

    T(0, p.losartanaGen, 30, 25, "ALERTA_5_DIAS", 0, env.DEMO_MODE ? TOKEN_DEMO_MARIA : null, 120);
    T(1, p.metforminaGen, 30, 26, "ALERTA_5_DIAS", 0, null, 90);
    T(2, p.rosuvaGen, 30, 25, "MONITORANDO", 0, null, 60);
    T(3, p.levoRef, 30, 23, "MONITORANDO", 0, null, 60);
    T(4, p.anlodGen, 60, 40, "MONITORANDO", 0, null, 120);
    T(5, p.losartanaRef, 30, 12, "MONITORANDO", 0, null, 90);
    T(6, p.metforminaGen, 30, 27, "MENSAGEM_ENVIADA", 0, null, 45);
    T(7, p.rosuvaGen, 30, 3, "RECOMPRA_CONFIRMADA", 8980);
    T(4, p.losartanaGen, 30, 2, "RECOMPRA_CONFIRMADA", 5970);
    T(2, p.anlodGen, 30, 1, "RECOMPRA_CONFIRMADA", 4470);

    // Reservas da Vitrine Digital (Retirada Rápida na Loja — Click & Collect, sem taxa de entrega)
    const PED = (ci, cod, subC, origem, status, dAtras, itensArr) => {
      const dataPed = `${somarDias(hoje, -dAtras)} ${agora.slice(11)}`;
      run(
        `INSERT INTO pedidos_vitrine (farmacia_id,codigo_pedido,cliente_id,cliente_nome,cliente_whatsapp,endereco_entrega,cep,forma_pagamento,subtotal_centavos,taxa_entrega_centavos,total_centavos,economia_mkt_centavos,itens_json,status_pedido,origem,cashback_gerado_centavos,criado_em)
         SELECT ?,?,id,nome,telefone_whatsapp,'Retirada no Balcão da Loja',cep,'PIX_DIRETO',?,0,?, ?, ?,?,?,?,? FROM clientes WHERE id = ?`,
        f1,
        cod,
        subC,
        subC,
        Math.round(subC * 0.22),
        JSON.stringify(itensArr),
        status,
        origem,
        status === "CONCLUIDO" ? Math.round(subC * 0.05) : 0,
        dataPed,
        c[ci]
      );
    };

    PED(4, "FAR-1001", 19980, "VITRINE_DIGITAL", "CONCLUIDO", 5, [
      { nome: "Loção Hidratante Corporal & Facial Ceramidas 473ml", quantidade: 1, preco_unitario: 109.9 },
      { nome: "Protetor Solar Facial FPS 60 Toque Seco 40g", quantidade: 1, preco_unitario: 89.9 },
    ]);
    PED(0, "FAR-1002", 11780, "RECOMPRA_USO_CONTINUO", "CONCLUIDO", 3, [
      { nome: "Ômega 3 EPA/DHA 1000mg c/ 120 cápsulas", quantidade: 2, preco_unitario: 58.9 },
    ]);
    PED(6, "FAR-1003", 15980, "VITRINE_DIGITAL", "CONCLUIDO", 1, [
      { nome: "Fralda Infantil Descartável Tam. G c/ 46 unidades", quantidade: 2, preco_unitario: 79.9 },
    ]);
    PED(2, "FAR-1004", 10990, "VITRINE_DIGITAL", "SEPARANDO", 0, [
      { nome: "Loção Hidratante Corporal & Facial Ceramidas 473ml", quantidade: 1, preco_unitario: 109.9 },
    ]);
    PED(1, "FAR-1005", 7580, "VITRINE_DIGITAL", "NOVO", 0, [
      { nome: "Vitamina C Efervescente 1g + Zinco", quantidade: 1, preco_unitario: 16.9 },
      { nome: "Ômega 3 EPA/DHA 1000mg", quantidade: 1, preco_unitario: 58.9 },
    ]);

    // Orçamentos de Receita já triados pela IA
    const orc1 = run(
      `INSERT INTO orcamentos_receita (farmacia_id, cliente_nome, cliente_whatsapp, consentimento_lgpd_receita, medico_proibiu_substituicao, texto_informado, motor_ia, status_triagem, valor_ref_centavos, valor_otimizado_centavos, margem_ganha_centavos, ganho_extra_margem_centavos, criado_em)
       VALUES (?,?,?,1,0,?,?, 'AGUARDANDO_APROVACAO', 27460, 9260, 6190, 0, ?)`,
      f1,
      "Dona Maria Aparecida Souza",
      "5541991110001",
      "1) Losartana 50mg — 1 caixa (uso contínuo)\n2) Metformina XR 500mg — 2 caixas\n3) Rosuvastatina 10mg — 1 caixa",
      "copiloto-local-deterministico",
      agora
    ).lastInsertRowid;

    run(
      `INSERT INTO itens_orcamento_ia (orcamento_id, item_prescrito_texto, produto_referencia_id, produto_sugerido_id, quantidade, preco_ref_centavos, preco_sugerido_centavos, margem_sugerido_pct, substituicao_bloqueada, sem_estoque)
       VALUES (?,?,?,?,?,?,?,?,0,0), (?,?,?,?,?,?,?,?,0,0), (?,?,?,?,?,?,?,?,0,0)`,
      orc1, "Losartana 50mg (1 cx)", p.losartanaRef, p.losartanaGen, 1, 8490, 1990, 78.9,
      orc1, "Metformina XR 500mg (2 cx)", p.metforminaRef, p.metforminaGen, 2, 2490, 1390, 77.7,
      orc1, "Rosuvastatina 10mg (1 cx)", p.rosuvaRef, p.rosuvaGen, 1, 13990, 4490, 75.5
    );

    const orc2 = run(
      `INSERT INTO orcamentos_receita (farmacia_id, cliente_nome, cliente_whatsapp, consentimento_lgpd_receita, medico_proibiu_substituicao, texto_informado, motor_ia, status_triagem, valor_ref_centavos, valor_otimizado_centavos, margem_ganha_centavos, ganho_extra_margem_centavos, atendido_por_usuario_id, tempo_resposta_segundos, criado_em)
       VALUES (?,?,?,1,0,?,?, 'CONVERTIDO_EM_VENDA', 11980, 2980, 2500, 0, ?, 38, ?)`,
      f1,
      "Sr. Sebastião Nunes",
      "5541991110006",
      "Anlodipino 5mg — 2 caixas (uso contínuo)",
      "copiloto-local-deterministico",
      farm,
      agora
    ).lastInsertRowid;

    run(
      `INSERT INTO itens_orcamento_ia (orcamento_id, item_prescrito_texto, produto_referencia_id, produto_sugerido_id, quantidade, preco_ref_centavos, preco_sugerido_centavos, margem_sugerido_pct, substituicao_bloqueada, sem_estoque)
       VALUES (?,?,?,?,?,?,?,?,0,0)`,
      orc2, "Anlodipino 5mg (2 cx)", p.anlodRef, p.anlodGen, 2, 5990, 1490, 83.9
    );

    // Checklists ANVISA com hash de integridade SHA-256 e carimbo_data_hora em America/Sao_Paulo
    const addPop = (tipo, val, conf, obs) => {
      const h = hashSha256(`${f1}:${tipo}:${val}:${conf}:${obs}:${farm}:${agora}`);
      run(
        `INSERT INTO checklists_anvisa (farmacia_id,tipo_pop,valor_medido,dentro_conformidade,observacao,assinado_por_usuario_id,hash_integridade,carimbo_data_hora)
         VALUES (?,?,?,?,?,?,?,?)`,
        f1, tipo, val, conf, obs, farm, h, agora
      );
    };
    addPop("TEMPERATURA_GELADEIRA", 4.6, 1, "Câmara de termolábeis estável entre 2°C e 8°C.");
    addPop("TEMPERATURA_AMBIENTE", 22.4, 1, "Climatização central operante.");
    addPop("CONFERENCIA_ARMARIO_CONTROLADOS", null, 1, "Conferência física interna da Portaria 344/98 concluída sem divergências.");
  });

  return { farmacias: all("SELECT id, slug FROM farmacias") };
}
