// Módulo B — Vitrine Digital Sênior (Conformidade ANVISA RDC 44/2009, Centavos INTEGER, Saída FEFO e Fotos SVG/Upload)
import { z } from "zod";
import { env } from "../config/env.js";
import { all, get, run, sincronizarEstoqueProduto, tx } from "../database/conexao.js";
import { auditar } from "../middlewares/seguranca.js";
import { gerarProduto } from "../services/aiCopilotService.js";
import { atualizarStatusPedido, criarPedido, listarPedidos } from "../services/pedidoCashbackService.js";
import { deCentavos, HttpError, hojeSP, paraCentavos, somarDias } from "../utils/comum.js";

export function resolverFarmaciaPublica(req) {
  const host = String(req.hostname || "").replace(/^www\./, "");
  let f = host ? get("SELECT * FROM farmacias WHERE dominio_proprio = ?", host) : null;
  if (!f && req.query.loja) f = get("SELECT * FROM farmacias WHERE slug = ?", String(req.query.loja).slice(0, 60));
  if (!f && !env.isProd) f = get("SELECT * FROM farmacias ORDER BY id LIMIT 1");
  if (!f) throw new HttpError(404, "Farmácia não encontrada para este endereço.");
  return f;
}

const publicaFarmacia = (f) => ({
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
  cashback_pct: f.cashback_pct,
  cashback_teto_pedido_pct: f.cashback_teto_pedido_pct,
  pedido_minimo: deCentavos(f.pedido_minimo_centavos),
  taxa_entrega: deCentavos(f.taxa_entrega_centavos),
  slug: f.slug,
  chave_pix: f.chave_pix,
  aceita_receita: true,
});

function formatarProduto(p) {
  return {
    ...p,
    preco_custo: p.preco_custo_centavos !== undefined ? deCentavos(p.preco_custo_centavos) : undefined,
    preco_venda: deCentavos(p.preco_venda_centavos),
    preco_promocional: p.preco_promo_centavos !== null && p.preco_promo_centavos !== undefined ? deCentavos(p.preco_promo_centavos) : null,
  };
}

export function catalogo(req, res) {
  const f = resolverFarmaciaPublica(req);
  const hoje = hojeSP();
  const rows = all(
    `SELECT p.id, p.nome_comercial, p.laboratorio, p.categoria, p.preco_venda_centavos, p.preco_promo_centavos,
            p.descricao_ia_seo, p.tags_busca_ia, p.imagem_emoji, p.imagem_url, p.estoque_total,
            p.estoque_total > 0 AS disponivel,
            EXISTS (
              SELECT 1 FROM lotes_estoque l
               WHERE l.produto_id = p.id
                 AND l.acao_queima_ativa IN ('DESTAQUE_VITRINE','COMBO_RELAMPAGO')
                 AND l.quantidade_atual > 0
                 AND l.data_validade >= ?
            ) AS oferta_relampago
       FROM produtos p
      WHERE p.farmacia_id = ? AND p.exibir_na_vitrine = 1 AND p.exige_receita = 0
      ORDER BY oferta_relampago DESC, (p.preco_promo_centavos IS NOT NULL) DESC, p.categoria, p.nome_comercial`,
    hoje,
    f.id
  );
  res.setHeader("Cache-Control", "public, max-age=15");
  res.json({ farmacia: publicaFarmacia(f), produtos: rows.map(formatarProduto) });
}

const pedidoSchema = z.object({
  cliente_nome: z.string().trim().min(3, "Informe seu nome completo.").max(80),
  whatsapp: z
    .string()
    .trim()
    .refine((v) => /^\d{10,13}$/.test(v.replace(/\D/g, "")), "WhatsApp inválido (DDD + número)."),
  endereco: z.string().trim().max(200).optional(),
  cep: z.string().trim().max(12).optional(),
  forma_pagamento: z.enum(["PIX_DIRETO", "CARTAO_RETIRADA", "CARTAO_ENTREGA", "DINHEIRO"]),
  troco_para: z.coerce.number().min(0).max(5000).optional(),
  itens: z
    .array(
      z.object({
        produto_id: z.coerce.number().int().positive(),
        quantidade: z.coerce.number().int().min(1).max(20),
      })
    )
    .min(1)
    .max(30),
  aceite_termos: z.literal(true, {
    message: "É necessário aceitar os Termos de Uso e a Política de Privacidade.",
    errorMap: () => ({ message: "É necessário aceitar os Termos de Uso e a Política de Privacidade." }),
  }),
});

export function criarPedidoPublico(req, res) {
  const f = resolverFarmaciaPublica(req);
  const d = pedidoSchema.parse(req.body);
  const chave = req.get("Idempotency-Key");
  if (chave && !/^[A-Za-z0-9_-]{8,64}$/.test(chave)) throw new HttpError(400, "Idempotency-Key inválida.");

  const { pedido, duplicado } = criarPedido({
    farmacia: f,
    itens: d.itens,
    cliente: {
      nome: d.cliente_nome,
      whatsapp: d.whatsapp,
      endereco: d.endereco || "Retirada no Balcão da Loja",
      cep: d.cep,
    },
    formaPagamento: d.forma_pagamento,
    trocoParaCentavos: d.troco_para ? paraCentavos(d.troco_para) : null,
    origem: "VITRINE_DIGITAL",
    chaveIdempotencia: chave ? `vitrine:${chave}` : null,
  });

  res.status(duplicado ? 200 : 201).json({
    codigo_pedido: pedido.codigo_pedido,
    status_pedido: pedido.status_pedido,
    subtotal: pedido.subtotal,
    taxa_entrega: 0,
    total: pedido.total,
    economia_ifood: pedido.economia_taxa_ifood,
    cashback_previsto: deCentavos(Math.round(pedido.subtotal_centavos * (f.cashback_pct / 100))),
    chave_pix: d.forma_pagamento === "PIX_DIRETO" ? f.chave_pix : null,
    aviso_pix_simulado:
      d.forma_pagamento === "PIX_DIRETO"
        ? "AMBIENTE DE DEMONSTRAÇÃO: Chave PIX ilustrativa. Em produção, cobrança integrada via PSP (Asaas/Efí) com baixa automática por webhook."
        : null,
    whatsapp_farmacia: f.telefone_whatsapp,
    local_retirada: f.endereco_completo,
  });
}

export function pedidosListar(req, res) {
  const status = req.query.status
    ? z
        .enum(["AGUARDANDO_VALIDACAO_RT", "NOVO", "SEPARANDO", "PRONTO_RETIRADA", "SAIU_ENTREGA", "CONCLUIDO", "CANCELADO", "DEVOLVIDO"])
        .parse(req.query.status)
    : null;
  const page = Number(req.query.page || 1);
  const limit = Number(req.query.limit || 50);
  res.json({ pedidos: listarPedidos(req.usuario.farmacia_id, status, page, limit) });
}

export function pedidoStatus(req, res) {
  const { status } = z
    .object({ status: z.enum(["SEPARANDO", "PRONTO_RETIRADA", "SAIU_ENTREGA", "CONCLUIDO", "CANCELADO", "DEVOLVIDO"]) })
    .parse(req.body);
  const farmacia = get("SELECT * FROM farmacias WHERE id = ?", req.usuario.farmacia_id);
  const r = atualizarStatusPedido(farmacia, Number(req.params.id), status, req.usuario);
  auditar(req, "PEDIDO_STATUS", `pedido:${req.params.id}:${status}`);
  res.json({
    pedido: {
      id: r.pedido.id,
      codigo_pedido: r.pedido.codigo_pedido,
      status_pedido: r.pedido.status_pedido,
      cliente_nome: r.pedido.cliente_nome,
      cliente_whatsapp: r.pedido.cliente_whatsapp,
    },
    cashback_gerado: r.cashbackGerado,
    link_pos_venda: r.linkPosVenda || null,
    mensagem_pos_venda: r.mensagemPosVenda || null,
    fila_id: r.filaId || null,
  });
}

export function produtosListar(req, res) {
  const rows = all(
    `SELECT id, ean_gtin, nome_comercial, principio_ativo, concentracao, forma_farmaceutica, tipo_medicamento, laboratorio, categoria,
            preco_custo_centavos, preco_venda_centavos, preco_promo_centavos,
            exige_receita, pendente_classificacao, exibir_na_vitrine, estoque_total, imagem_emoji, imagem_url, descricao_ia_seo,
            ROUND((preco_venda_centavos - preco_custo_centavos) * 100.0 / NULLIF(preco_venda_centavos,0), 1) AS margem_pct
       FROM produtos WHERE farmacia_id = ? ORDER BY pendente_classificacao DESC, exige_receita ASC, nome_comercial ASC`,
    req.usuario.farmacia_id
  );
  res.json({ produtos: rows.map(formatarProduto) });
}

const classificarSchema = z.object({
  exige_receita: z.boolean(),
  exibir_na_vitrine: z.boolean().default(true),
  preco_venda: z.coerce.number().positive().max(100000),
  categoria: z.enum(["CONTINUO", "REFERENCIA", "GENERICO_ALTA_MARGEM", "VITAMINAS", "DERMOCOSMETICOS", "INFANTIL", "PERFUMARIA", "CONVENIENCIA"]).optional(),
  tipo_medicamento: z.enum(["REFERENCIA", "GENERICO", "SIMILAR", "MIP", "NAO_MEDICAMENTO"]).optional(),
});

export function produtoClassificar(req, res) {
  const d = classificarSchema.parse(req.body);
  const fid = req.usuario.farmacia_id;
  const prod = get("SELECT * FROM produtos WHERE id = ? AND farmacia_id = ?", Number(req.params.id), fid);
  if (!prod) throw new HttpError(404, "Produto não encontrado.");
  const vendaC = paraCentavos(d.preco_venda);
  if (vendaC < prod.preco_custo_centavos) {
    throw new HttpError(422, "O preço de venda não pode ser menor que o preço de custo.");
  }
  const exibir = d.exige_receita ? 0 : d.exibir_na_vitrine ? 1 : 0;
  run(
    `UPDATE produtos
        SET exige_receita = ?,
            pendente_classificacao = 0,
            exibir_na_vitrine = ?,
            preco_venda_centavos = ?,
            categoria = COALESCE(?, categoria),
            tipo_medicamento = COALESCE(?, tipo_medicamento)
      WHERE id = ? AND farmacia_id = ?`,
    d.exige_receita ? 1 : 0,
    exibir,
    vendaC,
    d.categoria || null,
    d.tipo_medicamento || null,
    prod.id,
    fid
  );
  auditar(req, "PRODUTO_CLASSIFICADO_RT", `produto:${prod.id}:receita:${d.exige_receita}`);
  res.json({ ok: true });
}

export async function produtoGerarIA(req, res) {
  const { nome_bruto } = z.object({ nome_bruto: z.string().trim().min(3).max(120) }).parse(req.body);
  res.json(await gerarProduto(nome_bruto));
}

const produtoSchema = z.object({
  nome_comercial: z.string().trim().min(3).max(120),
  categoria: z.enum(["VITAMINAS", "DERMOCOSMETICOS", "INFANTIL", "PERFUMARIA", "CONVENIENCIA"]),
  ean_gtin: z.string().regex(/^\d{8,14}$/).optional().or(z.literal("")),
  preco_custo: z.coerce.number().min(0).max(100000),
  preco_venda: z.coerce.number().positive().max(100000),
  estoque_total: z.coerce.number().int().min(0).max(100000),
  numero_lote_inicial: z.string().trim().max(40).optional(),
  validade_lote_inicial: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  descricao_ia_seo: z.string().max(300).optional(),
  tags_busca_ia: z.string().max(200).optional(),
  imagem_url: z.string().max(500_000).optional(),
  exibir_na_vitrine: z.boolean().default(true),
});

export function produtoCriar(req, res) {
  const d = produtoSchema.parse(req.body);
  const custoC = paraCentavos(d.preco_custo);
  const vendaC = paraCentavos(d.preco_venda);
  if (vendaC < custoC) throw new HttpError(422, "O preço de venda não pode ser menor que o preço de custo.");
  const emoji = { VITAMINAS: "🍊", DERMOCOSMETICOS: "🧴", INFANTIL: "👶", PERFUMARIA: "🧼", CONVENIENCIA: "🩹" }[d.categoria];
  const svgPadrao = `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 140"><rect width="240" height="140" rx="18" fill="#ECFDF5" stroke="#059669" stroke-width="2"/><g transform="translate(36, 44)" fill="none" stroke="#059669" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="8" width="44" height="36" rx="8"/><path d="M16 8V4h16v4"/><path d="M24 19v14M17 26h14"/></g><rect x="104" y="46" width="112" height="48" rx="10" fill="#FFFFFF"/><text x="160" y="75" font-family="sans-serif" font-size="13" font-weight="bold" fill="#047857" text-anchor="middle">${d.categoria.slice(0, 8)}</text></svg>`
  )}`;

  try {
    const id = tx(() => {
      const prodId = run(
        `INSERT INTO produtos
          (farmacia_id, ean_gtin, nome_comercial, categoria, preco_custo_centavos, preco_venda_centavos, exige_receita, exibir_na_vitrine, estoque_total, descricao_ia_seo, tags_busca_ia, imagem_emoji, imagem_url)
         VALUES (?,?,?,?,?,?,0,?,0,?,?,?,?)`,
        req.usuario.farmacia_id,
        d.ean_gtin || null,
        d.nome_comercial,
        d.categoria,
        custoC,
        vendaC,
        d.exibir_na_vitrine ? 1 : 0,
        d.descricao_ia_seo || null,
        d.tags_busca_ia || null,
        emoji,
        d.imagem_url || svgPadrao
      ).lastInsertRowid;

      // P2-1: Todo estoque inicial nasce de um lote rastreável para manter fonte única FEFO
      if (d.estoque_total > 0) {
        const loteCodigo = d.numero_lote_inicial || `LOTE-INI-${prodId}`;
        const valData = d.validade_lote_inicial || somarDias(hojeSP(), 365);
        run(
          `INSERT INTO lotes_estoque (farmacia_id, produto_id, numero_lote, nota_fiscal_ref, quantidade_atual, custo_unitario_centavos, data_validade)
           VALUES (?,?,?,?,?,?,?)`,
          req.usuario.farmacia_id,
          prodId,
          loteCodigo,
          "Cadastro Inicial",
          d.estoque_total,
          custoC,
          valData
        );
        sincronizarEstoqueProduto(prodId);
      }
      return prodId;
    });
    auditar(req, "PRODUTO_CRIADO", `produto:${id}`);
    res.status(201).json({ id });
  } catch (e) {
    if (String(e.message).includes("UNIQUE")) throw new HttpError(409, "Já existe um produto cadastrado com este código EAN.");
    throw e;
  }
}
