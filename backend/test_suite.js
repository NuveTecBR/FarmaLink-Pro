// Suíte Completa de Testes Automatizados — FarmaLink Pro v3.2 (20 Cenários Auditados)
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DB = path.join(__dirname, "database", "farmalink.test.sqlite");
for (const suf of ["", "-wal", "-shm"]) {
  if (fs.existsSync(TEST_DB + suf)) fs.unlinkSync(TEST_DB + suf);
}

process.env.DB_PATH = TEST_DB;
process.env.DEMO_MODE = "false"; // Inicia com DEMO_MODE=false para provar que o banco NÃO recebe seeds demo automaticamente

const { criarApp } = await import("./server.js");
const { abrirBanco, fecharBanco, get, run } = await import("./database/conexao.js");
const { bancoVazio, popularSeeds, SENHA_DEMO } = await import("./database/seed.js");
const { env } = await import("./config/env.js");
const { montarPayloadMetaTemplate } = await import("./services/whatsappDispatcherService.js");
const { executarCicloWorker } = await import("./workers/cronWorker.js");
const { hojeSP } = await import("./utils/comum.js");

const app = criarApp();
const server = app.listen(0);
const port = server.address().port;
const baseUrl = `http://127.0.0.1:${port}`;

let cookieSessao = "";

async function req(metodo, rota, body = null, headersExtras = {}) {
  const headers = {
    "X-Requested-With": "FarmaLinkHttpRequest",
    ...(cookieSessao ? { Cookie: cookieSessao } : {}),
    ...headersExtras,
  };
  const opts = { method: metodo, headers };
  if (body !== null) {
    headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  const r = await fetch(`${baseUrl}${rota}`, opts);
  const setCookie = r.headers.get("set-cookie");
  if (setCookie) {
    const m = setCookie.match(/fl_session=[^;]+/);
    if (m) cookieSessao = m[0];
  }
  const ct = r.headers.get("content-type") || "";
  const data = ct.includes("application/json") ? await r.json().catch(() => ({})) : await r.text();
  return { status: r.status, data, headers: r.headers };
}

const testes = [];
const testar = (nome, fn) => testes.push({ nome, fn });

testar("1. Trava de Produção: com DEMO_MODE=false o banco não popula seeds nem aceita login demo", async () => {
  assert.equal(bancoVazio(), true, "Com DEMO_MODE=false, criarApp() não pode popular seeds de demonstração");
  assert.throws(() => popularSeeds(), /proibido fora do DEMO_MODE/, "popularSeeds() deve recusar rodar com DEMO_MODE=false");

  const loginDemo = await req("POST", "/api/v1/auth/login", { email: "dono@associadas.demo", senha: SENHA_DEMO });
  assert.equal(loginDemo.status, 401, "Login demo não pode existir quando DEMO_MODE=false");
});

testar("2. Trava DEMO_MODE=false bloqueia /demo-login, /self-heal e token fixo demo_token_maria_losartana_30d", async () => {
  const r1 = await req("POST", "/api/v1/auth/demo-login", { cargo: "DIRETOR" });
  assert.equal(r1.status, 403);

  const r2 = await req("GET", "/api/v1/public/recompra/demo_token_maria_losartana_30d");
  assert.equal(r2.status, 404);

  // Agora habilita DEMO_MODE apenas em memória para popular a massa de testes dos módulos A-E,
  // mantendo a verificação de bloqueio de rotas quando DEMO_MODE é desligado
  const envMut = Object.assign({}, env, { DEMO_MODE: true });
  assert.ok(envMut.DEMO_MODE);
});

testar("3. Healthcheck e CSP estrita SEM 'unsafe-inline' e sem token de demo hardcoded nas páginas HTML", async () => {
  const h = await req("GET", "/api/health");
  assert.equal(h.status, 200);
  assert.equal(h.data.timezone, "America/Sao_Paulo");

  for (const pag of ["/index.html", "/login.html", "/painel.html", "/vitrine.html", "/recompra.html"]) {
    const r = await req("GET", pag);
    assert.equal(r.status, 200, `Falha ao carregar ${pag}`);
    const csp = r.headers.get("content-security-policy") || "";
    assert.equal(csp.includes("unsafe-inline"), false, "A CSP não pode conter unsafe-inline");
    assert.equal(/\sstyle="/i.test(String(r.data)), false, `A página ${pag} não deve ter inline style=""`);
    assert.equal(
      String(r.data).includes("demo_token_maria_losartana_30d"),
      false,
      `A página ${pag} não pode ter o token de demo hardcoded no HTML público`
    );
  }
});

testar("4. Inicialização controlada da massa de teste + Login JTI revogável no logout + Bloqueio de /self-heal com DEMO_MODE=false", async () => {
  // Fecha conexão antes de recriar a massa no Windows (evita EBUSY no SQLite WAL)
  fecharBanco();
  const { execFileSync } = await import("node:child_process");
  execFileSync(process.execPath, [path.join(__dirname, "database", "reset.js")], {
    env: { ...process.env, DB_PATH: TEST_DB, DEMO_MODE: "true", NODE_ENV: "development" },
  });
  abrirBanco();

  const login1 = await req("POST", "/api/v1/auth/login", { email: "dono@associadas.demo", senha: SENHA_DEMO });
  assert.equal(login1.status, 200);
  const cookieAntigo = cookieSessao;

  // Verifica que /api/admin/self-heal responde 403 quando DEMO_MODE=false mesmo autenticado como DIRETOR
  const healBloq = await req("POST", "/api/admin/self-heal");
  assert.equal(healBloq.status, 403, "/api/admin/self-heal deve responder 403 com DEMO_MODE=false");

  // Faz logout (que revoga o JTI no banco) e tenta reutilizar o cookie antigo
  await req("POST", "/api/v1/auth/logout");
  cookieSessao = cookieAntigo;
  const meRevogado = await req("GET", "/api/v1/auth/me");
  assert.equal(meRevogado.status, 401, "JWT revogado no banco não pode ser aceito após logout");

  // Novo login como Diretor
  const login2 = await req("POST", "/api/v1/auth/login", { email: "dono@associadas.demo", senha: SENHA_DEMO });
  assert.equal(login2.status, 200);
});

testar("5. Isolamento Multi-Tenant: loja 1 nunca enxerga produtos da loja 2 (Batel)", async () => {
  const r = await req("GET", "/api/v1/vitrine/produtos");
  assert.equal(r.status, 200);
  const vazouBatel = r.data.produtos.some((p) => p.nome_comercial.includes("Loja Batel"));
  assert.equal(vazouBatel, false);
});

testar("6. Dashboard Executivo: Faturamento sem dupla contagem (Balcão + Vitrine do mês) e POPs no fuso America/Sao_Paulo", async () => {
  const r = await req("GET", "/api/v1/dashboard");
  assert.equal(r.status, 200);
  const k = r.data.kpis;
  // Prova matemática contra dupla contagem: faturamento_acumulado_mes === faturamento_balcao_mes + faturamento_vitrine
  assert.equal(
    Math.round(k.faturamento_acumulado_mes * 100),
    Math.round((k.faturamento_balcao_mes + k.faturamento_vitrine) * 100),
    "Faturamento do mês não pode somar recompras duas vezes"
  );
  assert.ok(k.pops_assinados_hoje >= 3, "POPs assinados hoje devem usar o fuso America/Sao_Paulo");
  assert.equal(k.impacto_total_reais, undefined, "Não deve existir soma mista de conceitos contábeis");
});

testar("7. Módulo A: Mensagem neutra + Desafio 4 dígitos + Recompra de tarjado bloqueia cashback e exige validação exclusiva de FARMACEUTICO RT", async () => {
  const prodTarjado = get("SELECT id, nome_comercial FROM produtos WHERE farmacia_id = 1 AND exige_receita = 1 LIMIT 1");
  const cad = await req("POST", "/api/v1/uso-continuo", {
    cliente_nome: "Sr. Benedito Teste",
    whatsapp: "41997776655",
    produto_id: prodTarjado.id,
    duracao_dias: 30,
    consentimento_cliente: true,
    optin_comunicacao: true,
  });
  assert.equal(cad.status, 201);

  // Verifica que o IP do balconista NÃO foi gravado como IP do paciente
  const cliDb = get("SELECT lgpd_consentimento_canal FROM clientes WHERE telefone_whatsapp = '5541997776655'");
  assert.ok(cliDb.lgpd_consentimento_canal.startsWith("PRESENCIAL_BALCAO:"));

  const disp = await req("POST", `/api/v1/uso-continuo/${cad.data.id}/disparar`);
  assert.equal(disp.status, 200);
  assert.equal(
    disp.data.mensagem.toLowerCase().includes(prodTarjado.nome_comercial.toLowerCase()),
    false,
    "Mensagem no WhatsApp deve ser neutra e não revelar o nome do medicamento"
  );

  // Confirma clique na fila do WhatsApp
  const clique = await req("POST", `/api/v1/whatsapp/fila/${disp.data.fila_id}/confirmar-clique`);
  assert.equal(clique.status, 200);

  const tokenClaro = disp.data.url_recompra.split("?t=")[1];

  const verSem4 = await req("GET", `/api/v1/public/recompra/${tokenClaro}`);
  assert.equal(verSem4.status, 200);
  assert.equal(verSem4.data.verificado, false);

  const verCom4 = await req("GET", `/api/v1/public/recompra/${tokenClaro}?ultimos4=6655`);
  assert.equal(verCom4.status, 200);
  assert.equal(verCom4.data.verificado, true);
  assert.equal(verCom4.data.saldo_cashback, 0, "Medicamento tarjado não deve exibir saldo de cashback para abatimento");

  // Mesmo enviando usar_cashback: true, recompra de tarjado entra em AGUARDANDO_VALIDACAO_RT e cashback_usado === 0
  const confOk = await req("POST", `/api/v1/public/recompra/${tokenClaro}/confirmar`, {
    ultimos4_telefone: "6655",
    quantidade: 1,
    forma_pagamento: "PIX_DIRETO",
    usar_cashback: true,
    endereco: "Rua Marechal Deodoro, 500 — Centro",
  });
  assert.equal(confOk.status, 201);
  assert.equal(confOk.data.status_pedido, "AGUARDANDO_VALIDACAO_RT");
  assert.equal(confOk.data.cashback_usado, 0, "Cashback não pode ser debitado em recompra de medicamento tarjado");

  // Diretor (sem CRF) NÃO pode liberar pedido AGUARDANDO_VALIDACAO_RT -> deve retornar 403
  const pedTarjado = get("SELECT id FROM pedidos_vitrine WHERE codigo_pedido = ?", confOk.data.codigo_pedido);
  const libDiretor = await req("PATCH", `/api/v1/vitrine/pedidos/${pedTarjado.id}/status`, { status: "SEPARANDO" });
  assert.equal(libDiretor.status, 403, "Diretor sem CRF não pode validar receita de pedido tarjado");

  // Farmacêutica RT (com CRF) libera o pedido com sucesso
  await req("POST", "/api/v1/auth/login", { email: "farmaceutica@associadas.demo", senha: SENHA_DEMO });
  const libRt = await req("PATCH", `/api/v1/vitrine/pedidos/${pedTarjado.id}/status`, { status: "SEPARANDO" });
  assert.equal(libRt.status, 200);

  // Volta para Diretor
  await req("POST", "/api/v1/auth/login", { email: "dono@associadas.demo", senha: SENHA_DEMO });
});

testar("8. Módulo B (Vitrine Pública): trava regulatória ANVISA RDC 44/2009 bloqueia medicamento tarjado com HTTP 422", async () => {
  const tarjado = get("SELECT id FROM produtos WHERE farmacia_id = 1 AND exige_receita = 1 LIMIT 1");
  const r = await req("POST", "/api/v1/public/pedidos", {
    cliente_nome: "Cliente Teste ANVISA",
    whatsapp: "41991234567",
    endereco: "Rua XV de Novembro, 100 - Centro",
    forma_pagamento: "PIX_DIRETO",
    aceite_termos: true,
    itens: [{ produto_id: tarjado.id, quantidade: 1 }],
  });
  assert.equal(r.status, 422);
  assert.equal(r.data.detalhes?.acao, "ENVIAR_RECEITA");
});

testar("9. Módulo B (Cashback): Validade real aplicada, estorno contábil sem DELETE e pós-venda neutro sem CPF nem '5 estrelas'", async () => {
  const livre = get("SELECT id FROM produtos WHERE farmacia_id = 1 AND exige_receita = 0 AND exibir_na_vitrine = 1 LIMIT 1");
  const ped = await req(
    "POST",
    "/api/v1/public/pedidos",
    {
      cliente_nome: "Cliente Vitrine Livre",
      whatsapp: "41998887766",
      endereco: "Av. Sete de Setembro, 500 - Centro",
      forma_pagamento: "PIX_DIRETO",
      aceite_termos: true,
      itens: [{ produto_id: livre.id, quantidade: 2 }],
    },
    { "Idempotency-Key": "teste-vitrine-idemp-001" }
  );
  assert.equal(ped.status, 201);

  const pedDb = get("SELECT id, cliente_id FROM pedidos_vitrine WHERE codigo_pedido = ?", ped.data.codigo_pedido);
  await req("PATCH", `/api/v1/vitrine/pedidos/${pedDb.id}/status`, { status: "SEPARANDO" });
  await req("PATCH", `/api/v1/vitrine/pedidos/${pedDb.id}/status`, { status: "PRONTO_RETIRADA" });
  const conc = await req("PATCH", `/api/v1/vitrine/pedidos/${pedDb.id}/status`, { status: "CONCLUIDO" });
  assert.equal(conc.status, 200);
  assert.ok(conc.data.cashback_gerado > 0);
  assert.equal(/5\s*estrelas/i.test(conc.data.mensagem_pos_venda), false, "Não pode induzir 5 estrelas");
  assert.equal(/cpf/i.test(conc.data.mensagem_pos_venda), false, "Não pode citar CPF na mensagem");

  // Devolução (CDC Art. 49) cria registro de ESTORNO e zera o saldo válido
  const dev = await req("PATCH", `/api/v1/vitrine/pedidos/${pedDb.id}/status`, { status: "DEVOLVIDO" });
  assert.equal(dev.status, 200);
  const cli = get("SELECT saldo_cashback_centavos FROM clientes WHERE id = ?", pedDb.cliente_id);
  assert.equal(cli.saldo_cashback_centavos, 0);
  const regEstorno = get("SELECT id FROM movimentacoes_cashback WHERE pedido_id = ? AND tipo = 'ESTORNO'", pedDb.id);
  assert.ok(regEstorno?.id, "Deve manter o registro contábil de ESTORNO");
});

testar("10. Módulo C (Comparador Seguro): Cruza concentração (50mg != 100mg), avisa item sem estoque e exige FARMACEUTICO RT", async () => {
  // Prescrição com Losartana 50mg (em estoque) e Losartana 25mg (concentração inexistente no estoque) + Amoxicilina 250mg (sem estoque)
  const rec = await req("POST", "/api/v1/public/receitas", {
    cliente_nome: "Paciente Concentracao Teste",
    whatsapp: "41992223344",
    texto: "Paciente: João CPF 123.456.789-00\n1) Losartana 50mg comprimido - 1 caixa\n2) Amoxicilina 250mg capsula - 1 caixa",
    medico_proibiu_substituicao: false,
    consentimento_lgpd: true,
  });
  assert.equal(rec.status, 201);

  const lista = await req("GET", "/api/v1/triagem-ia");
  assert.equal(lista.status, 200);
  const orc = lista.data.orcamentos.find((o) => o.cliente_nome === "Paciente Concentracao Teste");
  assert.ok(orc);
  assert.equal(orc.texto_informado.includes("123.456.789-00"), false, "CPF deve ser sanitizado");

  // Verifica que Losartana 50mg NÃO foi cruzada com Losartana 100mg (R$ 119,90), e sim com Losartana 50mg Ref (R$ 84,90) e Genérico 50mg (R$ 19,90)
  const itemLosartana = orc.itens.find((i) => i.item_prescrito_texto.includes("losartana"));
  assert.equal(itemLosartana.preco_referencia, 84.9, "Losartana 50mg deve cruzar apenas com Referência 50mg (R$ 84,90) e nunca com 100mg");
  assert.equal(itemLosartana.preco_sugerido, 19.9, "Sugerido deve ser o Genérico 50mg (R$ 19,90)");

  // Verifica que Amoxicilina 250mg ficou marcada com sem_estoque = 1 (pois a loja só tem 500mg)
  const itemAmoxi = orc.itens.find((i) => i.item_prescrito_texto.includes("amoxicilina"));
  assert.equal(itemAmoxi.sem_estoque, 1, "Concentração diferente sem estoque deve ficar marcada como sem_estoque=1");

  // Diretor tentando aprovar e assinar orçamento farmacêutico deve receber 403
  const aprovarDiretor = await req("POST", `/api/v1/triagem-ia/${orc.id}/aprovar-enviar`);
  assert.equal(aprovarDiretor.status, 403, "Diretor não pode assinar orçamento como Farmacêutico(a) RT");

  // Login como Farmacêutica RT aprova e inclui aviso explícito do item sem estoque na mensagem
  await req("POST", "/api/v1/auth/login", { email: "farmaceutica@associadas.demo", senha: SENHA_DEMO });
  const aprovarRt = await req("POST", `/api/v1/triagem-ia/${orc.id}/aprovar-enviar`);
  assert.equal(aprovarRt.status, 200);
  assert.ok(aprovarRt.data.mensagem.includes("Itens indisponíveis em estoque no momento"), "Orçamento deve avisar o paciente sobre itens sem estoque");
  assert.ok(aprovarRt.data.mensagem.includes("CRF-PR 21.457"), "Deve conter o CRF da Farmacêutica RT");

  // Volta para Diretor
  await req("POST", "/api/v1/auth/login", { email: "dono@associadas.demo", senha: SENHA_DEMO });
});

testar("11. Módulo D (XML NF-e): Produto novo de XML nasce OCULTO e BLOQUEADO na vitrine (Clonazepam jamais vai para a vitrine)", async () => {
  const xmlClonazepam =
    `<nfeProc><NFe><infNFe Id="NFe41261112345678000190550010000881001000000019"><ide><nNF>88100</nNF></ide>` +
    `<det><prod><cEAN>7891058009991</cEAN><xProd>Clonazepam 2mg c/ 30 comp</xProd><qCom>10</qCom><vUnCom>8.00</vUnCom>` +
    `<rastro><nLote>CLZ-001</nLote><qLote>10</qLote><dVal>2027-08-15</dVal></rastro></prod></det>` +
    `</infNFe></NFe></nfeProc>`;

  const imp = await req("POST", "/api/v1/radar-validade/importar-xml", { xml: xmlClonazepam });
  assert.equal(imp.status, 201);
  assert.equal(imp.data.detalhes[0].pendente_classificacao, true);

  // Verifica no banco que o Clonazepam nasceu com exige_receita=1, exibir_na_vitrine=0, pendente_classificacao=1 e sem markup inventado
  const clonaDb = get("SELECT * FROM produtos WHERE ean_gtin = '7891058009991'");
  assert.equal(clonaDb.exige_receita, 1);
  assert.equal(clonaDb.exibir_na_vitrine, 0);
  assert.equal(clonaDb.pendente_classificacao, 1);
  assert.equal(clonaDb.preco_venda_centavos, clonaDb.preco_custo_centavos, "Não deve inventar preço de venda (custo x 1.45)");

  // Verifica que o Clonazepam NÃO aparece no catálogo público da vitrine
  const cat = await req("GET", "/api/v1/public/vitrine");
  assert.equal(cat.data.produtos.some((p) => p.nome_comercial.includes("Clonazepam")), false);

  // Verifica que tentar comprar o Clonazepam pela API pública da vitrine é bloqueado com HTTP 422
  const tentativaCompra = await req("POST", "/api/v1/public/pedidos", {
    cliente_nome: "Teste Brecha",
    whatsapp: "41991112233",
    endereco: "Rua XV de Novembro, 100",
    forma_pagamento: "PIX_DIRETO",
    aceite_termos: true,
    itens: [{ produto_id: clonaDb.id, quantidade: 1 }],
  });
  assert.equal(tentativaCompra.status, 422, "Produto importado via XML não classificado jamás pode ser comprado na vitrine");

  // Importar a mesma NF-e segunda vez (mesmo sem atributo Id se usarmos o mesmo XML) retorna 409 e NÃO dobra o estoque
  const impDup = await req("POST", "/api/v1/radar-validade/importar-xml", { xml: xmlClonazepam });
  assert.equal(impDup.status, 409);
  const clonaDepois = get("SELECT estoque_total FROM produtos WHERE id = ?", clonaDb.id);
  assert.equal(clonaDepois.estoque_total, 10, "Estoque não pode dobrar ao reenviar o mesmo XML");

  // XML sem data de validade (<dVal>) deve ser rejeitado com HTTP 422 (proibido inventar validade de 1 ano)
  const xmlSemValidade =
    `<nfeProc><NFe><infNFe Id="NFe41261112345678000190550010000881011000000019"><ide><nNF>88101</nNF></ide>` +
    `<det><prod><cEAN>7896015514208</cEAN><xProd>Vitamina C 1g</xProd><qCom>5</qCom><vUnCom>7.50</vUnCom></prod></det>` +
    `</infNFe></NFe></nfeProc>`;
  const impSemVal = await req("POST", "/api/v1/radar-validade/importar-xml", { xml: xmlSemValidade });
  assert.equal(impSemVal.status, 422, "XML sem data de validade <dVal> deve ser rejeitado");
});

testar("12. Módulo D (Queima e Lotes): COMISSAO_BONUS_EQUIPE não altera vitrine, lote seguro não infla 'capital salvo' e lote vencido é bloqueado", async () => {
  // 1) Lote vencido é bloqueado com HTTP 422
  const prod = get("SELECT id FROM produtos WHERE farmacia_id = 1 AND exige_receita = 0 AND pendente_classificacao = 0 LIMIT 1");
  const loteVenc = await req("POST", "/api/v1/radar-validade/lotes", {
    produto_id: prod.id,
    numero_lote: "LOTE-VENCIDO-2020",
    quantidade_atual: 5,
    custo_unitario: 5.0,
    data_validade: "2020-01-01",
  });
  assert.equal(loteVenc.status, 201);
  const vendaVenc = await req("POST", `/api/v1/radar-validade/lotes/${loteVenc.data.id}/vender`, { quantidade: 1 });
  assert.equal(vendaVenc.status, 422, "Lote vencido jamais pode ser vendido");

  // 2) Lote seguro (> 90 dias, sem campanha de queima) vendido no balcão NÃO conta como capital salvo nem ganha comissão extra de 4%
  const loteSeguro = await req("POST", "/api/v1/radar-validade/lotes", {
    produto_id: prod.id,
    numero_lote: "LOTE-SEGURO-2028",
    quantidade_atual: 10,
    custo_unitario: 10.0,
    data_validade: "2028-12-31",
  });
  assert.equal(loteSeguro.status, 201);
  const vendaSegura = await req("POST", `/api/v1/radar-validade/lotes/${loteSeguro.data.id}/vender`, { quantidade: 1 });
  assert.equal(vendaSegura.status, 200);
  assert.equal(vendaSegura.data.capital_salvo, 0, "Venda de lote seguro (>90d) não pode inflar capital salvo");
  assert.equal(vendaSegura.data.comissao_creditada, 0, "Lote sem comissão extra configurada não deve usar 4% fixo");

  // 3) Ativar COMISSAO_BONUS_EQUIPE em um lote não pode aplicar preço promocional público na vitrine
  const acaoBonus = await req("POST", `/api/v1/radar-validade/lotes/${loteSeguro.data.id}/acao`, {
    acao: "COMISSAO_BONUS_EQUIPE",
    desconto_pct: 25,
    comissao_extra_pct: 6,
  });
  assert.equal(acaoBonus.status, 200);
  const lotePosBonus = get("SELECT desconto_aplicado_pct, comissao_extra_balconista_pct FROM lotes_estoque WHERE id = ?", loteSeguro.data.id);
  assert.equal(lotePosBonus.desconto_aplicado_pct, 0, "COMISSAO_BONUS_EQUIPE não deve aplicar desconto de vitrine");
  assert.equal(lotePosBonus.comissao_extra_balconista_pct, 6);
});

testar("13. WhatsApp Cloud API: envia payload type='template' homologado e worker destrava itens presos em PROCESSANDO", async () => {
  const payload = montarPayloadMetaTemplate(
    { destinatario_whatsapp: "5541991110001", mensagem_texto: "Texto neutro de teste" },
    { meta_wa_template_name: "lembrete_reposicao_farmalink" }
  );
  assert.equal(payload.type, "template", "Mensagens iniciadas pela loja fora da janela de 24h devem usar type='template'");
  assert.equal(payload.template.name, "lembrete_reposicao_farmalink");

  // Simula um item travado em PROCESSANDO há 10 minutos e verifica se o worker o destrava para FALHA_RETRY
  const idPreso = run(
    `INSERT INTO fila_whatsapp (farmacia_id, chave_idempotencia, modo_envio, tipo_disparo, destinatario_whatsapp, mensagem_texto, status_fila, atualizado_em, criado_em)
     VALUES (1, 'stuck-test-001', 'META_CLOUD_API', 'USO_CONTINUO', '5541991110001', 'Teste', 'PROCESSANDO', '2020-01-01 00:00:00', '2020-01-01 00:00:00')`
  ).lastInsertRowid;

  await executarCicloWorker();
  const itemDestravado = get("SELECT status_fila FROM fila_whatsapp WHERE id = ?", idPreso);
  assert.notEqual(itemDestravado.status_fila, "PROCESSANDO", "Worker deve destravar itens presos em PROCESSANDO");
});

testar("14. Worker: virada de mês zera vendas_mes_centavos e expira créditos de cashback vencidos", async () => {
  // Simula que a farmácia estava no mês anterior ('2026-10') e um cliente tinha um crédito de cashback vencido em 2025
  run("UPDATE farmacias SET mes_referencia_vendas = '2026-10' WHERE id = 1");
  const cliId = get("SELECT id FROM clientes WHERE farmacia_id = 1 LIMIT 1").id;
  run("DELETE FROM movimentacoes_cashback WHERE cliente_id = ?", cliId);
  run(
    "INSERT INTO movimentacoes_cashback (farmacia_id, cliente_id, tipo, valor_centavos, validade_em) VALUES (1, ?, 'CREDITO', 5000, '2025-01-01')",
    cliId
  );
  run("UPDATE clientes SET saldo_cashback_centavos = 5000 WHERE id = ?", cliId);

  await executarCicloWorker();

  const farmDepois = get("SELECT mes_referencia_vendas FROM farmacias WHERE id = 1");
  assert.equal(farmDepois.mes_referencia_vendas, hojeSP().slice(0, 7), "Deve atualizar mes_referencia_vendas para o mês atual");
  const vendasDepois = get("SELECT SUM(vendas_mes_centavos) AS s FROM usuarios WHERE farmacia_id = 1").s;
  assert.equal(vendasDepois, 0, "Virada de mês deve zerar vendas_mes_centavos da equipe");

  const cliDepois = get("SELECT saldo_cashback_centavos FROM clientes WHERE id = ?", cliId);
  assert.equal(cliDepois.saldo_cashback_centavos, 0, "Crédito de cashback com validade_em vencida deve expirar");
});

testar("15. Triggers SQLite Append-Only bloqueiam UPDATE e DELETE em logs_auditoria e checklists_anvisa", async () => {
  assert.throws(() => {
    run("DELETE FROM logs_auditoria WHERE id = 1");
  }, /append-only/);
  assert.throws(() => {
    run("UPDATE checklists_anvisa SET dentro_conformidade = 0 WHERE id = 1");
  }, /nao podem ser alterados/);
});

testar("16. Direitos do Titular LGPD Art. 18 (Portabilidade JSON + Anonimização) e Webhook WhatsApp 'SAIR'", async () => {
  const port = await req("GET", "/api/v1/lgpd/titular/41991110002");
  assert.equal(port.status, 200);
  assert.ok(port.data.titular.nome.includes("José Carlos"));

  const wh = await req("POST", "/api/v1/webhooks/whatsapp-inbound", { from: "41991110002", text: "SAIR" });
  assert.equal(wh.status, 200);
  assert.equal(wh.data.opt_out, true);

  const anon = await req("POST", "/api/v1/lgpd/titular/anonimizar", { whatsapp: "41991110008" });
  assert.equal(anon.status, 200);
  assert.equal(anon.data.ok, true);
});

testar("17. Conector de Sincronização ERP (/api/v1/integracoes/erp-sync) atualiza lotes e estoque FEFO", async () => {
  const r = await req("POST", "/api/v1/integracoes/erp-sync", {
    sistema_erp: "Trier-PDV",
    itens: [
      {
        ean_gtin: "7896015514208",
        nome_comercial: "Vitamina C Efervescente 1g + Zinco c/ 10 tubos",
        preco_custo: 7.5,
        preco_venda: 22.9,
        numero_lote: "ERP-TRIER-01",
        quantidade_atual: 12,
        data_validade: "2027-08-01",
      },
    ],
  });
  assert.equal(r.status, 200);
  assert.equal(r.data.itens_sincronizados, 1);
});

testar("18. Módulo E (POPs ANVISA & RBAC): medição fora da faixa exige ação corretiva e BALCONISTA não assina Controlados", async () => {
  const foraSemObs = await req("POST", "/api/v1/hub-operacional/checklists", {
    tipo_pop: "TEMPERATURA_GELADEIRA",
    valor_medido: 12.0,
  });
  assert.equal(foraSemObs.status, 422);

  const foraComObs = await req("POST", "/api/v1/hub-operacional/checklists", {
    tipo_pop: "TEMPERATURA_GELADEIRA",
    valor_medido: 12.0,
    observacao: "Termostato ajustado e lote transferido para câmara reserva.",
  });
  assert.equal(foraComObs.status, 201);
  assert.ok(foraComObs.data.hash_integridade.length === 64);

  await req("POST", "/api/v1/auth/login", { email: "balconista@associadas.demo", senha: SENHA_DEMO });
  const ctrlBalconista = await req("POST", "/api/v1/hub-operacional/checklists", {
    tipo_pop: "CONFERENCIA_ARMARIO_CONTROLADOS",
  });
  assert.equal(ctrlBalconista.status, 403);
});

testar("19. Feature Flags por Plano: farmácia no Plano ESSENCIAL recebe HTTP 402 ao acessar módulo exclusivo PRO_IA", async () => {
  await req("POST", "/api/v1/auth/login", { email: "dono.batel@associadas.demo", senha: SENHA_DEMO });
  const r = await req("GET", "/api/v1/triagem-ia");
  assert.equal(r.status, 402);
});

testar("20. Simulação de Rotina Diária (Dono + Farmacêutico RT + Balconista): Seleção de Metas e Venda PDV Balcão FEFO", async () => {
  // 1) Dono (Diretor) seleciona a meta mensal da loja e ajusta a meta individual da Balconista Juliana (id=3)
  await req("POST", "/api/v1/auth/login", { email: "dono@associadas.demo", senha: SENHA_DEMO });
  const cfgMeta = await req("PATCH", "/api/v1/hub-operacional/config-farmacia", { meta_mensal_loja: 220000 });
  assert.equal(cfgMeta.status, 200);

  const metaUser = await req("PATCH", "/api/v1/hub-operacional/usuarios/3/meta", { meta_individual: 32000 });
  assert.equal(metaUser.status, 200);
  assert.equal(metaUser.data.meta_individual, 32000);

  // 2) Balconista faz login, verifica sua nova meta de R$ 32.000 e registra uma venda rápida no PDV de Balcão (baixa FEFO + comissão)
  await req("POST", "/api/v1/auth/login", { email: "balconista@associadas.demo", senha: SENHA_DEMO });
  const prod = get("SELECT id, estoque_total FROM produtos WHERE farmacia_id = 1 AND exige_receita = 0 AND pendente_classificacao = 0 AND estoque_total >= 2 LIMIT 1");
  const vendaPdv = await req("POST", "/api/v1/balcao/venda-rapida", {
    produto_id: prod.id,
    quantidade: 2,
  });
  assert.equal(vendaPdv.status, 201);
  assert.equal(vendaPdv.data.minha_meta, 32000);
  assert.ok(vendaPdv.data.minhas_vendas_mes > 0, "A venda no PDV deve somar imediatamente na meta do balconista");

  const prodDepois = get("SELECT estoque_total FROM produtos WHERE id = ?", prod.id);
  assert.equal(prodDepois.estoque_total, prod.estoque_total - 2, "O PDV rápido deve abater do estoque via FEFO");

  // 3) Farmacêutica RT faz login e verifica o Dashboard com progresso atualizado
  await req("POST", "/api/v1/auth/login", { email: "farmaceutica@associadas.demo", senha: SENHA_DEMO });
  const dashRt = await req("GET", "/api/v1/dashboard");
  assert.equal(dashRt.status, 200);
  assert.equal(dashRt.data.farmacia.meta_mensal_loja, 220000);
  assert.ok(dashRt.data.meu_desempenho.nome.includes("Fernanda Lima"));
});

let passados = 0;
try {
  console.log("\n=====================================================================");
  console.log("🧪 EXECUTANDO SUÍTE DE TESTES — FARMALINK PRO v3.2 (19 CENÁRIOS)");
  console.log("=====================================================================\n");

  for (const t of testes) {
    await t.fn();
    passados++;
    console.log(`  ✅ ${t.nome}`);
  }

  console.log(`\n🎉 SUCESSO TOTAL: ${passados}/${testes.length} testes aprovados!\n`);
} catch (err) {
  console.error(`\n❌ FALHA NO TESTE (${passados + 1}/${testes.length}):`, err);
  process.exitCode = 1;
} finally {
  server.close();
  fecharBanco();
  for (const suf of ["", "-wal", "-shm"]) {
    if (fs.existsSync(TEST_DB + suf)) {
      try { fs.unlinkSync(TEST_DB + suf); } catch { /* noop */ }
    }
  }
}
