// Serviço de Pedidos + Cashback (Aritmética 100% em Centavos INTEGER, Saída FEFO por Lote, Trava ANVISA RDC 44/2009)
import crypto from "node:crypto";
import { all, consumirEstoqueFEFO, get, run, sincronizarEstoqueProduto, tx } from "../database/conexao.js";
import { agoraSP, deCentavos, HttpError, hojeSP, normalizarWhatsapp, somarDias } from "../utils/comum.js";
import { enfileirar } from "./whatsappDispatcherService.js";

function upsertCliente(farmaciaId, { nome, whatsapp, endereco, cep }) {
  const tel = normalizarWhatsapp(whatsapp);
  const existente = get("SELECT * FROM clientes WHERE farmacia_id = ? AND telefone_whatsapp = ?", farmaciaId, tel);
  if (existente) {
    if (endereco && endereco !== existente.endereco_entrega) {
      run("UPDATE clientes SET endereco_entrega = ?, cep = COALESCE(?, cep) WHERE id = ?", endereco, cep || null, existente.id);
    }
    return existente.id;
  }
  return run(
    "INSERT INTO clientes (farmacia_id, nome, telefone_whatsapp, endereco_entrega, cep, criado_em) VALUES (?,?,?,?,?,?)",
    farmaciaId,
    nome,
    tel,
    endereco || null,
    cep || null,
    agoraSP()
  ).lastInsertRowid;
}

/**
 * Calcula e sincroniza o saldo líquido de cashback NÃO EXPIRADO (validade_em >= hojeSP) de um cliente.
 */
export function calcularSaldoCashbackValido(clienteId, farmaciaId) {
  const hoje = hojeSP();
  const row = get(
    `SELECT COALESCE(SUM(
              CASE
                WHEN tipo = 'CREDITO' AND (validade_em IS NULL OR validade_em >= ?) THEN valor_centavos
                WHEN tipo IN ('RESGATE', 'ESTORNO') THEN -valor_centavos
                ELSE 0
              END
            ), 0) AS saldo_valido
       FROM movimentacoes_cashback
      WHERE cliente_id = ? AND farmacia_id = ?`,
    hoje,
    clienteId,
    farmaciaId
  );
  const saldo = Math.max(0, Number(row?.saldo_valido || 0));
  run("UPDATE clientes SET saldo_cashback_centavos = ? WHERE id = ? AND farmacia_id = ?", saldo, clienteId, farmaciaId);
  return saldo;
}

export function formatarPedido(p) {
  if (!p) return null;
  return {
    ...p,
    subtotal: deCentavos(p.subtotal_centavos),
    taxa_entrega: deCentavos(p.taxa_entrega_centavos),
    cashback_usado: deCentavos(p.cashback_usado_centavos),
    cashback_gerado: deCentavos(p.cashback_gerado_centavos),
    total: deCentavos(p.total_centavos),
    economia_taxa_ifood: deCentavos(p.economia_mkt_centavos),
    troco_para: p.troco_para_centavos ? deCentavos(p.troco_para_centavos) : null,
  };
}

/**
 * Cria pedido de forma atômica em centavos inteiros:
 * - origem VITRINE_DIGITAL: bloqueia itens com exige_receita ou pendente_classificacao (RDC 44/2009) -> HTTP 422
 * - origem RECOMPRA_USO_CONTINUO com item tarjado: cria pedido em status AGUARDANDO_VALIDACAO_RT (Lei 13.021/2014)
 *   e NÃO permite abatimento de cashback sobre medicamentos tarjados
 * - Saída FEFO nos lotes válidos (bloqueia lotes vencidos)
 */
export function criarPedido({
  farmacia,
  itens,
  cliente,
  formaPagamento,
  trocoParaCentavos = null,
  origem,
  chaveIdempotencia,
  usarCashback = false,
  clienteAutorizadoId = null,
  tratamentoId = null,
  exigeValidacaoRt = false,
}) {
  if (chaveIdempotencia) {
    const ja = get("SELECT * FROM pedidos_vitrine WHERE chave_idempotencia = ? AND farmacia_id = ?", chaveIdempotencia, farmacia.id);
    if (ja) return { pedido: formatarPedido(ja), duplicado: true };
  }

  return tx(() => {
    const agora = agoraSP();
    const linhas = [];
    let subtotalCentavos = 0;
    let subtotalElegivelCashbackCentavos = 0;
    let contemTarjado = false;

    for (const { produto_id, quantidade } of itens) {
      const p = get("SELECT * FROM produtos WHERE id = ? AND farmacia_id = ?", produto_id, farmacia.id);
      if (!p) throw new HttpError(404, `Produto ${produto_id} não encontrado nesta farmácia.`);
      if (p.pendente_classificacao) {
        throw new HttpError(
          422,
          `"${p.nome_comercial}" aguarda classificação sanitária pelo(a) Farmacêutico(a) RT e ainda não pode ser vendido.`
        );
      }
      if (origem === "VITRINE_DIGITAL") {
        if (p.exige_receita) {
          throw new HttpError(
            422,
            `"${p.nome_comercial}" exige prescrição médica (ANVISA RDC 44/2009). Utilize o botão de Avaliação Farmacêutica de Receita.`,
            { acao: "ENVIAR_RECEITA" }
          );
        }
        if (!p.exibir_na_vitrine) {
          throw new HttpError(422, `"${p.nome_comercial}" não está disponível para compra direta na vitrine.`);
        }
      }

      if (p.exige_receita) contemTarjado = true;

      // Consome dos lotes válidos por ordem FEFO (primeiro a vencer, primeiro a sair; bloqueia vencidos)
      const lotesUsados = consumirEstoqueFEFO(farmacia.id, p.id, quantidade);
      const precoUnitCentavos = p.preco_promo_centavos ?? p.preco_venda_centavos;
      const linhaSubtotalC = precoUnitCentavos * quantidade;

      linhas.push({
        produto_id: p.id,
        nome: p.nome_comercial,
        quantidade,
        preco_unitario_centavos: precoUnitCentavos,
        preco_unitario: deCentavos(precoUnitCentavos),
        exige_receita_na_entrega: !!p.exige_receita,
        lotes_fefo: lotesUsados,
      });

      subtotalCentavos += linhaSubtotalC;
      if (!p.exige_receita) {
        subtotalElegivelCashbackCentavos += linhaSubtotalC;
      }
    }

    const clienteId = clienteAutorizadoId || upsertCliente(farmacia.id, cliente);
    let cashbackUsadoCentavos = 0;

    // Governança de Cashback:
    // - Aplica apenas o saldo NÃO EXPIRADO (validade_em >= hojeSP)
    // - Aplica exclusivamente sobre itens NÃO TARJADOS (subtotalElegivelCashbackCentavos > 0)
    // - Teto de 30% do subtotal elegível
    if (usarCashback && clienteAutorizadoId && subtotalElegivelCashbackCentavos > 0) {
      const saldoDisp = calcularSaldoCashbackValido(clienteId, farmacia.id);
      const tetoPct = (farmacia.cashback_teto_pedido_pct || 30) / 100;
      const maximoPermitido = Math.round(subtotalElegivelCashbackCentavos * tetoPct);
      cashbackUsadoCentavos = Math.min(saldoDisp, maximoPermitido, subtotalElegivelCashbackCentavos);
    }

    const taxaCentavos = 0; // Reserva & Retirada na Loja (Click & Collect): sem taxa de entrega
    const totalCentavos = Math.max(0, subtotalCentavos - cashbackUsadoCentavos);
    const taxaMktPct = (farmacia.taxa_marketplace_ref_pct || 22) / 100;
    const economiaMktCentavos = Math.round(subtotalCentavos * taxaMktPct);
    const codigo = "FAR-" + crypto.randomBytes(3).toString("hex").toUpperCase();
    const statusInicial = contemTarjado || exigeValidacaoRt ? "AGUARDANDO_VALIDACAO_RT" : "NOVO";
    const localRetirada = cliente.endereco || "Retirada no Balcão da Loja";

    const pedidoId = run(
      `INSERT INTO pedidos_vitrine (farmacia_id,codigo_pedido,chave_idempotencia,cliente_id,cliente_nome,cliente_whatsapp,endereco_entrega,cep,forma_pagamento,
        troco_para_centavos,subtotal_centavos,taxa_entrega_centavos,cashback_usado_centavos,total_centavos,economia_mkt_centavos,itens_json,status_pedido,origem,tratamento_id,criado_em)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      farmacia.id,
      codigo,
      chaveIdempotencia || null,
      clienteId,
      cliente.nome,
      normalizarWhatsapp(cliente.whatsapp),
      localRetirada,
      cliente.cep || null,
      formaPagamento,
      trocoParaCentavos,
      subtotalCentavos,
      taxaCentavos,
      cashbackUsadoCentavos,
      totalCentavos,
      economiaMktCentavos,
      JSON.stringify(linhas),
      statusInicial,
      origem,
      tratamentoId,
      agora
    ).lastInsertRowid;

    if (cashbackUsadoCentavos > 0) {
      run(
        "INSERT INTO movimentacoes_cashback (farmacia_id, cliente_id, pedido_id, tipo, valor_centavos, criado_em) VALUES (?,?,?, 'RESGATE', ?, ?)",
        farmacia.id,
        clienteId,
        pedidoId,
        cashbackUsadoCentavos,
        agora
      );
      calcularSaldoCashbackValido(clienteId, farmacia.id);
    }

    return { pedido: formatarPedido(get("SELECT * FROM pedidos_vitrine WHERE id = ?", pedidoId)), duplicado: false };
  });
}

const TRANSICOES = {
  AGUARDANDO_VALIDACAO_RT: ["SEPARANDO", "CANCELADO"],
  NOVO: ["SEPARANDO", "CANCELADO"],
  SEPARANDO: ["PRONTO_RETIRADA", "SAIU_ENTREGA", "CONCLUIDO", "CANCELADO"],
  PRONTO_RETIRADA: ["CONCLUIDO", "CANCELADO"],
  SAIU_ENTREGA: ["CONCLUIDO", "CANCELADO"],
  CONCLUIDO: ["DEVOLVIDO"],
  CANCELADO: [],
  DEVOLVIDO: [],
};

export function atualizarStatusPedido(farmacia, pedidoId, novoStatus, usuarioLogado = null) {
  const resultado = tx(() => {
    const agora = agoraSP();
    const p = get("SELECT * FROM pedidos_vitrine WHERE id = ? AND farmacia_id = ?", pedidoId, farmacia.id);
    if (!p) throw new HttpError(404, "Pedido não encontrado.");
    if (!TRANSICOES[p.status_pedido]?.includes(novoStatus)) {
      throw new HttpError(409, `Transição inválida: ${p.status_pedido} → ${novoStatus}.`);
    }

    // Pedido retido para validação farmacêutica só pode ser liberado por FARMACEUTICO (com CRF)
    if (p.status_pedido === "AGUARDANDO_VALIDACAO_RT" && novoStatus === "SEPARANDO") {
      if (usuarioLogado && usuarioLogado.cargo !== "FARMACEUTICO" && !usuarioLogado.crf_uf) {
        throw new HttpError(403, "Pedidos de medicamentos sujeitos a prescrição exigem validação exclusiva do(a) Farmacêutico(a) RT com CRF ativo (Lei 13.021/2014).");
      }
      run("UPDATE pedidos_vitrine SET validado_por_rt_id = ? WHERE id = ?", usuarioLogado?.id || null, p.id);
      if (p.tratamento_id) {
        run(
          "UPDATE tratamentos_continuos SET status_recompra = 'RECOMPRA_CONFIRMADA', validado_por_rt_id = ? WHERE id = ?",
          usuarioLogado?.id || null,
          p.tratamento_id
        );
      }
    }

    run("UPDATE pedidos_vitrine SET status_pedido = ? WHERE id = ?", novoStatus, p.id);

    // Estorno de estoque e cashback em CANCELADO ou DEVOLVIDO (sem apagar histórico contábil!)
    if (novoStatus === "CANCELADO" || novoStatus === "DEVOLVIDO") {
      for (const l of JSON.parse(p.itens_json || "[]")) {
        if (Array.isArray(l.lotes_fefo)) {
          for (const lf of l.lotes_fefo) {
            run("UPDATE lotes_estoque SET quantidade_atual = quantidade_atual + ? WHERE id = ?", lf.quantidade, lf.lote_id);
          }
        }
        if (l.produto_id) sincronizarEstoqueProduto(l.produto_id);
      }
      if (p.cashback_usado_centavos > 0 && p.cliente_id) {
        run(
          "INSERT OR IGNORE INTO movimentacoes_cashback (farmacia_id, cliente_id, pedido_id, tipo, valor_centavos, validade_em, criado_em) VALUES (?,?,?, 'CREDITO', ?, ?, ?)",
          farmacia.id,
          p.cliente_id,
          p.id,
          p.cashback_usado_centavos,
          somarDias(hojeSP(), 90),
          agora
        );
      }
      if (novoStatus === "DEVOLVIDO" && p.cashback_gerado_centavos > 0 && p.cliente_id) {
        run(
          "INSERT OR IGNORE INTO movimentacoes_cashback (farmacia_id, cliente_id, pedido_id, tipo, valor_centavos, criado_em) VALUES (?,?,?, 'ESTORNO', ?, ?)",
          farmacia.id,
          p.cliente_id,
          p.id,
          p.cashback_gerado_centavos,
          agora
        );
      }
      if (p.cliente_id) calcularSaldoCashbackValido(p.cliente_id, farmacia.id);
    }

    let cashbackGeradoCentavos = 0;
    if (novoStatus === "CONCLUIDO" && p.cliente_id) {
      // Gera cashback apenas sobre itens não-tarjados
      const itensArr = JSON.parse(p.itens_json || "[]");
      const subtotalNaoTarjado = itensArr
        .filter((i) => !i.exige_receita_na_entrega)
        .reduce((s, i) => s + Number(i.preco_unitario_centavos || 0) * Number(i.quantidade || 1), 0);
      const baseLiquida = Math.max(0, subtotalNaoTarjado - p.cashback_usado_centavos);
      cashbackGeradoCentavos = Math.round(baseLiquida * ((farmacia.cashback_pct || 5) / 100));
      if (cashbackGeradoCentavos > 0) {
        run(
          "INSERT OR IGNORE INTO movimentacoes_cashback (farmacia_id, cliente_id, pedido_id, tipo, valor_centavos, validade_em, criado_em) VALUES (?,?,?, 'CREDITO', ?, ?, ?)",
          farmacia.id,
          p.cliente_id,
          p.id,
          cashbackGeradoCentavos,
          somarDias(hojeSP(), 90),
          agora
        );
      }
      calcularSaldoCashbackValido(p.cliente_id, farmacia.id);
      run("UPDATE clientes SET total_gasto_centavos = total_gasto_centavos + ? WHERE id = ?", p.total_centavos, p.cliente_id);
      run("UPDATE pedidos_vitrine SET cashback_gerado_centavos = ? WHERE id = ?", cashbackGeradoCentavos, p.id);
    }

    return {
      pedido: formatarPedido(get("SELECT * FROM pedidos_vitrine WHERE id = ?", p.id)),
      cashbackGerado: deCentavos(cashbackGeradoCentavos),
    };
  });

  // Convite neutro "Avalie sua experiência" (sem pedir "5 estrelas", sem citar CPF e desvinculado do cashback)
  if (novoStatus === "CONCLUIDO" && farmacia.google_maps_review_url) {
    const primeiro = resultado.pedido.cliente_nome.split(" ")[0];
    const texto =
      `Olá, ${primeiro}! Sua reserva ${resultado.pedido.codigo_pedido} na ${farmacia.nome_fantasia} foi retirada no balcão. ` +
      `Caso deseje compartilhar sua opinião sobre o atendimento, avalie sua experiência em: ${farmacia.google_maps_review_url}`;
    const fila = enfileirar({
      farmacia,
      chave: `pos_venda:${resultado.pedido.id}`,
      tipo: "POS_VENDA_EXPERIENCIA",
      telefone: resultado.pedido.cliente_whatsapp,
      texto,
    });
    run("UPDATE pedidos_vitrine SET link_avaliacao_enviado = 1 WHERE id = ?", resultado.pedido.id);
    resultado.linkPosVenda = fila.link_wa_me;
    resultado.mensagemPosVenda = texto;
    resultado.filaId = fila.id;
  }
  return resultado;
}

export function listarPedidos(farmaciaId, status, page = 1, limit = 50) {
  const offset = (Math.max(1, page) - 1) * Math.min(100, limit);
  const lim = Math.min(100, limit);
  const rows = status
    ? all("SELECT * FROM pedidos_vitrine WHERE farmacia_id = ? AND status_pedido = ? ORDER BY id DESC LIMIT ? OFFSET ?", farmaciaId, status, lim, offset)
    : all("SELECT * FROM pedidos_vitrine WHERE farmacia_id = ? ORDER BY id DESC LIMIT ? OFFSET ?", farmaciaId, lim, offset);
  return rows.map((r) => ({
    ...formatarPedido(r),
    itens: JSON.parse(r.itens_json || "[]"),
    itens_json: undefined,
    chave_idempotencia: undefined,
  }));
}
