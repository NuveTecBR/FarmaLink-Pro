// Módulo A — Motor de Receita Recorrente:
// - Controla validade da receita e retém recompra de tarjado para validação do(a) Farmacêutico(a) RT (AGUARDANDO_VALIDACAO_RT)
// - Mensagem de WhatsApp 100% neutra (não expõe nome do medicamento na tela de bloqueio) + opt-in separado
// - Token de 192 bits armazenado apenas como hash SHA-256, expiração em 7d, uso único e desafio dos 4 últimos dígitos do telefone
import crypto from "node:crypto";
import { z } from "zod";
import { env } from "../config/env.js";
import { all, get, run, tx } from "../database/conexao.js";
import { auditar } from "../middlewares/seguranca.js";
import { calcularSaldoCashbackValido, criarPedido } from "../services/pedidoCashbackService.js";
import { enfileirar } from "../services/whatsappDispatcherService.js";
import {
  agoraSP,
  ajustarDiaDisparo,
  deCentavos,
  diffDias,
  hashSha256,
  HttpError,
  hojeSP,
  normalizarWhatsapp,
  somarDias,
} from "../utils/comum.js";

const novoTokenClaro = () => crypto.randomBytes(24).toString("base64url");
const farmaciaDe = (id) => get("SELECT * FROM farmacias WHERE id = ?", id);

const cadastroSchema = z.object({
  cliente_nome: z.string().trim().min(3, "Informe o nome do paciente.").max(80),
  whatsapp: z
    .string()
    .trim()
    .refine((v) => /^\d{10,13}$/.test(v.replace(/\D/g, "")), "WhatsApp inválido (informe DDD + número)."),
  produto_id: z.coerce.number().int().positive(),
  duracao_dias: z.coerce.number().refine((v) => [30, 60, 90].includes(v), "A duração deve ser 30, 60 ou 90 dias."),
  dias_antecedencia: z.coerce.number().int().min(2).max(15).default(5),
  receita_valida_ate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  consentimento_cliente: z.literal(true, {
    message: "É necessário confirmar o consentimento LGPD de acompanhamento de saúde.",
    errorMap: () => ({ message: "É necessário confirmar o consentimento LGPD de acompanhamento de saúde." }),
  }),
  optin_comunicacao: z.boolean().default(true),
  data_compra: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export function cadastrar(req, res) {
  const d = cadastroSchema.parse(req.body);
  const fid = req.usuario.farmacia_id;
  const produto = get("SELECT id, nome_comercial, exige_receita FROM produtos WHERE id = ? AND farmacia_id = ?", d.produto_id, fid);
  if (!produto) throw new HttpError(404, "Medicamento não encontrado nesta farmácia.");
  const tel = normalizarWhatsapp(d.whatsapp);
  const compra = d.data_compra || hojeSP();
  const agora = agoraSP();
  const dataDisparo = ajustarDiaDisparo(somarDias(compra, d.duracao_dias - d.dias_antecedencia));
  const validadeReceita = d.receita_valida_ate || somarDias(compra, produto.exige_receita ? 180 : 365);
  const tokenClaro = novoTokenClaro();
  const tokenHash = hashSha256(tokenClaro);

  const id = tx(() => {
    let cli = get("SELECT id FROM clientes WHERE farmacia_id = ? AND telefone_whatsapp = ?", fid, tel);
    if (!cli) {
      cli = {
        id: run("INSERT INTO clientes (farmacia_id, nome, telefone_whatsapp, criado_em) VALUES (?,?,?,?)", fid, d.cliente_nome, tel, agora)
          .lastInsertRowid,
      };
    }
    // Registra o canal real do consentimento (PRESENCIAL_BALCAO + operador autenticado), sem atribuir o IP do balconista ao paciente
    run(
      `UPDATE clientes
          SET lgpd_consentimento_saude_em = ?,
              lgpd_optin_comunicacao_em = CASE WHEN ? = 1 THEN ? ELSE lgpd_optin_comunicacao_em END,
              lgpd_consentimento_canal = ?
        WHERE id = ?`,
      agora,
      d.optin_comunicacao ? 1 : 0,
      agora,
      `PRESENCIAL_BALCAO:operador_${req.usuario.id}`,
      cli.id
    );
    const dup = get(
      `SELECT id FROM tratamentos_continuos
        WHERE farmacia_id=? AND cliente_id=? AND produto_id=?
          AND status_recompra IN ('MONITORANDO','ALERTA_5_DIAS','MENSAGEM_ENVIADA')`,
      fid,
      cli.id,
      produto.id
    );
    if (dup) throw new HttpError(409, "Este paciente já possui este medicamento em monitoramento ativo.");
    return run(
      `INSERT INTO tratamentos_continuos
        (farmacia_id, cliente_id, produto_id, duracao_dias, dias_antecedencia_alerta, data_ultima_compra, data_disparo_whatsapp, receita_valida_ate, token_recompra_hash, token_expira_em, cadastrado_por, criado_em)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      fid,
      cli.id,
      produto.id,
      d.duracao_dias,
      d.dias_antecedencia,
      compra,
      dataDisparo,
      validadeReceita,
      tokenHash,
      somarDias(dataDisparo, 10),
      req.usuario.id,
      agora
    ).lastInsertRowid;
  });

  auditar(req, "USO_CONTINUO_CADASTRO", `tratamento:${id}`);
  res.status(201).json({ id, data_disparo_whatsapp: dataDisparo, receita_valida_ate: validadeReceita });
}

export function listar(req, res) {
  const hoje = hojeSP();
  const page = Math.max(1, Number(req.query.page || 1));
  const limit = Math.min(200, Math.max(1, Number(req.query.limit || 100)));
  const offset = (page - 1) * limit;

  const rows = all(
    `SELECT t.id, t.duracao_dias, t.dias_antecedencia_alerta, t.data_ultima_compra, t.data_disparo_whatsapp,
            t.receita_valida_ate, t.status_recompra, t.valor_recuperado_centavos,
            c.nome AS cliente_nome, c.telefone_whatsapp, c.saldo_cashback_centavos,
            p.nome_comercial AS produto, p.preco_venda_centavos, p.laboratorio, p.exige_receita
       FROM tratamentos_continuos t
       JOIN clientes c ON c.id = t.cliente_id
       JOIN produtos p ON p.id = t.produto_id
      WHERE t.farmacia_id = ? AND t.status_recompra != 'CANCELADO'
      ORDER BY CASE WHEN t.status_recompra IN ('ALERTA_5_DIAS','MONITORANDO') THEN 0 ELSE 1 END,
               t.data_disparo_whatsapp ASC
      LIMIT ? OFFSET ?`,
    req.usuario.farmacia_id,
    limit,
    offset
  );

  const itens = rows.map((r) => ({
    ...r,
    preco_venda: deCentavos(r.preco_venda_centavos),
    valor_recuperado: deCentavos(r.valor_recuperado_centavos),
    saldo_cashback_reais: deCentavos(r.saldo_cashback_centavos),
    dias_para_disparo: diffDias(hoje, r.data_disparo_whatsapp),
    receita_vencida: r.receita_valida_ate ? r.receita_valida_ate < hoje : false,
  }));

  const pendentesHoje = itens.filter((i) => ["MONITORANDO", "ALERTA_5_DIAS"].includes(i.status_recompra) && i.dias_para_disparo <= 0);
  const totalRecuperadoC = itens
    .filter((i) => ["RECOMPRA_CONFIRMADA", "AGUARDANDO_VALIDACAO_RT"].includes(i.status_recompra))
    .reduce((s, i) => s + i.valor_recuperado_centavos, 0);

  res.json({
    hoje,
    page,
    limit,
    resumo: {
      disparar_hoje: pendentesHoje.length,
      receita_potencial_hoje: deCentavos(pendentesHoje.reduce((s, i) => s + i.preco_venda_centavos, 0)),
      aguardando_resposta: itens.filter((i) => i.status_recompra === "MENSAGEM_ENVIADA").length,
      monitorando: itens.filter((i) => ["MONITORANDO", "ALERTA_5_DIAS"].includes(i.status_recompra) && i.dias_para_disparo > 0).length,
      confirmadas: itens.filter((i) => ["RECOMPRA_CONFIRMADA", "AGUARDANDO_VALIDACAO_RT"].includes(i.status_recompra)).length,
      receita_recuperada_total: deCentavos(totalRecuperadoC),
    },
    itens,
  });
}

/**
 * Mensagem 100% NEUTRA — Nunca menciona o nome do medicamento ou patologia no WhatsApp
 * para proteger a privacidade do paciente na tela bloqueada do celular (LGPD Art. 11).
 */
function montarMensagemNeutra(farmacia, t, tokenClaro) {
  const primeiro = t.cliente_nome.split(" ")[0];
  const url = `${env.PUBLIC_BASE_URL}/recompra.html?t=${tokenClaro}`;
  return (
    `Olá, ${primeiro}! Tudo bem? Aqui é da *${farmacia.nome_fantasia}*.\n\n` +
    `O seu atendimento contínuo programado está próximo da data de reposição.\n\n` +
    `Para conferir os detalhes com privacidade (mediante os 4 últimos dígitos do seu telefone) e reservar sua caixa para retirada rápida na loja:\n👉 ${url}\n\n` +
    `_(Para interromper estes lembretes a qualquer momento, responda SAIR.)_`
  );
}

function disparar(farmacia, tratamentoId, req) {
  const t = get(
    `SELECT t.*, c.nome AS cliente_nome, c.telefone_whatsapp, c.lgpd_optin_comunicacao_em,
            p.nome_comercial AS produto, p.preco_venda_centavos
       FROM tratamentos_continuos t
       JOIN clientes c ON c.id = t.cliente_id
       JOIN produtos p ON p.id = t.produto_id
      WHERE t.id = ? AND t.farmacia_id = ?`,
    tratamentoId,
    farmacia.id
  );
  if (!t) throw new HttpError(404, "Tratamento não encontrado.");
  if (!["MONITORANDO", "ALERTA_5_DIAS", "MENSAGEM_ENVIADA"].includes(t.status_recompra)) {
    throw new HttpError(409, "Este ciclo já foi concluído ou cancelado.");
  }

  const hashDemoMaria = hashSha256("demo_token_maria_losartana_30d");
  const tokenClaro = env.DEMO_MODE && !env.isProd && t.token_recompra_hash === hashDemoMaria
    ? "demo_token_maria_losartana_30d"
    : novoTokenClaro();
  const novoHash = hashSha256(tokenClaro);

  const chaveCiclo = `uso_continuo:${t.id}:${t.data_disparo_whatsapp}`;
  const existenteFila = get("SELECT * FROM fila_whatsapp WHERE chave_idempotencia = ?", chaveCiclo);

  if (!existenteFila) {
    run(
      "UPDATE tratamentos_continuos SET token_recompra_hash = ?, token_expira_em = ? WHERE id = ?",
      novoHash,
      somarDias(hojeSP(), 7),
      t.id
    );
  }

  const texto = montarMensagemNeutra(farmacia, t, tokenClaro);
  const fila = enfileirar({
    farmacia,
    chave: chaveCiclo,
    tipo: "USO_CONTINUO",
    telefone: t.telefone_whatsapp,
    texto,
  });
  run("UPDATE tratamentos_continuos SET status_recompra = 'MENSAGEM_ENVIADA' WHERE id = ?", t.id);
  auditar(req, "USO_CONTINUO_DISPARO_NEUTRO", `tratamento:${t.id}`);

  return {
    tratamento_id: t.id,
    cliente: t.cliente_nome,
    telefone: t.telefone_whatsapp,
    ultimos4_demo: t.telefone_whatsapp.slice(-4),
    produto: t.produto,
    preco: deCentavos(t.preco_venda_centavos),
    url_recompra: `/recompra.html?t=${tokenClaro}`,
    mensagem: texto,
    modo: fila.modo_envio,
    link_wa_me: fila.link_wa_me,
    fila_id: fila.id,
    duplicado: !!fila.duplicado,
  };
}

export function dispararUm(req, res) {
  res.json(disparar(farmaciaDe(req.usuario.farmacia_id), Number(req.params.id), req));
}

export function dispararLote(req, res) {
  const farmacia = farmaciaDe(req.usuario.farmacia_id);
  const ids = all(
    `SELECT id FROM tratamentos_continuos
      WHERE farmacia_id = ? AND status_recompra IN ('MONITORANDO','ALERTA_5_DIAS') AND data_disparo_whatsapp <= ?
      ORDER BY data_disparo_whatsapp LIMIT 100`,
    farmacia.id,
    hojeSP()
  );
  res.json({ disparos: ids.map((r) => disparar(farmacia, r.id, req)) });
}

export function cancelar(req, res) {
  const r = run(
    "UPDATE tratamentos_continuos SET status_recompra = 'CANCELADO', token_recompra_hash = NULL WHERE id = ? AND farmacia_id = ?",
    Number(req.params.id),
    req.usuario.farmacia_id
  );
  if (!r.changes) throw new HttpError(404, "Tratamento não encontrado.");
  auditar(req, "USO_CONTINUO_OPT_OUT", `tratamento:${req.params.id}`);
  res.json({ ok: true });
}

export function confirmarCliqueWhatsapp(req, res) {
  run(
    "UPDATE fila_whatsapp SET status_fila='ENVIADO', atualizado_em=? WHERE id=? AND farmacia_id=? AND status_fila='AGUARDANDO_CLIQUE'",
    agoraSP(),
    Number(req.params.filaId),
    req.usuario.farmacia_id
  );
  res.json({ ok: true });
}

// ---------------- Página pública de recompra 1-clique (Token Hasheado + Desafio 4 Dígitos) ----------------
const TOKEN_RE = /^[A-Za-z0-9_-]{20,64}$/;

function tratamentoPorToken(tokenClaro) {
  if (!TOKEN_RE.test(tokenClaro || "")) throw new HttpError(404, "Link de recompra inválido.");
  if (tokenClaro === "demo_token_maria_losartana_30d" && (!env.DEMO_MODE || env.isProd)) {
    throw new HttpError(404, "Token de demonstração desativado.");
  }
  const h = hashSha256(tokenClaro);
  const t = get(
    `SELECT t.*, c.nome AS cliente_nome, c.endereco_entrega, c.cep, c.saldo_cashback_centavos, c.telefone_whatsapp,
            p.nome_comercial AS produto, p.laboratorio,
            COALESCE(p.preco_promo_centavos, p.preco_venda_centavos) AS preco_centavos,
            p.estoque_total, p.exige_receita
       FROM tratamentos_continuos t
       JOIN clientes c ON c.id = t.cliente_id
       JOIN produtos p ON p.id = t.produto_id
      WHERE t.token_recompra_hash = ?`,
    h
  );
  if (!t) throw new HttpError(404, "Link inválido, expirado ou já utilizado.");
  if (t.token_expira_em && t.token_expira_em < hojeSP()) {
    throw new HttpError(410, "Este link de reposição expirou. Solicite um novo link pelo WhatsApp da farmácia.");
  }
  return t;
}

export function recompraVer(req, res) {
  const t = tratamentoPorToken(req.params.token);
  const f = farmaciaDe(t.farmacia_id);
  const ativo = ["MONITORANDO", "ALERTA_5_DIAS", "MENSAGEM_ENVIADA"].includes(t.status_recompra);
  const ultimos4Informados = String(req.query.ultimos4 || "").replace(/\D/g, "");
  const ultimos4Reais = t.telefone_whatsapp.slice(-4);
  const verificado = ultimos4Informados === ultimos4Reais;

  const saldoValidoCentavos = verificado && !t.exige_receita ? calcularSaldoCashbackValido(t.cliente_id, t.farmacia_id) : 0;

  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Referrer-Policy", "no-referrer");

  res.json({
    ativo,
    verificado,
    requer_verificacao_telefone: !verificado,
    dica_demo_ultimos4: env.DEMO_MODE && !env.isProd ? ultimos4Reais : null,
    status: t.status_recompra,
    cliente_primeiro_nome: t.cliente_nome.split(" ")[0],
    produto: verificado ? t.produto : "Item de Tratamento Contínuo (Confirme os 4 últimos dígitos do seu WhatsApp)",
    laboratorio: verificado ? t.laboratorio : null,
    duracao_dias: t.duracao_dias,
    preco: deCentavos(t.preco_centavos),
    taxa_entrega: 0,
    // Medicamentos tarjados não permitem abatimento de cashback e retêm o pedido para validação RT
    saldo_cashback: deCentavos(saldoValidoCentavos),
    exige_receita: !!t.exige_receita,
    receita_valida_ate: t.receita_valida_ate,
    receita_vencida: t.receita_valida_ate ? t.receita_valida_ate < hojeSP() : false,
    local_retirada: f.endereco_completo,
    farmacia: {
      nome_fantasia: f.nome_fantasia,
      razao_social: f.razao_social,
      cnpj: f.cnpj,
      afe_anvisa: f.afe_anvisa,
      licenca_sanitaria: f.licenca_sanitaria,
      horario_funcionamento: f.horario_funcionamento,
      endereco_completo: f.endereco_completo,
      farmaceutico_rt_nome: f.farmaceutico_rt_nome,
      farmaceutico_rt_crf: f.farmaceutico_rt_crf,
      dpo_email: f.dpo_email,
      telefone_sac: f.telefone_sac,
      telefone_whatsapp: f.telefone_whatsapp,
      chave_pix: f.chave_pix,
    },
  });
}

const confirmarSchema = z.object({
  ultimos4_telefone: z.string().regex(/^\d{4}$/, "Informe os 4 últimos dígitos do seu WhatsApp para confirmar sua identidade."),
  quantidade: z.coerce.number().int().min(1).max(6).default(1),
  forma_pagamento: z.enum(["PIX_DIRETO", "CARTAO_RETIRADA", "CARTAO_ENTREGA", "DINHEIRO"]),
  usar_cashback: z.boolean().default(false),
  endereco: z.string().trim().max(200).optional(),
});

export function recompraConfirmar(req, res) {
  const t = tratamentoPorToken(req.params.token);
  if (!["MONITORANDO", "ALERTA_5_DIAS", "MENSAGEM_ENVIADA"].includes(t.status_recompra)) {
    throw new HttpError(410, "Esta reposição já foi confirmada. Obrigado!");
  }
  const d = confirmarSchema.parse(req.body);

  // Validação obrigatória dos 4 últimos dígitos do WhatsApp do titular
  if (d.ultimos4_telefone !== t.telefone_whatsapp.slice(-4)) {
    throw new HttpError(403, "Os 4 últimos dígitos do WhatsApp não conferem com o titular deste tratamento.");
  }

  const farmacia = farmaciaDe(t.farmacia_id);
  const localRetirada = d.endereco || "Retirada no Balcão da Loja";
  const hoje = hojeSP();
  const agora = agoraSP();
  const receitaVencida = t.receita_valida_ate && t.receita_valida_ate < hoje;
  const exigeValidacaoRt = !!t.exige_receita || receitaVencida;

  const { pedido } = criarPedido({
    farmacia,
    itens: [{ produto_id: t.produto_id, quantidade: d.quantidade }],
    cliente: { nome: t.cliente_nome, whatsapp: t.telefone_whatsapp, endereco: localRetirada, cep: t.cep },
    formaPagamento: d.forma_pagamento,
    origem: "RECOMPRA_USO_CONTINUO",
    chaveIdempotencia: `recompra:${t.id}`,
    usarCashback: d.usar_cashback && !t.exige_receita,
    clienteAutorizadoId: t.cliente_id,
    tratamentoId: t.id,
    exigeValidacaoRt,
  });

  const novoStatusTrat = exigeValidacaoRt ? "AGUARDANDO_VALIDACAO_RT" : "RECOMPRA_CONFIRMADA";

  tx(() => {
    run(
      `UPDATE tratamentos_continuos
          SET status_recompra = ?,
              valor_recuperado_centavos = ?,
              confirmado_em = ?,
              token_recompra_hash = NULL
        WHERE id = ?`,
      novoStatusTrat,
      pedido.subtotal_centavos,
      agora,
      t.id
    );
    const proxTokenHash = hashSha256(novoTokenClaro());
    const proxDisparo = ajustarDiaDisparo(somarDias(hoje, t.duracao_dias * d.quantidade - (t.dias_antecedencia_alerta || 5)));
    run(
      `INSERT INTO tratamentos_continuos
        (farmacia_id, cliente_id, produto_id, duracao_dias, dias_antecedencia_alerta, data_ultima_compra, data_disparo_whatsapp, receita_valida_ate, token_recompra_hash, token_expira_em, cadastrado_por, criado_em)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      t.farmacia_id,
      t.cliente_id,
      t.produto_id,
      t.duracao_dias,
      t.dias_antecedencia_alerta || 5,
      hoje,
      proxDisparo,
      t.receita_valida_ate,
      proxTokenHash,
      somarDias(proxDisparo, 10),
      t.cadastrado_por,
      agora
    );
  });

  res.status(201).json({
    codigo_pedido: pedido.codigo_pedido,
    status_pedido: pedido.status_pedido,
    subtotal: pedido.subtotal,
    taxa_entrega: pedido.taxa_entrega,
    total: pedido.total,
    cashback_usado: pedido.cashback_usado,
    exige_validacao_rt: exigeValidacaoRt,
    exige_receita_na_entrega: !!t.exige_receita,
    aviso_regulatorio: exigeValidacaoRt
      ? "Por tratar-se de medicamento sujeito a prescrição (RDC 44/2009 e Lei 13.021/2014), seu pedido foi retido para validação do(a) Farmacêutico(a) RT antes da separação."
      : null,
    chave_pix_simulada: d.forma_pagamento === "PIX_DIRETO" ? farmacia.chave_pix : null,
  });
}
