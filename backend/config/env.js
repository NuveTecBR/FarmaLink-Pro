// Validação estrita de variáveis de ambiente no boot — FarmaLink Pro v3.1
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const envPath = path.join(__dirname, "..", ".env");
if (fs.existsSync(envPath)) {
  for (const linha of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = linha.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}

process.env.TZ = "America/Sao_Paulo";

const NODE_ENV = process.env.NODE_ENV || "development";
const isProd = NODE_ENV === "production";

let JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  if (isProd) {
    console.error("[FATAL] JWT_SECRET ausente ou com menos de 32 caracteres em produção.");
    process.exit(1);
  }
  JWT_SECRET = crypto.createHash("sha256").update("farmalink-dev-default-key").digest("hex");
}

const DEMO_MODE = process.env.DEMO_MODE !== undefined
  ? process.env.DEMO_MODE === "true"
  : !isProd;

// P1-1: Recusa terminantemente iniciar em produção com DEMO_MODE=true
if (isProd && DEMO_MODE) {
  console.error("[FATAL] DEMO_MODE=true é estritamente proibido com NODE_ENV=production. Abortando inicialização.");
  process.exit(1);
}

export const env = Object.freeze({
  NODE_ENV,
  isProd,
  PORT: Number(process.env.PORT || 3000),
  JWT_SECRET,
  DEMO_MODE,
  DB_PATH: process.env.DB_PATH || path.join(__dirname, "..", "database", "farmalink.sqlite"),
  STORAGE_DIR: process.env.STORAGE_DIR || path.join(__dirname, "..", "storage"),
  GEMINI_API_KEY: process.env.GEMINI_API_KEY || "",
  GEMINI_MODEL: process.env.GEMINI_MODEL || "gemini-2.5-flash",
  META_WA_TOKEN: process.env.META_WA_TOKEN || "",
  META_WA_PHONE_ID: process.env.META_WA_PHONE_ID || "",
  PUBLIC_BASE_URL: process.env.PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 3000}`,
});
