// Módulo E — Intranet Operacional, POPs ANVISA (com Hash SHA-256 Append-Only), Direitos do Titular LGPD e Conector ERP
import { z } from "zod";
import { all, consumirEstoqueFEFO, get, run, sincronizarEstoqueProduto, tx } from "../database/conexao.js";
import { auditar } from "../middlewares/seguranca.js";
import { agoraSP, deCentavos, dinheiro, hashSha256, HttpError, normalizarWhatsapp, paraCentavos } from "../utils/comum.js";

const LIMITES_POP = {
  TEMPERATURA_GELADEIRA: { min: 2.0, max: 8.0, unidade: "°C", rotulo: "Temperatura da Geladeira de Termolábeis (2°C a 8°C)" },
  TEMPERATURA_AMBIENTE: { min: 15.0, max: 30.0, unidade: "°C", rotulo: "Temperatura Ambiente da Loja (15°C a 30°C)" },
  UMIDADE_AMBIENTE: { min: 40.0, max: 70.0, unidade: "%", rotulo: "Umidade Relativa do Ambiente (40% a 70%)" },
  LIMPEZA_SALA_INJETAVEIS: { min: null, max: null, unidade: "check", rotulo: "Higienização e Assepsia da Sala de Injetáveis" },
  CONFERENCIA_ARMARIO_CONTROLADOS: {
    min: null,
    max: null,
    unidade: "check",
    rotulo: "Conferência Física Interna do Armário de Controlados (Portaria 344/98 — Não substitui o SNGPC oficial)",
  },
};

export function listarHub(req, res) {
  const fid = req.usuario.farmacia_id;
  const checklists = all(
    `SELECT c.*, u.nome AS assinado_por_nome, u.cargo AS assinado_por_cargo, u.crf_uf
       FROM checklists_anvisa c
       JOIN usuarios u ON u.id = c.assinado_por_usuario_id
      WHERE c.farmacia_id = ?
      ORDER BY c.id DESC LIMIT 40`,
    fid
  ).map((c) => ({
    ...c,
    rotulo_pop: LIMITES_POP[c.tipo_pop]?.rotulo || c.tipo_pop,
    unidade: LIMITES_POP[c.tipo_pop]?.unidade || "",
    status_rotulo: c.dentro_conformidade ? "✅ CONFORME" : "⚠️ FORA DA FAIXA (AÇÃO CORRETIVA)",
  }));

  const equipe = all(
    `SELECT id, nome, email, cargo, crf_uf, meta_individual_centavos, vendas_mes_centavos, comissao_acum_centavos
       FROM usuarios
      WHERE farmacia_id = ? AND ativo = 1
      ORDER BY vendas_mes_centavos DESC, id ASC`,
    fid
  ).map((u) => {
    const progresso = u.meta_individual_centavos > 0 ? Math.min(150, Math.round((u.vendas_mes_centavos / u.meta_individual_centavos) * 100)) : 100;
    return {
      ...u,
      meta_individual: deCentavos(u.meta_individual_centavos),
      vendas_mes: deCentavos(u.vendas_mes_centavos),
      comissao_acumulada: deCentavos(u.comissao_acum_centavos),
      progresso_pct: progresso,
      rotulo_meta: progresso >= 100 ? "🏆 META BATIDA" : progresso >= 75 ? "🔥 RETA FINAL" : "📈 EM ANDAMENTO",
    };
  });

  const f = get("SELECT * FROM farmacias WHERE id = ?", fid);

  res.json({
    limites_pop: LIMITES_POP,
    checklists,
    equipe,
    farmacia: {
      ...f,
      taxa_entrega: deCentavos(f.taxa_entrega_centavos),
      meta_mensal_loja: deCentavos(f.meta_mensal_centavos),
      pedido_minimo: deCentavos(f.pedido_minimo_centavos),
    },
  });
}

const popSchema = z.object({
  tipo_pop: z.enum([
    "TEMPERATURA_GELADEIRA",
    "TEMPERATURA_AMBIENTE",
    "UMIDADE_AMBIENTE",
    "LIMPEZA_SALA_INJETAVEIS",
    "CONFERENCIA_ARMARIO_CONTROLADOS",
    "CONFERENCIA_SNGPC_CONTROLADOS", // alias retrocompatível convertido para CONFERENCIA_ARMARIO_CONTROLADOS
  ]),
  valor_medido: z.coerce.number().min(-30).max(100).nullable().optional(),
  observacao: z.string().trim().max(300).optional(),
});

export function registrarChecklist(req, res) {
  const d = popSchema.parse(req.body);
  const tipoNorm = d.tipo_pop === "CONFERENCIA_SNGPC_CONTROLADOS" ? "CONFERENCIA_ARMARIO_CONTROLADOS" : d.tipo_pop;
  const regra = LIMITES_POP[tipoNorm];
  let conforme = 1;

  if (regra.min !== null && regra.max !== null) {
    if (d.valor_medido === null || d.valor_medido === undefined || Number.isNaN(d.valor_medido)) {
      throw new HttpError(400, `Informe o valor medido em ${regra.unidade} para este POP.`);
    }
    conforme = d.valor_medido >= regra.min && d.valor_medido <= regra.max ? 1 : 0;
    if (!conforme && (!d.observacao || d.observacao.length < 5)) {
      throw new HttpError(
        422,
        `Medição fora da faixa ANVISA (${regra.min} a ${regra.max}${regra.unidade}). Registre obrigatoriamente a ação corretiva no campo de observação.`
      );
    }
  }

  if (tipoNorm === "CONFERENCIA_ARMARIO_CONTROLADOS" && !["DIRETOR", "FARMACEUTICO"].includes(req.usuario.cargo)) {
    throw new HttpError(403, "A conferência interna do armário de controlados (Portaria 344/98) deve ser registrada exclusivamente pelo(a) Farmacêutico(a) RT ou Diretor.");
  }

  const valFinal = regra.min !== null ? dinheiro(d.valor_medido) : null;
  const carimboSP = agoraSP();
  const hashIntegridade = hashSha256(
    `${req.usuario.farmacia_id}:${tipoNorm}:${valFinal}:${conforme}:${d.observacao || ""}:${req.usuario.id}:${carimboSP}`
  );

  const id = run(
    `INSERT INTO checklists_anvisa (farmacia_id, tipo_pop, valor_medido, dentro_conformidade, observacao, assinado_por_usuario_id, hash_integridade, carimbo_data_hora)
     VALUES (?,?,?,?,?,?,?,?)`,
    req.usuario.farmacia_id,
    tipoNorm,
    valFinal,
    conforme,
    d.observacao || null,
    req.usuario.id,
    hashIntegridade,
    carimboSP
  ).lastInsertRowid;

  auditar(req, "POP_ANVISA_REGISTRADO", `pop:${id}:${tipoNorm}`);
  res.status(201).json({
    id,
    hash_integridade: hashIntegridade,
    dentro_conformidade: !!conforme,
    status_rotulo: conforme ? "✅ CONFORME" : "⚠️ FORA DA FAIXA (AÇÃO CORRETIVA REGISTRADA)",
  });
}

const configSchema = z.object({
  modo_whatsapp: z.enum(["SEGURO_1_CLIQUE", "META_CLOUD_API"]).optional(),
  cashback_pct: z.coerce.number().min(0).max(30).optional(),
  taxa_entrega: z.coerce.number().min(0).max(100).optional(),
  taxa_marketplace_ref_pct: z.coerce.number().min(0).max(50).optional(),
  chave_pix: z.string().trim().max(120).optional(),
  google_maps_review_url: z.string().trim().url("URL de avaliação inválida.").max(250).optional().or(z.literal("")),
  meta_mensal_loja: z.coerce.number().min(0).max(10_000_000).optional(),
});

export function atualizarConfigFarmacia(req, res) {
  const d = configSchema.parse(req.body);
  const fid = req.usuario.farmacia_id;
  const atual = get("SELECT * FROM farmacias WHERE id = ?", fid);

  run(
    `UPDATE farmacias
        SET modo_whatsapp = ?,
            cashback_pct = ?,
            taxa_entrega_centavos = ?,
            taxa_marketplace_ref_pct = ?,
            chave_pix = ?,
            google_maps_review_url = ?,
            meta_mensal_centavos = ?
      WHERE id = ?`,
    d.modo_whatsapp ?? atual.modo_whatsapp,
    d.cashback_pct ?? atual.cashback_pct,
    d.taxa_entrega !== undefined ? paraCentavos(d.taxa_entrega) : atual.taxa_entrega_centavos,
    d.taxa_marketplace_ref_pct ?? atual.taxa_marketplace_ref_pct,
    d.chave_pix !== undefined ? d.chave_pix : atual.chave_pix,
    d.google_maps_review_url !== undefined ? d.google_maps_review_url || null : atual.google_maps_review_url,
    d.meta_mensal_loja !== undefined ? paraCentavos(d.meta_mensal_loja) : atual.meta_mensal_centavos,
    fid
  );

  auditar(req, "CONFIG_FARMACIA_ATUALIZADA", `farmacia:${fid}`);
  res.json({ ok: true });
}

const metaUsuarioSchema = z.object({
  meta_individual: z.coerce.number().min(0).max(5_000_000),
});

export function atualizarMetaUsuario(req, res) {
  const { meta_individual } = metaUsuarioSchema.parse(req.body);
  const fid = req.usuario.farmacia_id;
  const uid = Number(req.params.id);
  const u = get("SELECT id, nome FROM usuarios WHERE id = ? AND farmacia_id = ?", uid, fid);
  if (!u) throw new HttpError(404, "Colaborador não encontrado nesta farmácia.");

  const metaCentavos = paraCentavos(meta_individual);
  run("UPDATE usuarios SET meta_individual_centavos = ? WHERE id = ?", metaCentavos, uid);
  auditar(req, "META_COLABORADOR_ATUALIZADA", `usuario:${uid}:meta:${metaCentavos}`);
  res.json({ ok: true, id: uid, meta_individual: deCentavos(metaCentavos) });
}

const vendaBalcaoSchema = z.object({
  produto_id: z.coerce.number().int().positive(),
  quantidade: z.coerce.number().int().min(1).max(200).default(1),
  cliente_whatsapp: z.string().trim().optional(),
});

export function registrarVendaBalcaoRapida(req, res) {
  const d = vendaBalcaoSchema.parse(req.body);
  const fid = req.usuario.farmacia_id;
  const prod = get("SELECT * FROM produtos WHERE id = ? AND farmacia_id = ?", d.produto_id, fid);
  if (!prod) throw new HttpError(404, "Produto não encontrado.");
  if (prod.pendente_classificacao) {
    throw new HttpError(422, "Este produto aguarda classificação sanitária pelo(a) Farmacêutico(a) RT antes da venda.");
  }

  const resultado = tx(() => {
    const lotesUsados = consumirEstoqueFEFO(fid, prod.id, d.quantidade);
    const precoUnitC = prod.preco_promo_centavos ?? prod.preco_venda_centavos;
    const valorTotalC = precoUnitC * d.quantidade;

    // Soma comissão extra se o lote FEFO consumido tinha campanha ativa de comissão
    let comissaoExtraC = 0;
    for (const lu of lotesUsados) {
      const loteDb = get("SELECT comissao_extra_balconista_pct FROM lotes_estoque WHERE id = ?", lu.lote_id);
      if (loteDb?.comissao_extra_balconista_pct > 0) {
        comissaoExtraC += Math.round(precoUnitC * lu.quantidade * (loteDb.comissao_extra_balconista_pct / 100));
      }
    }

    run(
      "UPDATE usuarios SET vendas_mes_centavos = vendas_mes_centavos + ?, comissao_acum_centavos = comissao_acum_centavos + ? WHERE id = ?",
      valorTotalC,
      comissaoExtraC,
      req.usuario.id
    );

    const usuarioAtual = get("SELECT meta_individual_centavos, vendas_mes_centavos, comissao_acum_centavos FROM usuarios WHERE id = ?", req.usuario.id);
    return {
      produto: prod.nome_comercial,
      quantidade: d.quantidade,
      valor_venda: deCentavos(valorTotalC),
      comissao_ganha: deCentavos(comissaoExtraC),
      lotes_fefo: lotesUsados,
      minhas_vendas_mes: deCentavos(usuarioAtual.vendas_mes_centavos),
      minha_meta: deCentavos(usuarioAtual.meta_individual_centavos),
      minha_comissao_acumulada: deCentavos(usuarioAtual.comissao_acum_centavos),
    };
  });

  auditar(req, "VENDA_BALCAO_PDV_FEFO", `produto:${prod.id}:qtd:${d.quantidade}`);
  res.status(201).json(resultado);
}

export function listarAuditoria(req, res) {
  const page = Math.max(1, Number(req.query.page || 1));
  const limit = Math.min(100, Math.max(1, Number(req.query.limit || 60)));
  const offset = (page - 1) * limit;
  const logs = all(
    `SELECT l.id, l.acao, l.recurso_afetado, l.ip_origem, l.correlation_id, l.criado_em,
            u.nome AS usuario_nome, u.cargo AS usuario_cargo
       FROM logs_auditoria l
       LEFT JOIN usuarios u ON u.id = l.usuario_id
      WHERE l.farmacia_id = ?
      ORDER BY l.id DESC LIMIT ? OFFSET ?`,
    req.usuario.farmacia_id,
    limit,
    offset
  );
  res.json({ page, limit, logs });
}

// =========================================================================
// P0-6: DIREITOS DO TITULAR LGPD (Art. 18 — Acesso, Portabilidade e Anonimização)
// =========================================================================
export function exportarDadosTitular(req, res) {
  const fid = req.usuario.farmacia_id;
  const tel = normalizarWhatsapp(req.params.whatsapp);
  const cli = get("SELECT * FROM clientes WHERE farmacia_id = ? AND telefone_whatsapp = ?", fid, tel);
  if (!cli) throw new HttpError(404, "Titular não encontrado nesta farmácia.");

  const tratamentos = all("SELECT id, produto_id, duracao_dias, data_ultima_compra, status_recompra, criado_em FROM tratamentos_continuos WHERE cliente_id = ?", cli.id);
  const pedidos = all("SELECT codigo_pedido, total_centavos, status_pedido, origem, criado_em FROM pedidos_vitrine WHERE cliente_id = ?", cli.id);
  const cashback = all("SELECT tipo, valor_centavos, validade_em, criado_em FROM movimentacoes_cashback WHERE cliente_id = ?", cli.id);

  auditar(req, "LGPD_PORTABILIDADE_EXPORTADA", `cliente:${cli.id}`);
  res.json({
    base_legal: "LGPD Art. 18 — Acesso e Portabilidade de Dados Pessoais",
    exportado_em: new Date().toISOString(),
    titular: {
      id: cli.id,
      nome: cli.nome,
      telefone_whatsapp: cli.telefone_whatsapp,
      endereco_entrega: cli.endereco_entrega,
      saldo_cashback: deCentavos(cli.saldo_cashback_centavos),
      consentimento_saude_em: cli.lgpd_consentimento_saude_em,
      optin_comunicacao_em: cli.lgpd_optin_comunicacao_em,
    },
    tratamentos_continuos: tratamentos,
    pedidos_realizados: pedidos,
    extrato_cashback: cashback,
  });
}

export function anonimizarTitular(req, res) {
  const { whatsapp } = z.object({ whatsapp: z.string().min(10).max(20) }).parse(req.body);
  const fid = req.usuario.farmacia_id;
  const tel = normalizarWhatsapp(whatsapp);
  const cli = get("SELECT * FROM clientes WHERE farmacia_id = ? AND telefone_whatsapp = ?", fid, tel);
  if (!cli) throw new HttpError(404, "Titular não encontrado nesta farmácia.");

  tx(() => {
    run(
      `UPDATE clientes
          SET nome = 'TITULAR ANONIMIZADO (LGPD)',
              telefone_whatsapp = ?,
              endereco_entrega = NULL,
              cep = NULL,
              lgpd_consentimento_saude_em = NULL,
              lgpd_optin_comunicacao_em = NULL,
              anonimizado_em = ?
        WHERE id = ?`,
      `ANON-${cli.id}-${Date.now()}`,
      agoraSP(),
      cli.id
    );
    run(
      "UPDATE tratamentos_continuos SET status_recompra = 'CANCELADO', token_recompra_hash = NULL WHERE cliente_id = ?",
      cli.id
    );
  });

  auditar(req, "LGPD_TITULAR_ANONIMIZADO", `cliente:${cli.id}`);
  res.json({
    ok: true,
    mensagem: "Dados pessoais do titular anonimizados e todos os lembretes cancelados em conformidade com o Art. 18 da LGPD.",
  });
}

// =========================================================================
// P2-9: CONECTOR DE SINCRONIZAÇÃO ERP (Trier / Linx / FarmaSoft -> FarmaLink)
// =========================================================================
const erpSyncSchema = z.object({
  sistema_erp: z.string().trim().max(40).default("ERP-PDV"),
  itens: z
    .array(
      z.object({
        ean_gtin: z.string().regex(/^\d{8,14}$/),
        nome_comercial: z.string().trim().min(3).max(120),
        preco_custo: z.coerce.number().min(0),
        preco_venda: z.coerce.number().positive(),
        numero_lote: z.string().trim().min(2).max(40),
        quantidade_atual: z.coerce.number().int().min(0),
        data_validade: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
    )
    .min(1)
    .max(500),
});

export function sincronizarEstoqueErp(req, res) {
  const d = erpSyncSchema.parse(req.body);
  const fid = req.usuario.farmacia_id;

  const sincronizados = tx(() => {
    let count = 0;
    for (const item of d.itens) {
      let prod = get("SELECT id FROM produtos WHERE farmacia_id = ? AND ean_gtin = ?", fid, item.ean_gtin);
      const custoC = paraCentavos(item.preco_custo);
      const vendaC = paraCentavos(item.preco_venda);
      if (!prod) {
        const prodId = run(
          `INSERT INTO produtos (farmacia_id, ean_gtin, nome_comercial, categoria, preco_custo_centavos, preco_venda_centavos, exige_receita, pendente_classificacao, exibir_na_vitrine, estoque_total, criado_em)
           VALUES (?,?,?,'CONVENIENCIA',?,?,1,1,0,0,?)`,
          fid,
          item.ean_gtin,
          item.nome_comercial,
          custoC,
          vendaC,
          agoraSP()
        ).lastInsertRowid;
        prod = { id: prodId };
      } else {
        run("UPDATE produtos SET preco_custo_centavos = ?, preco_venda_centavos = ? WHERE id = ?", custoC, vendaC, prod.id);
      }

      const loteExist = get(
        "SELECT id FROM lotes_estoque WHERE farmacia_id = ? AND produto_id = ? AND numero_lote = ?",
        fid,
        prod.id,
        item.numero_lote
      );
      if (loteExist) {
        run(
          "UPDATE lotes_estoque SET quantidade_atual = ?, custo_unitario_centavos = ?, data_validade = ? WHERE id = ?",
          item.quantidade_atual,
          custoC,
          item.data_validade,
          loteExist.id
        );
      } else {
        run(
          `INSERT INTO lotes_estoque (farmacia_id, produto_id, numero_lote, nota_fiscal_ref, quantidade_atual, custo_unitario_centavos, data_validade)
           VALUES (?,?,?,?,?,?,?)`,
          fid,
          prod.id,
          item.numero_lote,
          `Sync ${d.sistema_erp}`,
          item.quantidade_atual,
          custoC,
          item.data_validade
        );
      }
      sincronizarEstoqueProduto(prod.id);
      count++;
    }
    return count;
  });

  auditar(req, "ERP_ESTOQUE_SINCRONIZADO", `${d.sistema_erp}:itens:${sincronizados}`);
  res.json({ ok: true, sistema_erp: d.sistema_erp, itens_sincronizados: sincronizados });
}
