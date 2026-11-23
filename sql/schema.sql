-- =====================================================================
-- FarmaLink Pro v3.2 — Schema Relacional Multi-Tenant (Método ENDS)
-- Conformidade: ANVISA RDC 44/2009, Lei 13.021/2014, Lei 9.787/99, LGPD Art. 11/18/33, CDC
-- Valores monetários em centavos inteiros + Triggers Append-Only
-- =====================================================================
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS farmacias (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  slug                     TEXT NOT NULL UNIQUE,
  razao_social             TEXT NOT NULL,
  nome_fantasia            TEXT NOT NULL,
  cnpj                     TEXT NOT NULL UNIQUE,
  afe_anvisa               TEXT NOT NULL DEFAULT 'AFE 7.48291.3',
  licenca_sanitaria        TEXT NOT NULL DEFAULT 'LS-PR 2026/009412',
  horario_funcionamento    TEXT NOT NULL DEFAULT 'Seg a Sáb das 08h às 22h | Dom das 09h às 20h',
  endereco_completo        TEXT NOT NULL,
  farmaceutico_rt_nome     TEXT NOT NULL,
  farmaceutico_rt_crf      TEXT NOT NULL,
  dpo_email                TEXT NOT NULL,
  telefone_sac             TEXT NOT NULL DEFAULT '0800-770-4100',
  dominio_proprio          TEXT,
  telefone_whatsapp        TEXT NOT NULL,
  google_maps_review_url   TEXT,
  chave_pix                TEXT,
  cashback_pct             REAL NOT NULL DEFAULT 5.0 CHECK (cashback_pct BETWEEN 0 AND 30),
  cashback_teto_pedido_pct REAL NOT NULL DEFAULT 30.0 CHECK (cashback_teto_pedido_pct BETWEEN 5 AND 100),
  pedido_minimo_centavos   INTEGER NOT NULL DEFAULT 0,
  taxa_entrega_centavos    INTEGER NOT NULL DEFAULT 0,
  taxa_marketplace_ref_pct REAL NOT NULL DEFAULT 22.0 CHECK (taxa_marketplace_ref_pct BETWEEN 0 AND 50),
  modo_whatsapp            TEXT NOT NULL DEFAULT 'SEGURO_1_CLIQUE' CHECK (modo_whatsapp IN ('SEGURO_1_CLIQUE','META_CLOUD_API')),
  meta_wa_phone_id         TEXT,
  meta_wa_token            TEXT,
  meta_wa_template_name    TEXT NOT NULL DEFAULT 'lembrete_reposicao_farmalink',
  plano_ativo              TEXT NOT NULL DEFAULT 'PRO_IA' CHECK (plano_ativo IN ('ESSENCIAL','PRO_IA')),
  meta_mensal_centavos     INTEGER NOT NULL DEFAULT 18000000,
  mes_referencia_vendas    TEXT,
  criado_em                TEXT NOT NULL DEFAULT (datetime('now', '-3 hours'))
);

CREATE TABLE IF NOT EXISTS usuarios (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  farmacia_id              INTEGER NOT NULL REFERENCES farmacias(id) ON DELETE CASCADE,
  nome                     TEXT NOT NULL,
  email                    TEXT NOT NULL UNIQUE,
  cpf                      TEXT NOT NULL UNIQUE CHECK (length(cpf) = 11),
  senha_hash               TEXT NOT NULL,
  cargo                    TEXT NOT NULL CHECK (cargo IN ('DIRETOR','FARMACEUTICO','BALCONISTA')),
  crf_uf                   TEXT,
  totp_habilitado          INTEGER NOT NULL DEFAULT 0,
  tentativas_falhas        INTEGER NOT NULL DEFAULT 0,
  bloqueado_ate            TEXT,
  meta_individual_centavos INTEGER NOT NULL DEFAULT 0,
  vendas_mes_centavos      INTEGER NOT NULL DEFAULT 0,
  comissao_acum_centavos   INTEGER NOT NULL DEFAULT 0,
  tema_preferido           TEXT NOT NULL DEFAULT 'light' CHECK (tema_preferido IN ('dark','light')),
  sidebar_pinned           INTEGER NOT NULL DEFAULT 1,
  ativo                    INTEGER NOT NULL DEFAULT 1,
  criado_em                TEXT NOT NULL DEFAULT (datetime('now', '-3 hours'))
);

CREATE TABLE IF NOT EXISTS sessoes_ativas (
  jti        TEXT PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  expira_em  TEXT NOT NULL,
  revogada   INTEGER NOT NULL DEFAULT 0,
  criado_em  TEXT NOT NULL DEFAULT (datetime('now', '-3 hours'))
);

CREATE TABLE IF NOT EXISTS clientes (
  id                          INTEGER PRIMARY KEY AUTOINCREMENT,
  farmacia_id                 INTEGER NOT NULL REFERENCES farmacias(id) ON DELETE CASCADE,
  nome                        TEXT NOT NULL,
  telefone_whatsapp           TEXT NOT NULL,
  endereco_entrega            TEXT,
  cep                         TEXT,
  saldo_cashback_centavos     INTEGER NOT NULL DEFAULT 0 CHECK (saldo_cashback_centavos >= 0),
  lgpd_consentimento_saude_em TEXT,
  lgpd_optin_comunicacao_em   TEXT,
  lgpd_consentimento_canal    TEXT,
  anonimizado_em              TEXT,
  total_gasto_centavos        INTEGER NOT NULL DEFAULT 0,
  criado_em                   TEXT NOT NULL DEFAULT (datetime('now', '-3 hours')),
  UNIQUE (farmacia_id, telefone_whatsapp)
);

CREATE TABLE IF NOT EXISTS produtos (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  farmacia_id             INTEGER NOT NULL REFERENCES farmacias(id) ON DELETE CASCADE,
  ean_gtin                TEXT,
  nome_comercial          TEXT NOT NULL,
  principio_ativo         TEXT,
  concentracao            TEXT,
  forma_farmaceutica      TEXT,
  tipo_medicamento        TEXT NOT NULL DEFAULT 'NAO_MEDICAMENTO' CHECK (tipo_medicamento IN ('REFERENCIA','GENERICO','SIMILAR','MIP','NAO_MEDICAMENTO')),
  laboratorio             TEXT DEFAULT 'Associadas Farma',
  categoria               TEXT NOT NULL CHECK (categoria IN ('CONTINUO','REFERENCIA','GENERICO_ALTA_MARGEM','PERFUMARIA','VITAMINAS','DERMOCOSMETICOS','INFANTIL','CONVENIENCIA')),
  preco_custo_centavos    INTEGER NOT NULL CHECK (preco_custo_centavos >= 0),
  preco_venda_centavos    INTEGER NOT NULL CHECK (preco_venda_centavos >= 0),
  preco_promo_centavos    INTEGER,
  exige_receita           INTEGER NOT NULL DEFAULT 0,
  pendente_classificacao  INTEGER NOT NULL DEFAULT 0,
  exibir_na_vitrine       INTEGER NOT NULL DEFAULT 0,
  estoque_total           INTEGER NOT NULL DEFAULT 0,
  descricao_ia_seo        TEXT,
  tags_busca_ia           TEXT,
  imagem_emoji            TEXT DEFAULT '💊',
  imagem_url              TEXT,
  criado_em               TEXT NOT NULL DEFAULT (datetime('now', '-3 hours')),
  UNIQUE (farmacia_id, ean_gtin)
);

CREATE TABLE IF NOT EXISTS tratamentos_continuos (
  id                         INTEGER PRIMARY KEY AUTOINCREMENT,
  farmacia_id                INTEGER NOT NULL REFERENCES farmacias(id) ON DELETE CASCADE,
  cliente_id                 INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  produto_id                 INTEGER NOT NULL REFERENCES produtos(id),
  duracao_dias               INTEGER NOT NULL CHECK (duracao_dias IN (30,60,90)),
  dias_antecedencia_alerta   INTEGER NOT NULL DEFAULT 5 CHECK (dias_antecedencia_alerta BETWEEN 2 AND 15),
  data_ultima_compra         TEXT NOT NULL,
  data_disparo_whatsapp      TEXT NOT NULL,
  receita_valida_ate         TEXT,
  status_recompra            TEXT NOT NULL DEFAULT 'MONITORANDO' CHECK (status_recompra IN ('MONITORANDO','ALERTA_5_DIAS','MENSAGEM_ENVIADA','AGUARDANDO_VALIDACAO_RT','RECOMPRA_CONFIRMADA','CANCELADO')),
  valor_recuperado_centavos  INTEGER NOT NULL DEFAULT 0,
  confirmado_em              TEXT,
  token_recompra_hash        TEXT UNIQUE,
  token_expira_em            TEXT,
  cadastrado_por             INTEGER REFERENCES usuarios(id),
  validado_por_rt_id         INTEGER REFERENCES usuarios(id),
  criado_em                  TEXT NOT NULL DEFAULT (datetime('now', '-3 hours'))
);

CREATE TABLE IF NOT EXISTS lotes_estoque (
  id                            INTEGER PRIMARY KEY AUTOINCREMENT,
  farmacia_id                   INTEGER NOT NULL REFERENCES farmacias(id) ON DELETE CASCADE,
  produto_id                    INTEGER NOT NULL REFERENCES produtos(id),
  numero_lote                   TEXT NOT NULL,
  nota_fiscal_ref               TEXT,
  quantidade_atual              INTEGER NOT NULL CHECK (quantidade_atual >= 0),
  custo_unitario_centavos       INTEGER NOT NULL,
  data_validade                 TEXT NOT NULL,
  acao_queima_ativa             TEXT NOT NULL DEFAULT 'NENHUMA' CHECK (acao_queima_ativa IN ('NENHUMA','DESTAQUE_VITRINE','COMISSAO_BONUS_EQUIPE','COMBO_RELAMPAGO')),
  desconto_aplicado_pct         REAL NOT NULL DEFAULT 0,
  comissao_extra_balconista_pct REAL NOT NULL DEFAULT 0,
  unidades_salvas               INTEGER NOT NULL DEFAULT 0,
  criado_em                     TEXT NOT NULL DEFAULT (datetime('now', '-3 hours')),
  UNIQUE (farmacia_id, produto_id, numero_lote)
);

CREATE TABLE IF NOT EXISTS orcamentos_receita (
  id                          INTEGER PRIMARY KEY AUTOINCREMENT,
  farmacia_id                 INTEGER NOT NULL REFERENCES farmacias(id) ON DELETE CASCADE,
  cliente_nome                TEXT NOT NULL,
  cliente_whatsapp            TEXT NOT NULL,
  consentimento_lgpd_receita  INTEGER NOT NULL CHECK (consentimento_lgpd_receita = 1),
  medico_proibiu_substituicao INTEGER NOT NULL DEFAULT 0,
  imagem_receita_path         TEXT,
  imagem_expira_em            TEXT,
  texto_informado             TEXT,
  anonimizado_para_ia         INTEGER NOT NULL DEFAULT 1,
  motor_ia                    TEXT,
  status_triagem              TEXT NOT NULL DEFAULT 'AGUARDANDO_APROVACAO' CHECK (status_triagem IN ('AGUARDANDO_APROVACAO','REVISAO_MANUAL','ENVIADO_WHATSAPP','CONVERTIDO_EM_VENDA','DESCARTADO')),
  valor_ref_centavos          INTEGER NOT NULL DEFAULT 0,
  valor_otimizado_centavos    INTEGER NOT NULL DEFAULT 0,
  margem_ganha_centavos       INTEGER NOT NULL DEFAULT 0,
  ganho_extra_margem_centavos INTEGER NOT NULL DEFAULT 0,
  atendido_por_usuario_id     INTEGER REFERENCES usuarios(id),
  tempo_resposta_segundos     INTEGER,
  criado_em                   TEXT NOT NULL DEFAULT (datetime('now', '-3 hours'))
);

CREATE TABLE IF NOT EXISTS itens_orcamento_ia (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  orcamento_id            INTEGER NOT NULL REFERENCES orcamentos_receita(id) ON DELETE CASCADE,
  item_prescrito_texto    TEXT NOT NULL,
  produto_referencia_id   INTEGER REFERENCES produtos(id),
  produto_sugerido_id     INTEGER REFERENCES produtos(id),
  quantidade              INTEGER NOT NULL DEFAULT 1,
  preco_ref_centavos      INTEGER NOT NULL DEFAULT 0,
  preco_sugerido_centavos INTEGER NOT NULL DEFAULT 0,
  margem_sugerido_pct     REAL NOT NULL DEFAULT 0,
  substituicao_bloqueada  INTEGER NOT NULL DEFAULT 0,
  sem_estoque             INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS pedidos_vitrine (
  id                            INTEGER PRIMARY KEY AUTOINCREMENT,
  farmacia_id                   INTEGER NOT NULL REFERENCES farmacias(id) ON DELETE CASCADE,
  codigo_pedido                 TEXT NOT NULL UNIQUE,
  chave_idempotencia            TEXT UNIQUE,
  cliente_id                    INTEGER REFERENCES clientes(id),
  cliente_nome                  TEXT NOT NULL,
  cliente_whatsapp              TEXT NOT NULL,
  endereco_entrega              TEXT NOT NULL DEFAULT 'Retirada no Balcão da Loja',
  cep                           TEXT,
  forma_pagamento               TEXT NOT NULL CHECK (forma_pagamento IN ('PIX_DIRETO','CARTAO_RETIRADA','CARTAO_ENTREGA','DINHEIRO')),
  troco_para_centavos           INTEGER,
  subtotal_centavos             INTEGER NOT NULL,
  taxa_entrega_centavos         INTEGER NOT NULL DEFAULT 0,
  cashback_usado_centavos       INTEGER NOT NULL DEFAULT 0,
  cashback_gerado_centavos      INTEGER NOT NULL DEFAULT 0,
  total_centavos                INTEGER NOT NULL,
  economia_mkt_centavos         INTEGER NOT NULL DEFAULT 0,
  itens_json                    TEXT NOT NULL,
  status_pedido                 TEXT NOT NULL DEFAULT 'NOVO' CHECK (status_pedido IN ('AGUARDANDO_VALIDACAO_RT','NOVO','SEPARANDO','PRONTO_RETIRADA','SAIU_ENTREGA','CONCLUIDO','CANCELADO','DEVOLVIDO')),
  link_avaliacao_enviado        INTEGER NOT NULL DEFAULT 0,
  origem                        TEXT NOT NULL CHECK (origem IN ('VITRINE_DIGITAL','RECOMPRA_USO_CONTINUO')),
  tratamento_id                 INTEGER REFERENCES tratamentos_continuos(id),
  validado_por_rt_id            INTEGER REFERENCES usuarios(id),
  criado_em                     TEXT NOT NULL DEFAULT (datetime('now', '-3 hours'))
);

CREATE TABLE IF NOT EXISTS movimentacoes_cashback (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  farmacia_id    INTEGER NOT NULL REFERENCES farmacias(id) ON DELETE CASCADE,
  cliente_id     INTEGER NOT NULL REFERENCES clientes(id),
  pedido_id      INTEGER REFERENCES pedidos_vitrine(id),
  tipo           TEXT NOT NULL CHECK (tipo IN ('CREDITO','RESGATE','ESTORNO')),
  valor_centavos INTEGER NOT NULL CHECK (valor_centavos > 0),
  validade_em    TEXT,
  criado_em      TEXT NOT NULL DEFAULT (datetime('now', '-3 hours')),
  UNIQUE (pedido_id, tipo)
);

CREATE TABLE IF NOT EXISTS checklists_anvisa (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  farmacia_id             INTEGER NOT NULL REFERENCES farmacias(id) ON DELETE CASCADE,
  tipo_pop                TEXT NOT NULL CHECK (tipo_pop IN ('TEMPERATURA_GELADEIRA','TEMPERATURA_AMBIENTE','UMIDADE_AMBIENTE','LIMPEZA_SALA_INJETAVEIS','CONFERENCIA_ARMARIO_CONTROLADOS')),
  valor_medido            REAL,
  dentro_conformidade     INTEGER NOT NULL,
  observacao              TEXT,
  assinado_por_usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
  hash_integridade        TEXT NOT NULL,
  carimbo_data_hora       TEXT NOT NULL DEFAULT (datetime('now', '-3 hours'))
);

CREATE TABLE IF NOT EXISTS fila_whatsapp (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  farmacia_id           INTEGER NOT NULL REFERENCES farmacias(id) ON DELETE CASCADE,
  chave_idempotencia    TEXT NOT NULL UNIQUE,
  modo_envio            TEXT NOT NULL CHECK (modo_envio IN ('SEGURO_1_CLIQUE','META_CLOUD_API')),
  tipo_disparo          TEXT NOT NULL CHECK (tipo_disparo IN ('USO_CONTINUO','ORCAMENTO_IA','POS_VENDA_EXPERIENCIA')),
  destinatario_whatsapp TEXT NOT NULL,
  mensagem_texto        TEXT NOT NULL,
  link_wa_me            TEXT,
  status_fila           TEXT NOT NULL DEFAULT 'PENDENTE' CHECK (status_fila IN ('PENDENTE','PROCESSANDO','AGUARDANDO_CLIQUE','ENVIADO','FALHA_RETRY','DLQ_ERRO_PERMANENTE')),
  tentativas            INTEGER NOT NULL DEFAULT 0,
  ultimo_erro           TEXT,
  proxima_tentativa_em  TEXT,
  atualizado_em         TEXT NOT NULL DEFAULT (datetime('now', '-3 hours')),
  criado_em             TEXT NOT NULL DEFAULT (datetime('now', '-3 hours'))
);

CREATE TABLE IF NOT EXISTS execucoes_idempotentes (
  chave     TEXT PRIMARY KEY,
  criado_em TEXT NOT NULL DEFAULT (datetime('now', '-3 hours'))
);

CREATE TABLE IF NOT EXISTS logs_auditoria (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  farmacia_id     INTEGER,
  usuario_id      INTEGER,
  acao            TEXT NOT NULL,
  recurso_afetado TEXT,
  ip_origem       TEXT,
  correlation_id  TEXT,
  criado_em       TEXT NOT NULL DEFAULT (datetime('now', '-3 hours'))
);

-- =====================================================================
-- TRIGGERS APPEND-ONLY (Impedem UPDATE e DELETE em Auditoria e POPs)
-- =====================================================================
CREATE TRIGGER IF NOT EXISTS trg_logs_auditoria_no_update
BEFORE UPDATE ON logs_auditoria
BEGIN
  SELECT RAISE(ABORT, 'Violacao de integridade: logs_auditoria e append-only (UPDATE proibido).');
END;

CREATE TRIGGER IF NOT EXISTS trg_logs_auditoria_no_delete
BEFORE DELETE ON logs_auditoria
BEGIN
  SELECT RAISE(ABORT, 'Violacao de integridade: logs_auditoria e append-only (DELETE proibido).');
END;

CREATE TRIGGER IF NOT EXISTS trg_checklists_anvisa_no_update
BEFORE UPDATE ON checklists_anvisa
BEGIN
  SELECT RAISE(ABORT, 'Violacao de integridade: checklists_anvisa assinados nao podem ser alterados.');
END;

CREATE TRIGGER IF NOT EXISTS trg_checklists_anvisa_no_delete
BEFORE DELETE ON checklists_anvisa
BEGIN
  SELECT RAISE(ABORT, 'Violacao de integridade: checklists_anvisa assinados nao podem ser excluidos.');
END;

-- Índices estratégicos
CREATE INDEX IF NOT EXISTS idx_trat_disparo   ON tratamentos_continuos (farmacia_id, status_recompra, data_disparo_whatsapp);
CREATE INDEX IF NOT EXISTS idx_lotes_validade ON lotes_estoque (farmacia_id, produto_id, data_validade);
CREATE INDEX IF NOT EXISTS idx_pedidos_status ON pedidos_vitrine (farmacia_id, status_pedido, criado_em);
CREATE INDEX IF NOT EXISTS idx_orc_status     ON orcamentos_receita (farmacia_id, status_triagem);
CREATE INDEX IF NOT EXISTS idx_fila_status    ON fila_whatsapp (status_fila, proxima_tentativa_em);
CREATE INDEX IF NOT EXISTS idx_prod_vitrine   ON produtos (farmacia_id, exibir_na_vitrine, categoria);
CREATE INDEX IF NOT EXISTS idx_logs_farmacia  ON logs_auditoria (farmacia_id, criado_em);
