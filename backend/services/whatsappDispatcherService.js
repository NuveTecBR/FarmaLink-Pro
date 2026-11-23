// Disparo de WhatsApp Dual-Mode + Processamento de Opt-Out ("SAIR"):
// 1) SEGURO_1_CLIQUE (padrão): gera link wa.me assistido pelo operador.
// 2) META_CLOUD_API (Plano Pro): usa payload type: "template" homologado pela Meta para mensagens iniciadas pela loja (fora da janela de 24h),
//    credenciais por farmácia (com fallback env), destravamento de itens presos em PROCESSANDO e retry exponencial + DLQ.
import { env } from "../config/env.js";
import { all, get, run } from "../database/conexao.js";
import { agoraSP, linkWaMe, log, normalizarWhatsapp, somarMinutosSP } from "../utils/comum.js";

const BACKOFF_MIN = [1, 3, 10, 30, 120];
const MAX_TENTATIVAS = 5;

export function modoEfetivo(farmacia) {
  const token = farmacia.meta_wa_token || env.META_WA_TOKEN;
  const phoneId = farmacia.meta_wa_phone_id || env.META_WA_PHONE_ID;
  if (farmacia.modo_whatsapp === "META_CLOUD_API" && farmacia.plano_ativo === "PRO_IA" && token && phoneId) {
    return "META_CLOUD_API";
  }
  return "SEGURO_1_CLIQUE";
}

export function enfileirar({ farmacia, chave, tipo, telefone, texto }) {
  const existente = get("SELECT * FROM fila_whatsapp WHERE chave_idempotencia = ?", chave);
  if (existente) return { ...existente, duplicado: true };

  const agora = agoraSP();
  const modo = modoEfetivo(farmacia);
  const link = linkWaMe(telefone, texto);
  const r = run(
    `INSERT INTO fila_whatsapp (farmacia_id, chave_idempotencia, modo_envio, tipo_disparo, destinatario_whatsapp, mensagem_texto, link_wa_me, status_fila, proxima_tentativa_em, atualizado_em, criado_em)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    farmacia.id,
    chave,
    modo,
    tipo,
    normalizarWhatsapp(telefone),
    texto,
    link,
    modo === "SEGURO_1_CLIQUE" ? "AGUARDANDO_CLIQUE" : "PENDENTE",
    agora,
    agora,
    agora
  );
  return get("SELECT * FROM fila_whatsapp WHERE id = ?", r.lastInsertRowid);
}

/**
 * Monta payload compatível com WhatsApp Cloud API Oficial da Meta:
 * Mensagens iniciadas pela empresa (business-initiated, fora da janela de 24h) DEVEM usar type: "template".
 */
export function montarPayloadMetaTemplate(item, farmacia) {
  const templateName = farmacia?.meta_wa_template_name || "lembrete_reposicao_farmalink";
  return {
    messaging_product: "whatsapp",
    to: item.destinatario_whatsapp,
    type: "template",
    template: {
      name: templateName,
      language: { code: "pt_BR" },
      components: [
        {
          type: "body",
          parameters: [{ type: "text", text: item.mensagem_texto.slice(0, 900) }],
        },
      ],
    },
  };
}

async function enviarMeta(item, farmacia) {
  const token = farmacia?.meta_wa_token || env.META_WA_TOKEN;
  const phoneId = farmacia?.meta_wa_phone_id || env.META_WA_PHONE_ID;
  const payload = montarPayloadMetaTemplate(item, farmacia);

  const r = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) {
    const corpo = await r.text();
    const err = new Error(`Meta HTTP ${r.status}: ${corpo.slice(0, 200)}`);
    err.permanente = r.status >= 400 && r.status < 500 && r.status !== 429;
    throw err;
  }
}

export async function processarFila(limite = 20) {
  const agora = agoraSP();
  const limiteStuck = somarMinutosSP(-5);

  // Destrava itens que ficaram presos em PROCESSANDO por mais de 5 minutos (ex: queda do processo no meio do envio)
  run(
    `UPDATE fila_whatsapp
        SET status_fila = 'FALHA_RETRY',
            ultimo_erro = COALESCE(ultimo_erro, 'Timeout de processamento retomado pelo worker'),
            proxima_tentativa_em = ?,
            atualizado_em = ?
      WHERE status_fila = 'PROCESSANDO' AND atualizado_em <= ?`,
    agora,
    agora,
    limiteStuck
  );

  const itens = all(
    `SELECT * FROM fila_whatsapp WHERE modo_envio = 'META_CLOUD_API' AND status_fila IN ('PENDENTE','FALHA_RETRY')
       AND (proxima_tentativa_em IS NULL OR proxima_tentativa_em <= ?) ORDER BY id LIMIT ?`,
    agora,
    limite
  );
  let enviados = 0;
  for (const item of itens) {
    const lock = run(
      `UPDATE fila_whatsapp SET status_fila='PROCESSANDO', atualizado_em=? WHERE id=? AND status_fila IN ('PENDENTE','FALHA_RETRY')`,
      agoraSP(),
      item.id
    );
    if (lock.changes !== 1) continue;
    const farmacia = get("SELECT * FROM farmacias WHERE id = ?", item.farmacia_id);
    try {
      await enviarMeta(item, farmacia);
      run(
        `UPDATE fila_whatsapp SET status_fila='ENVIADO', tentativas=tentativas+1, ultimo_erro=NULL, atualizado_em=? WHERE id=?`,
        agoraSP(),
        item.id
      );
      enviados++;
    } catch (e) {
      const tent = item.tentativas + 1;
      const dlq = e.permanente || tent >= MAX_TENTATIVAS;
      const proxMin = BACKOFF_MIN[Math.min(tent - 1, BACKOFF_MIN.length - 1)];
      run(
        `UPDATE fila_whatsapp SET status_fila=?, tentativas=?, ultimo_erro=?, proxima_tentativa_em=?, atualizado_em=? WHERE id=?`,
        dlq ? "DLQ_ERRO_PERMANENTE" : "FALHA_RETRY",
        tent,
        e.message.slice(0, 300),
        somarMinutosSP(proxMin),
        agoraSP(),
        item.id
      );
      log("error", "Falha no envio WhatsApp", { filaId: item.id, tentativas: tent, dlq });
    }
  }
  return enviados;
}

/**
 * Webhook de entrada para processar respostas "SAIR" / "PARAR" (Opt-Out automático LGPD).
 */
export function processarInboundOptOut(telefone, textoMensagem) {
  const tel = normalizarWhatsapp(telefone);
  const cmd = String(textoMensagem || "").trim().toUpperCase();
  if (!["SAIR", "PARAR", "CANCELAR", "STOP"].includes(cmd)) {
    return { opt_out: false };
  }
  const clientes = all("SELECT id, farmacia_id FROM clientes WHERE telefone_whatsapp = ?", tel);
  let cancelados = 0;
  for (const c of clientes) {
    run("UPDATE clientes SET lgpd_optin_comunicacao_em = NULL WHERE id = ?", c.id);
    const r = run(
      "UPDATE tratamentos_continuos SET status_recompra = 'CANCELADO', token_recompra_hash = NULL WHERE cliente_id = ? AND status_recompra != 'CANCELADO'",
      c.id
    );
    cancelados += r.changes;
  }
  return { opt_out: true, tratamentos_cancelados: cancelados };
}
