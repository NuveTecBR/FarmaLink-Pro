// Entrypoint HTTP — FarmaLink Pro v3.2 (Showroom Edition — Farmácias Associadas)
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { env } from "./config/env.js";
import { abrirBanco, fecharBanco, get } from "./database/conexao.js";
import { bancoVazio, popularSeeds } from "./database/seed.js";
import { correlationId, headersSeguranca, tratarErros } from "./middlewares/seguranca.js";
import { apiRouter } from "./routes/apiRoutes.js";
import { executarCicloWorker } from "./workers/cronWorker.js";
import { log } from "./utils/comum.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = path.join(__dirname, "..", "frontend");

export function criarApp() {
  abrirBanco();

  // Trava 1 de Produção: NUNCA popular seeds de demonstração em NODE_ENV=production
  if (bancoVazio()) {
    if (env.isProd || !env.DEMO_MODE) {
      if (env.isProd) {
        console.error("[FATAL] Banco SQLite vazio em NODE_ENV=production. Seeds de demonstração não podem ser aplicados em produção.");
        process.exit(1);
      }
    } else {
      const info = popularSeeds();
      log("info", "Banco SQLite inicializado com seeds de demonstração", info);
    }
  }

  // Trava 2 de Produção: Recusar boot se o banco contiver contas ou tokens de demonstração (*.demo) com NODE_ENV=production
  if (env.isProd) {
    const contaDemo = get("SELECT COUNT(*) AS n FROM usuarios WHERE email LIKE '%.demo'")?.n || 0;
    if (contaDemo > 0) {
      console.error("[FATAL] Detectadas contas de demonstração (*.demo) no banco com NODE_ENV=production. Inicialização bloqueada.");
      process.exit(1);
    }
  }

  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);

  app.use(correlationId);
  app.use(headersSeguranca);
  app.use(express.json({ limit: "6mb" }));

  app.use("/api", apiRouter);
  app.use(express.static(FRONTEND_DIR, { extensions: ["html"] }));

  app.use("/api", (_req, res) => {
    res.status(404).json({ erro: "Rota de API não encontrada." });
  });

  app.use(tratarErros);
  return app;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const app = criarApp();
  executarCicloWorker().catch((e) => log("error", "Erro no ciclo inicial do worker", { erro: e.message }));
  const timerWorker = setInterval(() => {
    executarCicloWorker().catch((e) => log("error", "Erro no worker periódico", { erro: e.message }));
  }, 60_000).unref();

  const srv = app.listen(env.PORT, () => {
    log("info", `FarmaLink Pro v3.2 ativo em http://localhost:${env.PORT}`, {
      demo_mode: env.DEMO_MODE,
      timezone: process.env.TZ,
    });
  });

  const encerrar = (sinal) => {
    log("info", `Recebido ${sinal} — encerrando servidor com segurança...`);
    clearInterval(timerWorker);
    srv.close(() => {
      fecharBanco();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 5000).unref();
  };
  process.on("SIGINT", () => encerrar("SIGINT"));
  process.on("SIGTERM", () => encerrar("SIGTERM"));
}
