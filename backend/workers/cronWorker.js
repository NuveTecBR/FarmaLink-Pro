// Worker Assíncrono Idempotente (Fuso America/Sao_Paulo):
// - Promove alertas de uso contínuo (MONITORANDO -> ALERTA_5_DIAS)
// - Expira imagens de receita após 7 dias (LGPD)
// - Zera contadores mensais de balcão (vendas_mes_centavos) na virada de mês (America/Sao_Paulo)
// - Recalcula e expira saldos de cashback vencidos (validade_em < hojeSP)
// - Processa e destrava a fila de WhatsApp
import fs from "node:fs";
import { all, marcarExecucao, run } from "../database/conexao.js";
import { calcularSaldoCashbackValido } from "../services/pedidoCashbackService.js";
import { processarFila } from "../services/whatsappDispatcherService.js";
import { agoraSP, hojeSP, log } from "../utils/comum.js";

export async function executarCicloWorker() {
  const hoje = hojeSP();
  const agora = agoraSP();
  const mesAtual = hoje.slice(0, 7); // YYYY-MM
  let alertasPromovidos = 0;
  let receitasExpiradas = 0;

  // 1) Virada de mês (America/Sao_Paulo): zera vendas_mes_centavos dos operadores quando muda o mês de referência
  const farmacias = all("SELECT id, mes_referencia_vendas FROM farmacias");
  for (const f of farmacias) {
    if (!f.mes_referencia_vendas) {
      run("UPDATE farmacias SET mes_referencia_vendas = ? WHERE id = ?", mesAtual, f.id);
    } else if (f.mes_referencia_vendas !== mesAtual) {
      run("UPDATE usuarios SET vendas_mes_centavos = 0 WHERE farmacia_id = ?", f.id);
      run("UPDATE farmacias SET mes_referencia_vendas = ? WHERE id = ?", mesAtual, f.id);
    }
  }

  // 2) Promove tratamentos contínuos que entraram na janela de disparo
  const candidatos = all(
    `SELECT id FROM tratamentos_continuos
      WHERE status_recompra = 'MONITORANDO' AND data_disparo_whatsapp <= ?`,
    hoje
  );

  for (const c of candidatos) {
    const chave = `uso_continuo_alerta:${c.id}:${hoje}`;
    if (marcarExecucao(chave)) {
      const r = run(
        "UPDATE tratamentos_continuos SET status_recompra = 'ALERTA_5_DIAS' WHERE id = ? AND status_recompra = 'MONITORANDO'",
        c.id
      );
      alertasPromovidos += r.changes;
    }
  }

  // 3) Expira imagens de receita após 7 dias ou após conclusão/descarte
  const vencidas = all(
    `SELECT id, imagem_receita_path FROM orcamentos_receita
      WHERE imagem_receita_path IS NOT NULL
        AND (imagem_expira_em <= ? OR status_triagem IN ('CONVERTIDO_EM_VENDA','DESCARTADO'))`,
    agora
  );

  for (const o of vencidas) {
    try {
      if (o.imagem_receita_path && fs.existsSync(o.imagem_receita_path)) {
        fs.unlinkSync(o.imagem_receita_path);
      }
      run("UPDATE orcamentos_receita SET imagem_receita_path = NULL WHERE id = ?", o.id);
      receitasExpiradas++;
    } catch (e) {
      log("error", "Falha ao expirar imagem de receita", { orcamentoId: o.id, erro: e.message });
    }
  }

  // 4) Sincroniza saldos de cashback para expirar créditos cujo validade_em < hoje
  const clientesComSaldo = all("SELECT id, farmacia_id FROM clientes WHERE saldo_cashback_centavos > 0");
  for (const cli of clientesComSaldo) {
    calcularSaldoCashbackValido(cli.id, cli.farmacia_id);
  }

  // 5) Processa fila da Meta Cloud API e destrava itens presos em PROCESSANDO
  const filaEnviados = await processarFila(25);

  return {
    hoje,
    mes_referencia: mesAtual,
    alertas_promovidos: alertasPromovidos,
    receitas_expiradas: receitasExpiradas,
    whatsapp_api_enviados: filaEnviados,
  };
}
