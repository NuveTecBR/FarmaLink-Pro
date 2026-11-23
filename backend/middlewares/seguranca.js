// Middlewares de segurança: JWT com JTI revogável no banco, Anti-CSRF, RBAC, Feature Flags, Rate Limit e CSP sem unsafe-inline
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { env } from "../config/env.js";
import { get, run } from "../database/conexao.js";
import { agoraSP, HttpError, log, somarMinutosSP } from "../utils/comum.js";

export const COOKIE_SESSAO = "fl_session";

function lerCookies(req) {
  const out = {};
  for (const par of (req.headers.cookie || "").split(";")) {
    const i = par.indexOf("=");
    if (i > 0) out[par.slice(0, i).trim()] = decodeURIComponent(par.slice(i + 1).trim());
  }
  return out;
}

export function emitirSessao(res, usuario) {
  const jti = crypto.randomUUID();
  run(
    "INSERT INTO sessoes_ativas (jti, usuario_id, expira_em, criado_em) VALUES (?, ?, ?, ?)",
    jti,
    usuario.id,
    somarMinutosSP(12 * 60),
    agoraSP()
  );
  const token = jwt.sign({ sub: usuario.id, fid: usuario.farmacia_id, jti }, env.JWT_SECRET, { expiresIn: "12h" });
  res.cookie(COOKIE_SESSAO, token, {
    httpOnly: true,
    secure: env.isProd,
    sameSite: "strict",
    maxAge: 12 * 60 * 60 * 1000,
    path: "/",
  });
  return jti;
}

export function encerrarSessao(req, res) {
  const token = lerCookies(req)[COOKIE_SESSAO];
  if (token) {
    try {
      const payload = jwt.verify(token, env.JWT_SECRET, { ignoreExpiration: true });
      if (payload?.jti) {
        run("UPDATE sessoes_ativas SET revogada = 1 WHERE jti = ?", payload.jti);
      }
    } catch { /* token inválido ignorado */ }
  }
  res.clearCookie(COOKIE_SESSAO, { path: "/" });
}

export function exigirAuth(req, _res, next) {
  const token = lerCookies(req)[COOKIE_SESSAO];
  if (!token) throw new HttpError(401, "Sessão ausente. Faça login novamente.");
  let payload;
  try {
    payload = jwt.verify(token, env.JWT_SECRET);
  } catch {
    throw new HttpError(401, "Sessão expirada ou inválida.");
  }

  if (payload.jti) {
    const sessao = get("SELECT revogada FROM sessoes_ativas WHERE jti = ?", payload.jti);
    if (!sessao || sessao.revogada === 1) {
      throw new HttpError(401, "Sessão revogada. Faça login novamente.");
    }
  }

  const u = get(
    `SELECT u.id, u.farmacia_id, u.nome, u.email, u.cargo, u.crf_uf, u.tema_preferido, u.sidebar_pinned, u.totp_habilitado,
            f.plano_ativo, f.modo_whatsapp, f.nome_fantasia, f.slug
       FROM usuarios u JOIN farmacias f ON f.id = u.farmacia_id
      WHERE u.id = ? AND u.ativo = 1`,
    payload.sub
  );
  if (!u || u.farmacia_id !== payload.fid) throw new HttpError(401, "Usuário inativo ou sessão inválida.");
  req.usuario = u;
  req.jti = payload.jti;

  // Proteção Anti-CSRF adicional em rotas autenticadas de escrita
  if (["POST", "PATCH", "PUT", "DELETE"].includes(req.method)) {
    const xrw = req.get("X-Requested-With");
    const ct = req.get("Content-Type") || "";
    if (xrw !== "FarmaLinkHttpRequest" && !ct.includes("application/json")) {
      throw new HttpError(403, "Requisição bloqueada pela proteção Anti-CSRF.");
    }
  }

  next();
}

export const exigirCargo = (...cargos) => (req, _res, next) => {
  if (!cargos.includes(req.usuario?.cargo)) {
    throw new HttpError(403, `Ação restrita aos cargos: ${cargos.join(", ")}. Seu perfil atual é ${req.usuario?.cargo}.`);
  }
  next();
};

const RECURSOS_POR_PLANO = {
  ESSENCIAL: ["dashboard", "uso_continuo", "vitrine", "radar_validade"],
  PRO_IA: ["dashboard", "uso_continuo", "vitrine", "radar_validade", "triagem_ia", "hub_anvisa", "whatsapp_api", "cadastro_ia"],
};
export const recursosDoPlano = (plano) => RECURSOS_POR_PLANO[plano] || RECURSOS_POR_PLANO.ESSENCIAL;

export const exigirRecurso = (recurso) => (req, _res, next) => {
  if (!recursosDoPlano(req.usuario.plano_ativo).includes(recurso)) {
    throw new HttpError(402, "Este módulo é exclusivo do Plano Pro IA. Ative o upgrade para liberar.");
  }
  next();
};

export function exigirDemoMode(_req, _res, next) {
  if (!env.DEMO_MODE || env.isProd) {
    throw new HttpError(403, "Modo de demonstração desativado neste servidor.");
  }
  next();
}

const janelas = new Map();
export const rateLimit = ({ janelaMs, max, chave = (req) => req.ip }) => (req, res, next) => {
  const k = `${req.route?.path || req.path}:${chave(req)}`;
  const agora = Date.now();
  const hits = (janelas.get(k) || []).filter((t) => agora - t < janelaMs);
  if (hits.length >= max) {
    const retry = Math.ceil((janelaMs - (agora - hits[0])) / 1000);
    res.setHeader("Retry-After", String(retry));
    throw new HttpError(429, `Muitas requisições seguidas. Aguarde ${retry}s.`);
  }
  hits.push(agora);
  janelas.set(k, hits);
  next();
};

setInterval(() => {
  const agora = Date.now();
  for (const [k, v] of janelas) if (!v.some((t) => agora - t < 3600000)) janelas.delete(k);
}, 600000).unref();

export function headersSeguranca(req, res, next) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  // Protege tokens na URL de recompra com no-referrer
  const isRecompra = req.path.includes("recompra");
  res.setHeader("Referrer-Policy", isRecompra ? "no-referrer" : "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(self), microphone=(), geolocation=()");
  // P1-9: CSP estrita SEM unsafe-inline em script-src nem em style-src
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
  );
  if (env.isProd) res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  next();
}

export function correlationId(req, res, next) {
  req.correlationId = crypto.randomUUID();
  res.setHeader("X-Correlation-Id", req.correlationId);
  next();
}

export function auditar(req, acao, recurso) {
  try {
    run(
      `INSERT INTO logs_auditoria (farmacia_id, usuario_id, acao, recurso_afetado, ip_origem, correlation_id, criado_em) VALUES (?,?,?,?,?,?,?)`,
      req.usuario?.farmacia_id ?? null,
      req.usuario?.id ?? null,
      acao,
      recurso ?? null,
      req.ip,
      req.correlationId,
      agoraSP()
    );
  } catch (e) {
    log("error", "Falha ao gravar auditoria", { erro: e.message });
  }
}

// eslint-disable-next-line no-unused-vars
export function tratarErros(err, req, res, _next) {
  if (err instanceof z.ZodError) {
    const listaErros = err.issues || err.errors || [];
    return res.status(400).json({
      erro: "Dados inválidos.",
      campos: listaErros.map((e) => ({ campo: (e.path || []).join("."), mensagem: e.message })),
      correlationId: req.correlationId,
    });
  }
  if (err?.type === "entity.too.large") {
    return res.status(413).json({ erro: "Arquivo excede o limite de 6 MB.", correlationId: req.correlationId });
  }
  if (err?.type === "entity.parse.failed") {
    return res.status(400).json({ erro: "JSON malformado.", correlationId: req.correlationId });
  }
  const status = err instanceof HttpError ? err.status : 500;
  if (status >= 500) {
    log("error", "Erro interno não tratado", { erro: err?.message, rota: req.originalUrl, correlationId: req.correlationId });
  }
  res.status(status).json({
    erro: status >= 500 ? "Erro interno no servidor. Tente novamente." : err.message,
    ...(err.detalhes ? { detalhes: err.detalhes } : {}),
    correlationId: req.correlationId,
  });
}
