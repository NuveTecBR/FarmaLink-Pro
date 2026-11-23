// Roteador Central REST (/api/v1/* + /api/health + /api/admin/self-heal + LGPD + Webhooks + ERP)
import fs from "node:fs";
import path from "node:path";
import express from "express";
import { z } from "zod";
import { env } from "../config/env.js";
import { abrirBanco, fecharBanco, get, snapshot } from "../database/conexao.js";
import { popularSeeds } from "../database/seed.js";
import {
  auditar,
  exigirAuth,
  exigirCargo,
  exigirDemoMode,
  exigirRecurso,
  rateLimit,
} from "../middlewares/seguranca.js";
import * as authCtrl from "../controllers/authController.js";
import * as dashCtrl from "../controllers/dashboardController.js";
import * as usoCtrl from "../controllers/usoContinuoController.js";
import * as vitrineCtrl from "../controllers/vitrineController.js";
import * as triagemCtrl from "../controllers/triagemIaController.js";
import * as radarCtrl from "../controllers/radarValidadeController.js";
import * as hubCtrl from "../controllers/hubOperacionalController.js";
import { processarInboundOptOut } from "../services/whatsappDispatcherService.js";
import { executarCicloWorker } from "../workers/cronWorker.js";

export const apiRouter = express.Router();

const rlLogin = rateLimit({ janelaMs: 60_000, max: 25 });
const rlPublicoEscrita = rateLimit({ janelaMs: 60_000, max: 35 });
const rlRecompra = rateLimit({ janelaMs: 60_000, max: 20 });
const rlIA = rateLimit({ janelaMs: 60_000, max: 30 });

apiRouter.get("/health", (_req, res) => {
  const ok = get("SELECT 1 AS ok")?.ok === 1;
  res.status(ok ? 200 : 503).json({
    status: ok ? "healthy" : "degraded",
    service: "farmalink-pro",
    version: "3.1.0",
    timezone: process.env.TZ,
    demo_mode: env.DEMO_MODE,
    timestamp: new Date().toISOString(),
  });
});

// Self-Heal / Reset da Demonstração (Bloqueado fora do DEMO_MODE para proteger dados reais em produção)
apiRouter.post("/admin/self-heal", exigirDemoMode, exigirAuth, exigirCargo("DIRETOR"), async (req, res) => {
  const snapPath = path.join(env.STORAGE_DIR, "backups", `pre-self-heal-${Date.now()}.sqlite`);
  try {
    snapshot(snapPath);
  } catch { /* continua se não for possível criar snapshot */ }
  fecharBanco();
  for (const suf of ["", "-wal", "-shm"]) {
    const f = env.DB_PATH + suf;
    if (fs.existsSync(f)) {
      try { fs.unlinkSync(f); } catch { /* noop */ }
    }
  }
  abrirBanco();
  popularSeeds();
  const worker = await executarCicloWorker();
  auditar(req, "SELF_HEAL_EXECUTADO", path.basename(snapPath));
  res.json({ ok: true, backup: path.basename(snapPath), worker });
});

// Rotas Públicas
apiRouter.get("/v1/public/config", authCtrl.configPublica);
apiRouter.post("/v1/auth/login", rlLogin, authCtrl.login);
apiRouter.post("/v1/auth/logout", authCtrl.logout);

// Webhook de entrada do WhatsApp para Opt-Out automático ("SAIR" / "PARAR")
apiRouter.post("/v1/webhooks/whatsapp-inbound", rlPublicoEscrita, (req, res) => {
  const { from, text } = z.object({ from: z.string().min(8).max(25), text: z.string().min(1).max(200) }).parse(req.body);
  res.json(processarInboundOptOut(from, text));
});

// Modo Apresentação (protegido por exigirDemoMode no servidor)
apiRouter.post("/v1/auth/demo-login", rlLogin, exigirDemoMode, authCtrl.demoLoginRapido);
apiRouter.post("/v1/auth/trocar-cargo-demo", exigirAuth, exigirDemoMode, authCtrl.demoTrocarCargo);
apiRouter.post("/v1/auth/alterar-plano-demo", exigirAuth, exigirDemoMode, authCtrl.demoAlterarPlano);

// Vitrine Digital Pública & Triagem de Receita Pública
apiRouter.get("/v1/public/vitrine", vitrineCtrl.catalogo);
apiRouter.post("/v1/public/pedidos", rlPublicoEscrita, vitrineCtrl.criarPedidoPublico);
apiRouter.post("/v1/public/receitas", rlPublicoEscrita, triagemCtrl.receberReceita);

// Recompra 1-Clique via Token Hasheado + Desafio dos 4 Últimos Dígitos do Telefone
apiRouter.get("/v1/public/recompra/:token", rlRecompra, usoCtrl.recompraVer);
apiRouter.post("/v1/public/recompra/:token/confirmar", rlRecompra, usoCtrl.recompraConfirmar);

// Rotas Autenticadas do Painel Operacional & Executivo
apiRouter.use("/v1", exigirAuth);

apiRouter.get("/v1/auth/me", authCtrl.me);
apiRouter.patch("/v1/auth/preferencias", authCtrl.salvarPreferencias);
apiRouter.post("/v1/auth/alterar-senha", authCtrl.alterarSenha);
apiRouter.get("/v1/usuarios", exigirCargo("DIRETOR"), authCtrl.listarUsuarios);
apiRouter.post("/v1/usuarios", exigirCargo("DIRETOR"), authCtrl.criarUsuario);

apiRouter.get("/v1/dashboard", dashCtrl.resumoExecutivo);

// Módulo A — Uso Contínuo
apiRouter.get("/v1/uso-continuo", usoCtrl.listar);
apiRouter.post("/v1/uso-continuo", usoCtrl.cadastrar);
apiRouter.post("/v1/uso-continuo/:id/disparar", usoCtrl.dispararUm);
apiRouter.post("/v1/uso-continuo/disparar-lote", usoCtrl.dispararLote);
apiRouter.post("/v1/uso-continuo/:id/cancelar", usoCtrl.cancelar);
apiRouter.post("/v1/whatsapp/fila/:filaId/confirmar-clique", usoCtrl.confirmarCliqueWhatsapp);

// Módulo B — Vitrine Interna, Pedidos e Cadastro IA
apiRouter.get("/v1/vitrine/pedidos", vitrineCtrl.pedidosListar);
apiRouter.patch("/v1/vitrine/pedidos/:id/status", vitrineCtrl.pedidoStatus);
apiRouter.get("/v1/vitrine/produtos", vitrineCtrl.produtosListar);
apiRouter.post("/v1/vitrine/produtos", exigirCargo("DIRETOR", "FARMACEUTICO"), vitrineCtrl.produtoCriar);
apiRouter.patch("/v1/vitrine/produtos/:id/classificar", exigirCargo("DIRETOR", "FARMACEUTICO"), vitrineCtrl.produtoClassificar);
apiRouter.post("/v1/vitrine/produtos/gerar-ia", rlIA, exigirRecurso("cadastro_ia"), vitrineCtrl.produtoGerarIA);

// Módulo C — Triagem de Receitas com IA
apiRouter.get("/v1/triagem-ia", exigirRecurso("triagem_ia"), triagemCtrl.listar);
apiRouter.get("/v1/triagem-ia/:id/imagem", exigirRecurso("triagem_ia"), exigirCargo("DIRETOR", "FARMACEUTICO"), triagemCtrl.imagem);
apiRouter.post("/v1/triagem-ia/:id/aprovar-enviar", exigirRecurso("triagem_ia"), exigirCargo("FARMACEUTICO"), triagemCtrl.aprovarEnviar);
apiRouter.patch("/v1/triagem-ia/:id/finalizar", exigirRecurso("triagem_ia"), triagemCtrl.finalizar);
apiRouter.post("/v1/triagem-ia/demo-simular", exigirDemoMode, exigirRecurso("triagem_ia"), triagemCtrl.demoSimular);

// Módulo D — Radar Anti-Vencimento (90 / 60 / 30 dias) + Importador XML NF-e
apiRouter.get("/v1/radar-validade", radarCtrl.listar);
apiRouter.post("/v1/radar-validade/lotes", exigirCargo("DIRETOR", "FARMACEUTICO"), radarCtrl.cadastrarLote);
apiRouter.post("/v1/radar-validade/importar-xml", exigirCargo("DIRETOR", "FARMACEUTICO"), radarCtrl.importarXmlNFe);
apiRouter.post("/v1/radar-validade/lotes/:id/acao", exigirCargo("DIRETOR", "FARMACEUTICO"), radarCtrl.ativarAcaoQueima);
apiRouter.post("/v1/radar-validade/lotes/:id/vender", radarCtrl.registrarVendaLote);

// Módulo E — Hub Operacional, POPs ANVISA, Metas, PDV Balcão, Auditoria, LGPD Art. 18 e Conector ERP
apiRouter.get("/v1/hub-operacional", exigirRecurso("hub_anvisa"), hubCtrl.listarHub);
apiRouter.post("/v1/hub-operacional/checklists", exigirRecurso("hub_anvisa"), hubCtrl.registrarChecklist);
apiRouter.patch("/v1/hub-operacional/config-farmacia", exigirCargo("DIRETOR"), hubCtrl.atualizarConfigFarmacia);
apiRouter.patch("/v1/hub-operacional/usuarios/:id/meta", exigirCargo("DIRETOR"), hubCtrl.atualizarMetaUsuario);
apiRouter.post("/v1/balcao/venda-rapida", hubCtrl.registrarVendaBalcaoRapida);
apiRouter.get("/v1/hub-operacional/auditoria", exigirCargo("DIRETOR"), hubCtrl.listarAuditoria);

// Direitos do Titular LGPD (Art. 18) e Sincronização de Estoque ERP
apiRouter.get("/v1/lgpd/titular/:whatsapp", exigirCargo("DIRETOR", "FARMACEUTICO"), hubCtrl.exportarDadosTitular);
apiRouter.post("/v1/lgpd/titular/anonimizar", exigirCargo("DIRETOR"), hubCtrl.anonimizarTitular);
apiRouter.post("/v1/integracoes/erp-sync", exigirCargo("DIRETOR", "FARMACEUTICO"), hubCtrl.sincronizarEstoqueErp);
