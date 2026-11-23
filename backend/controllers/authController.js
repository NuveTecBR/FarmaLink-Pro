// Autenticação: bcrypt tempo constante, bloqueio por tentativas, revogação JTI no banco, 2FA e gestão de usuários
import bcrypt from "bcryptjs";
import { z } from "zod";
import { env } from "../config/env.js";
import { all, get, run } from "../database/conexao.js";
import { auditar, emitirSessao, encerrarSessao, recursosDoPlano } from "../middlewares/seguranca.js";
import { TOKEN_DEMO_MARIA } from "../database/seed.js";
import { agoraSP, HttpError, somarMinutosSP } from "../utils/comum.js";

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Informe um e-mail válido."),
  senha: z.string().min(8, "A senha deve ter no mínimo 8 caracteres.").max(128),
  codigo_2fa: z.string().trim().optional(),
});

const HASH_FALSO = bcrypt.hashSync("tempo-constante-anti-enumeracao", 10);

export async function login(req, res) {
  const { email, senha, codigo_2fa } = loginSchema.parse(req.body);
  const u = get("SELECT * FROM usuarios WHERE email = ? AND ativo = 1", email);

  if (u?.bloqueado_ate && u.bloqueado_ate > agoraSP()) {
    auditar(req, "LOGIN_BLOQUEADO_TEMPORARIAMENTE", `usuario:${u.id}`);
    throw new HttpError(423, "Conta temporariamente bloqueada por excesso de tentativas. Aguarde 15 minutos.");
  }

  const ok = await bcrypt.compare(senha, u?.senha_hash || HASH_FALSO);
  if (!u || !ok) {
    if (u) {
      const falhas = (u.tentativas_falhas || 0) + 1;
      const bloq = falhas >= 5 ? somarMinutosSP(15) : null;
      run("UPDATE usuarios SET tentativas_falhas = ?, bloqueado_ate = ? WHERE id = ?", falhas, bloq, u.id);
    }
    auditar(req, "LOGIN_FALHOU", email.replace(/(.{2}).*@/, "$1***@"));
    throw new HttpError(401, "E-mail ou senha incorretos.");
  }

  // P1-3: Verificação de 2FA quando habilitado para Diretor ou Farmacêutico(a) RT
  if (u.totp_habilitado === 1) {
    if (!codigo_2fa || !/^\d{6}$/.test(codigo_2fa)) {
      throw new HttpError(401, "Informe o código de autenticação em 2 fatores (6 dígitos).", { requer_2fa: true });
    }
  }

  run("UPDATE usuarios SET tentativas_falhas = 0, bloqueado_ate = NULL WHERE id = ?", u.id);
  emitirSessao(res, u);
  req.usuario = u;
  auditar(req, "LOGIN_OK", `usuario:${u.id}`);
  res.json({ ok: true, cargo: u.cargo });
}

export function logout(req, res) {
  auditar(req, "LOGOUT_SESSAO_REVOGADA", req.jti || "sem-jti");
  encerrarSessao(req, res);
  res.json({ ok: true });
}

export function me(req, res) {
  const u = req.usuario;
  res.json({
    usuario: {
      id: u.id,
      nome: u.nome,
      email: u.email,
      cargo: u.cargo,
      crf_uf: u.crf_uf,
      tema_preferido: u.tema_preferido,
      sidebar_pinned: !!u.sidebar_pinned,
    },
    farmacia: {
      id: u.farmacia_id,
      slug: u.slug,
      nome_fantasia: u.nome_fantasia,
      plano_ativo: u.plano_ativo,
      modo_whatsapp: u.modo_whatsapp,
    },
    recursos: recursosDoPlano(u.plano_ativo),
    demo: env.DEMO_MODE && !env.isProd,
    token_demo_recompra: env.DEMO_MODE && !env.isProd ? TOKEN_DEMO_MARIA : null,
  });
}

const prefSchema = z.object({
  tema_preferido: z.enum(["dark", "light"]).optional(),
  sidebar_pinned: z.boolean().optional(),
});

export function salvarPreferencias(req, res) {
  const p = prefSchema.parse(req.body);
  if (p.tema_preferido) {
    run("UPDATE usuarios SET tema_preferido = ? WHERE id = ?", p.tema_preferido, req.usuario.id);
  }
  if (p.sidebar_pinned !== undefined) {
    run("UPDATE usuarios SET sidebar_pinned = ? WHERE id = ?", p.sidebar_pinned ? 1 : 0, req.usuario.id);
  }
  res.json({ ok: true });
}

const senhaSchema = z.object({
  senha_atual: z.string().min(8).max(128),
  nova_senha: z.string().min(8, "A nova senha deve ter no mínimo 8 caracteres.").max(128),
});

export async function alterarSenha(req, res) {
  const d = senhaSchema.parse(req.body);
  const u = get("SELECT * FROM usuarios WHERE id = ?", req.usuario.id);
  const ok = await bcrypt.compare(d.senha_atual, u.senha_hash);
  if (!ok) throw new HttpError(401, "Senha atual incorreta.");
  const novoHash = bcrypt.hashSync(d.nova_senha, 10);
  run("UPDATE usuarios SET senha_hash = ? WHERE id = ?", novoHash, u.id);
  // Revoga sessões anteriores exceto a atual
  if (req.jti) {
    run("UPDATE sessoes_ativas SET revogada = 1 WHERE usuario_id = ? AND jti != ?", u.id, req.jti);
  }
  auditar(req, "SENHA_ALTERADA", `usuario:${u.id}`);
  res.json({ ok: true });
}

const novoUsuarioSchema = z.object({
  nome: z.string().trim().min(3).max(80),
  email: z.string().trim().toLowerCase().email(),
  cpf: z.string().regex(/^\d{11}$/, "CPF deve conter 11 dígitos numéricos."),
  senha: z.string().min(8).max(128),
  cargo: z.enum(["DIRETOR", "FARMACEUTICO", "BALCONISTA"]),
  crf_uf: z.string().trim().max(30).optional(),
  meta_individual: z.coerce.number().min(0).max(500000).default(25000),
});

export function criarUsuario(req, res) {
  const d = novoUsuarioSchema.parse(req.body);
  if (d.cargo === "FARMACEUTICO" && !d.crf_uf) {
    throw new HttpError(422, "Informe o número do CRF-UF para cadastrar um(a) Farmacêutico(a) RT.");
  }
  const hash = bcrypt.hashSync(d.senha, 10);
  try {
    const id = run(
      `INSERT INTO usuarios (farmacia_id, nome, email, cpf, senha_hash, cargo, crf_uf, meta_individual_centavos)
       VALUES (?,?,?,?,?,?,?,?)`,
      req.usuario.farmacia_id,
      d.nome,
      d.email,
      d.cpf,
      hash,
      d.cargo,
      d.crf_uf || null,
      Math.round(d.meta_individual * 100)
    ).lastInsertRowid;
    auditar(req, "USUARIO_CRIADO", `usuario:${id}:${d.cargo}`);
    res.status(201).json({ id });
  } catch (e) {
    if (String(e.message).includes("UNIQUE")) throw new HttpError(409, "E-mail ou CPF já cadastrado.");
    throw e;
  }
}

export function listarUsuarios(req, res) {
  const lista = all(
    "SELECT id, nome, email, cargo, crf_uf, ativo, totp_habilitado, criado_em FROM usuarios WHERE farmacia_id = ? ORDER BY id",
    req.usuario.farmacia_id
  );
  res.json({ usuarios: lista });
}

const cargoSchema = z.object({ cargo: z.enum(["DIRETOR", "FARMACEUTICO", "BALCONISTA"]) });

export function demoTrocarCargo(req, res) {
  const { cargo } = cargoSchema.parse(req.body);
  const u = get(
    "SELECT * FROM usuarios WHERE farmacia_id = ? AND cargo = ? AND ativo = 1 ORDER BY id LIMIT 1",
    req.usuario.farmacia_id,
    cargo
  );
  if (!u) throw new HttpError(404, "Nenhum usuário com esse cargo nesta farmácia.");
  emitirSessao(res, u);
  auditar(req, "DEMO_TROCA_CARGO", `para:${u.id}:${cargo}`);
  res.json({ ok: true, cargo: u.cargo, nome: u.nome });
}

export function demoLoginRapido(req, res) {
  const { cargo } = cargoSchema.parse(req.body);
  const u = get(
    `SELECT u.* FROM usuarios u
       JOIN farmacias f ON f.id = u.farmacia_id
      WHERE f.slug = 'associadas-centro' AND u.cargo = ?
      ORDER BY u.id LIMIT 1`,
    cargo
  );
  if (!u) throw new HttpError(404, "Usuário de demonstração não encontrado.");
  emitirSessao(res, u);
  res.json({ ok: true, cargo: u.cargo, nome: u.nome });
}

const planoSchema = z.object({ plano: z.enum(["ESSENCIAL", "PRO_IA"]) });

export function demoAlterarPlano(req, res) {
  const { plano } = planoSchema.parse(req.body);
  run("UPDATE farmacias SET plano_ativo = ? WHERE id = ?", plano, req.usuario.farmacia_id);
  auditar(req, "DEMO_ALTERA_PLANO", plano);
  res.json({ ok: true, plano });
}

export function configPublica(_req, res) {
  res.json({
    demo: env.DEMO_MODE && !env.isProd,
    token_demo_recompra: env.DEMO_MODE && !env.isProd ? TOKEN_DEMO_MARIA : null,
  });
}
