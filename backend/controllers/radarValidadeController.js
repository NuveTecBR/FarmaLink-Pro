// Módulo D — Radar Anti-Vencimento & Queima Inteligente de Lotes (90 / 60 / 30 dias):
// - Idempotência por chave de acesso da NF-e (chNFe) + múltiplos <rastro> + exigência de data de validade <dVal>
// - Produtos novos de XML nascem OCULTOS (exibir_na_vitrine = 0, exige_receita = 1, pendente_classificacao = 1) para segurança ANVISA RDC 44/2009
// - Bloqueio estrito de venda de lote vencido e verificação de changes === 1 no UPDATE
import { z } from "zod";
import { all, get, marcarExecucao, run, sincronizarEstoqueProduto, tx } from "../database/conexao.js";
import { auditar } from "../middlewares/seguranca.js";
import { parseNFe } from "../services/xmlParserService.js";
import { agoraSP, deCentavos, faixaRisco, HttpError, hojeSP, paraCentavos } from "../utils/comum.js";

const ROTULO_FAIXA = {
  VENCIDO: "⛔ VENCIDO (VENDA BLOQUEADA)",
  CRITICO_30D: "🔴 CRÍTICO ≤ 30d",
  ALERTA_60D: "🟠 ALERTA ≤ 60d",
  ALERTA_90D: "🟡 ATENÇÃO ≤ 90d",
  SEGURO: "🟢 SEGURO > 90d",
};

export function listar(req, res) {
  const fid = req.usuario.farmacia_id;
  const hoje = hojeSP();
  const rows = all(
    `SELECT l.*, p.nome_comercial, p.laboratorio, p.categoria, p.preco_venda_centavos, p.preco_promo_centavos, p.exige_receita, p.pendente_classificacao, p.imagem_emoji
       FROM lotes_estoque l
       JOIN produtos p ON p.id = l.produto_id
      WHERE l.farmacia_id = ? AND l.quantidade_atual > 0
      ORDER BY l.data_validade ASC`,
    fid
  );

  const lotes = rows.map((l) => {
    const { faixa, dias } = faixaRisco(l.data_validade, hoje);
    const capitalParadoC = l.quantidade_atual * l.custo_unitario_centavos;
    const capitalSalvoC = l.unidades_salvas * l.custo_unitario_centavos;
    return {
      ...l,
      custo_unitario: deCentavos(l.custo_unitario_centavos),
      preco_venda: deCentavos(l.preco_venda_centavos),
      preco_promocional: l.preco_promo_centavos ? deCentavos(l.preco_promo_centavos) : null,
      dias_para_vencer: dias,
      faixa_risco: faixa,
      rotulo_risco: ROTULO_FAIXA[faixa] || faixa,
      capital_parado: deCentavos(capitalParadoC),
      capital_salvo: deCentavos(capitalSalvoC),
    };
  });

  const emRisco = lotes.filter((l) => ["CRITICO_30D", "ALERTA_60D", "ALERTA_90D"].includes(l.faixa_risco));
  const totalSalvoRows = get(
    `SELECT COALESCE(SUM(unidades_salvas * custo_unitario_centavos), 0) AS salvo_centavos,
            COALESCE(SUM(unidades_salvas), 0) AS unidades
       FROM lotes_estoque WHERE farmacia_id = ?`,
    fid
  );

  res.json({
    hoje,
    resumo: {
      critico_30d: lotes.filter((l) => l.faixa_risco === "CRITICO_30D").length,
      alerta_60d: lotes.filter((l) => l.faixa_risco === "ALERTA_60D").length,
      atencao_90d: lotes.filter((l) => l.faixa_risco === "ALERTA_90D").length,
      vencidos_bloqueados: lotes.filter((l) => l.faixa_risco === "VENCIDO").length,
      capital_em_risco: deCentavos(emRisco.reduce((s, l) => s + l.quantidade_atual * l.custo_unitario_centavos, 0)),
      capital_salvo_total: deCentavos(totalSalvoRows.salvo_centavos),
      unidades_salvas_total: totalSalvoRows.unidades,
    },
    lotes,
  });
}

const loteSchema = z.object({
  produto_id: z.coerce.number().int().positive(),
  numero_lote: z.string().trim().min(2, "Informe o código do lote.").max(40),
  nota_fiscal_ref: z.string().trim().max(60).optional(),
  quantidade_atual: z.coerce.number().int().min(1).max(100000),
  custo_unitario: z.coerce.number().min(0).max(100000),
  data_validade: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data de validade inválida (YYYY-MM-DD)."),
});

export function cadastrarLote(req, res) {
  const d = loteSchema.parse(req.body);
  const fid = req.usuario.farmacia_id;
  const prod = get("SELECT id FROM produtos WHERE id = ? AND farmacia_id = ?", d.produto_id, fid);
  if (!prod) throw new HttpError(404, "Produto não encontrado nesta farmácia.");
  const custoC = paraCentavos(d.custo_unitario);

  const id = tx(() => {
    const existente = get(
      "SELECT id FROM lotes_estoque WHERE farmacia_id = ? AND produto_id = ? AND numero_lote = ?",
      fid,
      d.produto_id,
      d.numero_lote
    );
    let loteId;
    if (existente) {
      run(
        "UPDATE lotes_estoque SET quantidade_atual = quantidade_atual + ?, custo_unitario_centavos = ?, data_validade = ? WHERE id = ?",
        d.quantidade_atual,
        custoC,
        d.data_validade,
        existente.id
      );
      loteId = existente.id;
    } else {
      loteId = run(
        `INSERT INTO lotes_estoque (farmacia_id, produto_id, numero_lote, nota_fiscal_ref, quantidade_atual, custo_unitario_centavos, data_validade, criado_em)
         VALUES (?,?,?,?,?,?,?,?)`,
        fid,
        d.produto_id,
        d.numero_lote,
        d.nota_fiscal_ref || null,
        d.quantidade_atual,
        custoC,
        d.data_validade,
        agoraSP()
      ).lastInsertRowid;
    }
    sincronizarEstoqueProduto(d.produto_id);
    return loteId;
  });

  auditar(req, "LOTE_CADASTRADO", `lote:${id}`);
  res.status(201).json({ id });
}

const xmlSchema = z.object({
  xml: z.string().min(30, "Envie o conteúdo XML da NF-e.").max(1_500_000),
});

export function importarXmlNFe(req, res) {
  const { xml } = xmlSchema.parse(req.body);
  const fid = req.usuario.farmacia_id;
  let parsed;
  try {
    parsed = parseNFe(xml);
  } catch (e) {
    throw new HttpError(422, e.message);
  }

  // Exige validade real em todos os itens da NF-e (proibido inventar validade de 1 ano em farmácia)
  for (const it of parsed.itens) {
    if (!it.validade || !/^\d{4}-\d{2}-\d{2}$/.test(it.validade)) {
      throw new HttpError(
        422,
        `O item "${it.descricao}" da NF-e não informa data de validade (<dVal>). Pela norma sanitária, cadastre o lote manualmente informando a validade real da embalagem.`
      );
    }
  }

  // Idempotência por chave de acesso da NF-e (ou hash SHA-256 do XML caso não traga tag de chave)
  const chaveIdemp = `nfe_xml:${fid}:${parsed.chave_acesso}`;
  if (!marcarExecucao(chaveIdemp)) {
    throw new HttpError(409, `A NF-e (${parsed.chave_acesso}) já foi importada anteriormente nesta farmácia.`);
  }

  const agora = agoraSP();
  const importados = tx(() => {
    const lista = [];
    for (const it of parsed.itens) {
      let prod = it.ean ? get("SELECT * FROM produtos WHERE farmacia_id = ? AND ean_gtin = ?", fid, it.ean) : null;
      if (!prod) {
        prod = get("SELECT * FROM produtos WHERE farmacia_id = ? AND lower(nome_comercial) = lower(?)", fid, it.descricao);
      }
      const custoC = paraCentavos(it.valor_unitario);
      let criadoPendente = false;
      if (!prod) {
        // SEGURANÇA ANVISA RDC 44/2009: Produto novo vindo de XML nasce OCULTO na vitrine (exibir_na_vitrine = 0),
        // bloqueado como tarjado por precaução (exige_receita = 1) e marcado pendente_classificacao = 1.
        // Não inventa markup de preço de venda (mantém preço_custo até precificação e classificação pelo(a) RT/Diretor).
        const prodId = run(
          `INSERT INTO produtos
            (farmacia_id, ean_gtin, nome_comercial, categoria, preco_custo_centavos, preco_venda_centavos, exige_receita, pendente_classificacao, exibir_na_vitrine, estoque_total, imagem_emoji, criado_em)
           VALUES (?,?,?,?,?,?,1,1,0,0,'📦',?)`,
          fid,
          it.ean || null,
          it.descricao,
          "CONVENIENCIA",
          custoC,
          custoC,
          agora
        ).lastInsertRowid;
        prod = get("SELECT * FROM produtos WHERE id = ?", prodId);
        criadoPendente = true;
      }

      const numLote = it.lote || `NFE-${parsed.numero || "S/N"}-${lista.length + 1}`;
      const validade = it.validade;
      const existente = get(
        "SELECT id FROM lotes_estoque WHERE farmacia_id = ? AND produto_id = ? AND numero_lote = ?",
        fid,
        prod.id,
        numLote
      );
      if (existente) {
        run("UPDATE lotes_estoque SET quantidade_atual = quantidade_atual + ?, data_validade = ? WHERE id = ?", it.quantidade, validade, existente.id);
      } else {
        run(
          `INSERT INTO lotes_estoque (farmacia_id, produto_id, numero_lote, nota_fiscal_ref, quantidade_atual, custo_unitario_centavos, data_validade, criado_em)
           VALUES (?,?,?,?,?,?,?,?)`,
          fid,
          prod.id,
          numLote,
          parsed.numero ? `NFe ${parsed.numero}` : "NFe XML",
          it.quantidade,
          custoC || prod.preco_custo_centavos,
          validade,
          agora
        );
      }
      sincronizarEstoqueProduto(prod.id);
      lista.push({
        produto: prod.nome_comercial,
        lote: numLote,
        quantidade: it.quantidade,
        validade,
        pendente_classificacao: criadoPendente || !!prod.pendente_classificacao,
      });
    }
    return lista;
  });

  auditar(req, "NFE_XML_IMPORTADA", `nfe:${parsed.chave_acesso}:itens:${importados.length}`);
  res.status(201).json({
    nota_fiscal: parsed.numero,
    chave_acesso: parsed.chave_acesso,
    itens_importados: importados.length,
    detalhes: importados,
  });
}

const acaoSchema = z.object({
  acao: z.enum(["NENHUMA", "DESTAQUE_VITRINE", "COMISSAO_BONUS_EQUIPE", "COMBO_RELAMPAGO"]),
  desconto_pct: z.coerce.number().min(0).max(70).default(20),
  comissao_extra_pct: z.coerce.number().min(0).max(25).default(5),
});

export function ativarAcaoQueima(req, res) {
  const d = acaoSchema.parse(req.body);
  const fid = req.usuario.farmacia_id;
  const lote = get(
    `SELECT l.*, p.preco_venda_centavos, p.preco_custo_centavos, p.exige_receita, p.pendente_classificacao, p.nome_comercial
       FROM lotes_estoque l JOIN produtos p ON p.id = l.produto_id
      WHERE l.id = ? AND l.farmacia_id = ?`,
    Number(req.params.id),
    fid
  );
  if (!lote) throw new HttpError(404, "Lote não encontrado.");

  if ((lote.exige_receita || lote.pendente_classificacao) && ["DESTAQUE_VITRINE", "COMBO_RELAMPAGO"].includes(d.acao)) {
    throw new HttpError(
      422,
      `"${lote.nome_comercial}" exige prescrição médica ou aguarda classificação sanitária e não pode entrar em promoção pública na Vitrine (RDC 44/2009). Utilize "Comissão Bônus para Equipe no Balcão".`
    );
  }

  const novoPrecoPromo = tx(() => {
    // COMISSAO_BONUS_EQUIPE incentiva apenas a equipe no balcão — NÃO aplica desconto público nem publica o produto na vitrine
    const ehOfertaPublica = ["DESTAQUE_VITRINE", "COMBO_RELAMPAGO"].includes(d.acao);
    const desc = ehOfertaPublica ? d.desconto_pct : 0;
    const com = d.acao === "NENHUMA" ? 0 : d.comissao_extra_pct;

    run(
      `UPDATE lotes_estoque SET acao_queima_ativa = ?, desconto_aplicado_pct = ?, comissao_extra_balconista_pct = ? WHERE id = ?`,
      d.acao,
      desc,
      com,
      lote.id
    );

    if (ehOfertaPublica && !lote.exige_receita && !lote.pendente_classificacao) {
      run("UPDATE produtos SET exibir_na_vitrine = 1 WHERE id = ?", lote.produto_id);
    }

    // Recalcula estoque e preco_promo_centavos ativo a partir dos lotes válidos em oferta
    sincronizarEstoqueProduto(lote.produto_id);
    const prodAtual = get("SELECT preco_promo_centavos FROM produtos WHERE id = ?", lote.produto_id);
    return prodAtual?.preco_promo_centavos ? deCentavos(prodAtual.preco_promo_centavos) : null;
  });

  auditar(req, "LOTE_ACAO_QUEIMA", `lote:${lote.id}:${d.acao}`);
  res.json({ ok: true, acao: d.acao, preco_promocional: novoPrecoPromo });
}

const baixaSchema = z.object({
  quantidade: z.coerce.number().int().min(1).max(500).default(1),
});

export function registrarVendaLote(req, res) {
  const { quantidade } = baixaSchema.parse(req.body);
  const fid = req.usuario.farmacia_id;
  const hoje = hojeSP();
  const lote = get(
    `SELECT l.*, p.preco_venda_centavos, p.preco_custo_centavos, p.nome_comercial
       FROM lotes_estoque l JOIN produtos p ON p.id = l.produto_id
      WHERE l.id = ? AND l.farmacia_id = ?`,
    Number(req.params.id),
    fid
  );
  if (!lote) throw new HttpError(404, "Lote não encontrado.");

  // Bloqueia terminantemente a venda de lote vencido
  const { faixa, dias } = faixaRisco(lote.data_validade, hoje);
  if (faixa === "VENCIDO") {
    throw new HttpError(422, `Venda bloqueada (ANVISA RDC 44/2009): o lote ${lote.numero_lote} está vencido (${lote.data_validade}) e deve ser segregado para descarte.`);
  }

  if (lote.quantidade_atual < quantidade) {
    throw new HttpError(409, `Quantidade maior que o saldo do lote (${lote.quantidade_atual}).`);
  }

  // Preço específico deste lote (desconto do lote aplica-se apenas a este lote)
  const precoUnitC =
    lote.desconto_aplicado_pct > 0
      ? Math.max(lote.preco_custo_centavos, Math.round(lote.preco_venda_centavos * (1 - lote.desconto_aplicado_pct / 100)))
      : lote.preco_venda_centavos;
  const valorVendaC = precoUnitC * quantidade;

  // Só paga comissão extra se o lote tiver comissao_extra_balconista_pct > 0 configurada (sem fallback fixo de 4%)
  const pctComissao = Number(lote.comissao_extra_balconista_pct || 0) / 100;
  const comissaoGanhaC = Math.round(valorVendaC * pctComissao);

  // Só contabiliza como "capital salvo" se o lote estava efetivamente em janela de risco (<= 90 dias) ou com ação de queima ativa
  const emRiscoOuQueima = dias <= 90 || lote.acao_queima_ativa !== "NENHUMA";
  const unidadesSalvasInc = emRiscoOuQueima ? quantidade : 0;
  const capitalSalvoC = unidadesSalvasInc * lote.custo_unitario_centavos;

  tx(() => {
    const upd = run(
      "UPDATE lotes_estoque SET quantidade_atual = quantidade_atual - ?, unidades_salvas = unidades_salvas + ? WHERE id = ? AND quantidade_atual >= ?",
      quantidade,
      unidadesSalvasInc,
      lote.id,
      quantidade
    );
    if (upd.changes !== 1) {
      throw new HttpError(409, "Saldo do lote alterado concorrentemente. Operação abortada para evitar crédito duplicado.");
    }
    sincronizarEstoqueProduto(lote.produto_id);
    run(
      "UPDATE usuarios SET vendas_mes_centavos = vendas_mes_centavos + ?, comissao_acum_centavos = comissao_acum_centavos + ? WHERE id = ?",
      valorVendaC,
      comissaoGanhaC,
      req.usuario.id
    );
  });

  auditar(req, "LOTE_VENDA_BALCAO", `lote:${lote.id}:qtd:${quantidade}`);
  res.json({
    ok: true,
    valor_venda: deCentavos(valorVendaC),
    capital_salvo: deCentavos(capitalSalvoC),
    comissao_creditada: deCentavos(comissaoGanhaC),
  });
}
