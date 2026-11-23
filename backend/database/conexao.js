// Camada de conexão SQLite WAL + Motor de Estoque Único por Lotes com Saída FEFO
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { env } from "../config/env.js";
import { HttpError, hojeSP, log } from "../utils/comum.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.join(__dirname, "..", "..", "sql", "schema.sql");

let db = null;

export function abrirBanco() {
  fs.mkdirSync(path.dirname(env.DB_PATH), { recursive: true });
  db = new DatabaseSync(env.DB_PATH);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  db.exec(fs.readFileSync(SCHEMA_PATH, "utf8"));
  return db;
}

export function getDb() {
  if (!db) abrirBanco();
  return db;
}

export const all = (sql, ...p) => getDb().prepare(sql).all(...p);
export const get = (sql, ...p) => getDb().prepare(sql).get(...p);
export const run = (sql, ...p) => getDb().prepare(sql).run(...p);

export function tx(fn) {
  const d = getDb();
  d.exec("BEGIN IMMEDIATE");
  try {
    const r = fn();
    d.exec("COMMIT");
    return r;
  } catch (e) {
    try { d.exec("ROLLBACK"); } catch { /* já revertido */ }
    throw e;
  }
}

export function marcarExecucao(chave) {
  return run("INSERT OR IGNORE INTO execucoes_idempotentes (chave) VALUES (?)", chave).changes === 1;
}

/**
 * Fonte Única de Estoque:
 * - recalcula produtos.estoque_total como a soma exata dos lotes NÃO VENCIDOS (data_validade >= hojeSP)
 * - recalcula produtos.preco_promo_centavos baseado apenas em lotes válidos com DESTAQUE_VITRINE ou COMBO_RELAMPAGO
 */
export function sincronizarEstoqueProduto(produtoId) {
  const hoje = hojeSP();
  const row = get(
    `SELECT COALESCE(SUM(quantidade_atual), 0) AS total
       FROM lotes_estoque
      WHERE produto_id = ? AND quantidade_atual > 0 AND data_validade >= ?`,
    produtoId,
    hoje
  );
  const total = Number(row?.total || 0);

  const prod = get("SELECT preco_custo_centavos, preco_venda_centavos, exige_receita FROM produtos WHERE id = ?", produtoId);
  let promoC = null;
  if (prod && !prod.exige_receita) {
    const loteQueima = get(
      `SELECT desconto_aplicado_pct
         FROM lotes_estoque
        WHERE produto_id = ?
          AND quantidade_atual > 0
          AND data_validade >= ?
          AND acao_queima_ativa IN ('DESTAQUE_VITRINE', 'COMBO_RELAMPAGO')
          AND desconto_aplicado_pct > 0
        ORDER BY data_validade ASC, id ASC
        LIMIT 1`,
      produtoId,
      hoje
    );
    if (loteQueima) {
      promoC = Math.max(
        prod.preco_custo_centavos,
        Math.round(prod.preco_venda_centavos * (1 - loteQueima.desconto_aplicado_pct / 100))
      );
    }
  }

  run("UPDATE produtos SET estoque_total = ?, preco_promo_centavos = ? WHERE id = ?", total, promoC, produtoId);
  return total;
}

/**
 * Saída FEFO (First-Expired, First-Out):
 * - Consome primeiro dos lotes com validade mais próxima (bloqueando lotes vencidos)
 * - Verifica changes === 1 no UPDATE para impedir condição de corrida
 * - Só contabiliza unidades_salvas para lotes realmente em risco (<= 90 dias) ou com ação de queima ativa
 */
export function consumirEstoqueFEFO(farmaciaId, produtoId, quantidadeNecessaria) {
  const hoje = hojeSP();
  sincronizarEstoqueProduto(produtoId);
  const lotesValidos = all(
    `SELECT * FROM lotes_estoque
      WHERE farmacia_id = ? AND produto_id = ? AND quantidade_atual > 0 AND data_validade >= ?
      ORDER BY data_validade ASC, id ASC`,
    farmaciaId,
    produtoId,
    hoje
  );

  const saldoValido = lotesValidos.reduce((s, l) => s + l.quantidade_atual, 0);
  if (saldoValido < quantidadeNecessaria) {
    const prod = get("SELECT nome_comercial FROM produtos WHERE id = ?", produtoId);
    throw new HttpError(
      409,
      `Estoque válido (não vencido) insuficiente para "${prod?.nome_comercial || produtoId}" (disponível: ${saldoValido}).`
    );
  }

  let restante = quantidadeNecessaria;
  const lotesConsumidos = [];
  for (const lote of lotesValidos) {
    if (restante <= 0) break;
    const abater = Math.min(lote.quantidade_atual, restante);
    const diasRestantes = diffDiasSeguro(hoje, lote.data_validade);
    const emRiscoOuQueima = lote.acao_queima_ativa !== "NENHUMA" || diasRestantes <= 90;
    const upd = run(
      `UPDATE lotes_estoque
          SET quantidade_atual = quantidade_atual - ?,
              unidades_salvas = unidades_salvas + ?
        WHERE id = ? AND quantidade_atual >= ?`,
      abater,
      emRiscoOuQueima ? abater : 0,
      lote.id,
      abater
    );
    if (upd.changes !== 1) {
      throw new HttpError(409, "Conflito concorrente na baixa do lote. Tente novamente.");
    }
    restante -= abater;
    lotesConsumidos.push({
      lote_id: lote.id,
      numero_lote: lote.numero_lote,
      quantidade: abater,
      validade: lote.data_validade,
      desconto_lote_pct: ["DESTAQUE_VITRINE", "COMBO_RELAMPAGO"].includes(lote.acao_queima_ativa) ? lote.desconto_aplicado_pct : 0,
    });
  }

  sincronizarEstoqueProduto(produtoId);
  return lotesConsumidos;
}

function diffDiasSeguro(a, b) {
  const pa = Date.UTC(...a.split("-").map((v, i) => (i === 1 ? v - 1 : +v)));
  const pb = Date.UTC(...b.split("-").map((v, i) => (i === 1 ? v - 1 : +v)));
  return Math.round((pb - pa) / 86400000);
}

export function fecharBanco() {
  if (db) {
    try { db.close(); } catch { /* noop */ }
    db = null;
  }
}

export function snapshot(destino) {
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  if (fs.existsSync(destino)) fs.unlinkSync(destino);
  getDb().exec(`VACUUM INTO '${destino.replace(/'/g, "''")}'`);
  log("info", "Snapshot de backup criado", { destino });
  return destino;
}
