// Dashboard Executivo do Dono — Métricas Contábeis Separadas (Sem dupla contagem e com fuso America/Sao_Paulo)
import { all, get } from "../database/conexao.js";
import { recursosDoPlano } from "../middlewares/seguranca.js";
import { deCentavos, hojeSP, somarDias } from "../utils/comum.js";

export function resumoExecutivo(req, res) {
  const fid = req.usuario.farmacia_id;
  const hoje = hojeSP();
  const mesAtual = hoje.slice(0, 7); // YYYY-MM em America/Sao_Paulo
  const farmacia = get("SELECT * FROM farmacias WHERE id = ?", fid);

  // 1. Módulo A — Faturamento Bruto de Recompras Confirmadas (Atribuição: confirmadas pelo link de disparo)
  const usoContinuo = get(
    `SELECT COALESCE(SUM(CASE WHEN status_recompra IN ('RECOMPRA_CONFIRMADA','AGUARDANDO_VALIDACAO_RT') THEN valor_recuperado_centavos ELSE 0 END), 0) AS receita_centavos,
            COUNT(CASE WHEN status_recompra IN ('RECOMPRA_CONFIRMADA','AGUARDANDO_VALIDACAO_RT') THEN 1 END) AS recompras_confirmadas,
            COUNT(CASE WHEN status_recompra IN ('MONITORANDO','ALERTA_5_DIAS') AND data_disparo_whatsapp <= ? THEN 1 END) AS alertas_hoje,
            COUNT(CASE WHEN status_recompra != 'CANCELADO' THEN 1 END) AS pacientes_monitorados
       FROM tratamentos_continuos WHERE farmacia_id = ?`,
    hoje,
    fid
  );

  // 2. Módulo B — Vitrine Digital & Comissão de Marketplace Terceiro Evitada (Estimada)
  // faturamento_mes_centavos filtra apenas os pedidos do mês corrente (substr(criado_em,1,7) = mesAtual)
  // e já engloba tanto VITRINE_DIGITAL quanto RECOMPRA_USO_CONTINUO (evitando dupla contagem no faturamento mensal)
  const pedidos = get(
    `SELECT COALESCE(SUM(CASE WHEN status_pedido NOT IN ('CANCELADO','DEVOLVIDO') THEN total_centavos ELSE 0 END), 0) AS faturamento_total_centavos,
            COALESCE(SUM(CASE WHEN status_pedido NOT IN ('CANCELADO','DEVOLVIDO') AND substr(criado_em, 1, 7) = ? THEN total_centavos ELSE 0 END), 0) AS faturamento_mes_centavos,
            COALESCE(SUM(CASE WHEN status_pedido NOT IN ('CANCELADO','DEVOLVIDO') AND substr(criado_em, 1, 7) = ? THEN economia_mkt_centavos ELSE 0 END), 0) AS economia_centavos,
            COALESCE(SUM(CASE WHEN status_pedido = 'CONCLUIDO' THEN cashback_gerado_centavos ELSE 0 END), 0) AS cashback_centavos,
            COUNT(CASE WHEN status_pedido IN ('AGUARDANDO_VALIDACAO_RT','NOVO','SEPARANDO','SAIU_ENTREGA') THEN 1 END) AS pedidos_abertos,
            COUNT(CASE WHEN status_pedido = 'AGUARDANDO_VALIDACAO_RT' THEN 1 END) AS aguardando_rt,
            COUNT(CASE WHEN status_pedido NOT IN ('CANCELADO','DEVOLVIDO') THEN 1 END) AS total_pedidos
       FROM pedidos_vitrine WHERE farmacia_id = ?`,
    mesAtual,
    mesAtual,
    fid
  );

  // 3. Módulo C — Triagem de Receitas com IA (Separando Lucro Bruto Realizado vs. Ganho Extra de Margem sobre Referência)
  const triagem = get(
    `SELECT COUNT(*) AS total_receitas,
            COUNT(CASE WHEN status_triagem IN ('AGUARDANDO_APROVACAO','REVISAO_MANUAL') THEN 1 END) AS pendentes,
            COALESCE(SUM(CASE WHEN status_triagem = 'CONVERTIDO_EM_VENDA' THEN margem_ganha_centavos ELSE 0 END), 0) AS margem_convertida_centavos,
            COALESCE(SUM(CASE WHEN status_triagem = 'CONVERTIDO_EM_VENDA' THEN ganho_extra_margem_centavos ELSE 0 END), 0) AS ganho_extra_convertido_centavos,
            COALESCE(SUM(CASE WHEN status_triagem IN ('AGUARDANDO_APROVACAO','REVISAO_MANUAL','ENVIADO_WHATSAPP') THEN margem_ganha_centavos ELSE 0 END), 0) AS margem_em_aberto_centavos
       FROM orcamentos_receita WHERE farmacia_id = ?`,
    fid
  );

  // 4. Módulo D — Radar de Validade (Custo de Estoque em Risco <= 90d vs. Custo Recuperado em Queima)
  const limite90d = somarDias(hoje, 90);
  const limite30d = somarDias(hoje, 30);
  const validade = get(
    `SELECT COALESCE(SUM(CASE WHEN data_validade <= ? AND data_validade >= ? AND quantidade_atual > 0 THEN quantidade_atual * custo_unitario_centavos ELSE 0 END), 0) AS risco_90d_centavos,
            COUNT(CASE WHEN data_validade <= ? AND data_validade >= ? AND quantidade_atual > 0 THEN 1 END) AS lotes_criticos_30d,
            COUNT(CASE WHEN data_validade <= ? AND data_validade >= ? AND quantidade_atual > 0 THEN 1 END) AS lotes_risco_90d,
            COALESCE(SUM(unidades_salvas * custo_unitario_centavos), 0) AS salvo_centavos
       FROM lotes_estoque WHERE farmacia_id = ?`,
    limite90d,
    hoje,
    limite30d,
    hoje,
    limite90d,
    hoje,
    fid
  );

  // 5. Passivo Contábil de Cashback Não Expirado
  const passivoCb = get(
    `SELECT COALESCE(SUM(
              CASE
                WHEN tipo = 'CREDITO' AND (validade_em IS NULL OR validade_em >= ?) THEN valor_centavos
                WHEN tipo IN ('RESGATE', 'ESTORNO') THEN -valor_centavos
                ELSE 0
              END
            ), 0) AS passivo_centavos
       FROM movimentacoes_cashback WHERE farmacia_id = ?`,
    hoje,
    fid
  );

  // 6. POPs assinados hoje no fuso America/Sao_Paulo (substr(carimbo_data_hora, 1, 10) = hojeSP())
  const popsHoje = get(
    `SELECT COUNT(*) AS assinados_hoje
       FROM checklists_anvisa
      WHERE farmacia_id = ? AND substr(carimbo_data_hora, 1, 10) = ?`,
    fid,
    hoje
  );

  const vendasEquipe = get(
    `SELECT COALESCE(SUM(vendas_mes_centavos), 0) AS vendas_balcao_centavos FROM usuarios WHERE farmacia_id = ? AND ativo = 1`,
    fid
  );

  const meuProgresso = get(
    `SELECT id, nome, cargo, crf_uf, meta_individual_centavos, vendas_mes_centavos, comissao_acum_centavos
       FROM usuarios WHERE id = ?`,
    req.usuario.id
  );
  const listaEquipe = all(
    `SELECT id, nome, cargo, crf_uf, meta_individual_centavos, vendas_mes_centavos, comissao_acum_centavos
       FROM usuarios WHERE farmacia_id = ? AND ativo = 1 ORDER BY vendas_mes_centavos DESC, id ASC`,
    fid
  ).map((u) => ({
    ...u,
    meta_individual: deCentavos(u.meta_individual_centavos),
    vendas_mes: deCentavos(u.vendas_mes_centavos),
    comissao_acumulada: deCentavos(u.comissao_acum_centavos),
    progresso_pct: u.meta_individual_centavos > 0 ? Math.min(150, Math.round((u.vendas_mes_centavos / u.meta_individual_centavos) * 100)) : 100,
  }));

  // Faturamento acumulado do mês = Vendas de Balcão do mês + Pedidos Digitais do mês (que já incluem as recompras confirmadas)
  const faturamentoAcumuladoCentavos = vendasEquipe.vendas_balcao_centavos + pedidos.faturamento_mes_centavos;
  const metaLojaCentavos = farmacia.meta_mensal_centavos || 18000000;

  const acoesPrioritarias = [];
  if (usoContinuo.alertas_hoje > 0) {
    acoesPrioritarias.push({
      modulo: "uso_continuo",
      prioridade: "ALTA",
      rotulo_prioridade: "USO CONTÍNUO (MÓD. A)",
      titulo: `${usoContinuo.alertas_hoje} paciente(s) atingiram a janela de alerta de reposição`,
      detalhe: "Envie o lembrete neutro (sem expor dado de saúde na tela bloqueada) com link autenticado de reposição.",
    });
  }
  if (pedidos.aguardando_rt > 0) {
    acoesPrioritarias.push({
      modulo: "vitrine",
      prioridade: "ALTA",
      rotulo_prioridade: "VALIDAÇÃO RT (RDC 44/2009)",
      titulo: `${pedidos.aguardando_rt} reposição(ões) de medicamento tarjado aguardando conferência do(a) Farmacêutico(a) RT`,
      detalhe: "Confira a validade da prescrição antes de autorizar a separação (Lei 13.021/2014).",
    });
  }
  if (triagem.pendentes > 0) {
    acoesPrioritarias.push({
      modulo: "triagem_ia",
      prioridade: "ALTA",
      rotulo_prioridade: "TRIAGEM RECEITAS IA (MÓD. C)",
      titulo: `${triagem.pendentes} receita(s) médica(s) aguardando conferência do(a) Farmacêutico(a) RT`,
      detalhe: "Verifique a opção genérica de menor preço para o paciente (mesma concentração e forma farmacêutica).",
    });
  }
  if (pedidos.pedidos_abertos > 0) {
    acoesPrioritarias.push({
      modulo: "vitrine",
      prioridade: "ALTA",
      rotulo_prioridade: "RESERVAS & RETIRADA (MÓD. B)",
      titulo: `${pedidos.pedidos_abertos} reserva(s) da Vitrine aguardando separação ou retirada no balcão`,
      detalhe: "Ao confirmar a retirada na loja, o cliente recebe o cashback regulamentar e o link neutro para avaliar a experiência.",
    });
  }
  if (validade.lotes_criticos_30d > 0) {
    acoesPrioritarias.push({
      modulo: "radar_validade",
      prioridade: "MEDIA",
      rotulo_prioridade: "RADAR VALIDADE FEFO (MÓD. D)",
      titulo: `${validade.lotes_criticos_30d} lote(s) entram em vencimento crítico em até 30 dias`,
      detalhe: "O motor FEFO já prioriza esses lotes na saída; ative oferta na vitrine (para isentos) ou bônus de equipe.",
    });
  }

  const ultimosDisparos = all(
    `SELECT id, tipo_disparo, modo_envio, destinatario_whatsapp, status_fila, link_wa_me, criado_em
       FROM fila_whatsapp WHERE farmacia_id = ? ORDER BY id DESC LIMIT 8`,
    fid
  );

  res.json({
    hoje,
    mes_referencia: mesAtual,
    farmacia: {
      nome_fantasia: farmacia.nome_fantasia,
      slug: farmacia.slug,
      plano_ativo: farmacia.plano_ativo,
      modo_whatsapp: farmacia.modo_whatsapp,
      cashback_pct: farmacia.cashback_pct,
      taxa_marketplace_ref_pct: farmacia.taxa_marketplace_ref_pct,
      meta_mensal_loja: deCentavos(metaLojaCentavos),
    },
    recursos: recursosDoPlano(farmacia.plano_ativo),
    kpis: {
      // Métricas contábeis estritamente separadas e sem dupla contagem
      receita_uso_continuo: deCentavos(usoContinuo.receita_centavos),
      recompras_confirmadas: usoContinuo.recompras_confirmadas,
      alertas_uso_continuo_hoje: usoContinuo.alertas_hoje,
      pacientes_monitorados: usoContinuo.pacientes_monitorados,
      faturamento_vitrine: deCentavos(pedidos.faturamento_mes_centavos),
      faturamento_balcao_mes: deCentavos(vendasEquipe.vendas_balcao_centavos),
      economia_marketplace_estimada: deCentavos(pedidos.economia_centavos),
      taxa_marketplace_ref_pct: farmacia.taxa_marketplace_ref_pct,
      cashback_gerado: deCentavos(pedidos.cashback_centavos),
      passivo_cashback_aberto: deCentavos(Math.max(0, passivoCb.passivo_centavos)),
      pedidos_abertos: pedidos.pedidos_abertos,
      pedidos_aguardando_rt: pedidos.aguardando_rt,
      total_pedidos: pedidos.total_pedidos,
      receitas_pendentes: triagem.pendentes,
      lucro_bruto_receitas_convertidas: deCentavos(triagem.margem_convertida_centavos),
      ganho_extra_margem_convertida: deCentavos(triagem.ganho_extra_convertido_centavos),
      margem_otimizada_ia: deCentavos(triagem.margem_em_aberto_centavos),
      capital_em_risco_90d: deCentavos(validade.risco_90d_centavos),
      lotes_criticos_30d: validade.lotes_criticos_30d,
      lotes_risco_90d: validade.lotes_risco_90d,
      capital_salvo_validade: deCentavos(validade.salvo_centavos),
      pops_assinados_hoje: popsHoje.assinados_hoje,
      faturamento_acumulado_mes: deCentavos(faturamentoAcumuladoCentavos),
      progresso_meta_loja_pct:
        metaLojaCentavos > 0 ? Math.min(150, Math.round((faturamentoAcumuladoCentavos / metaLojaCentavos) * 100)) : 100,
    },
    acoes_prioritarias: acoesPrioritarias,
    meu_desempenho: meuProgresso
      ? {
          nome: meuProgresso.nome,
          cargo: meuProgresso.cargo,
          meta_individual: deCentavos(meuProgresso.meta_individual_centavos),
          vendas_mes: deCentavos(meuProgresso.vendas_mes_centavos),
          comissao_acumulada: deCentavos(meuProgresso.comissao_acum_centavos),
          progresso_pct:
            meuProgresso.meta_individual_centavos > 0
              ? Math.min(150, Math.round((meuProgresso.vendas_mes_centavos / meuProgresso.meta_individual_centavos) * 100))
              : 100,
        }
      : null,
    equipe: listaEquipe,
    ultimos_disparos: ultimosDisparos,
  });
}
