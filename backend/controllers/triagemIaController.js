// Módulo C — Triagem de Receitas com IA:
// - Imagem tem EXIF removido, é criptografada em repouso (AES-256-GCM) com cota de disco e NUNCA é enviada para IA externa.
// - Cruza Princípio Ativo + Concentração + Forma Farmacêutica + tipo_medicamento ('REFERENCIA' vs 'GENERICO').
// - Respeita trava "Médico proibiu substituição", informa itens sem estoque no orçamento e exige aprovação exclusiva de FARMACEUTICO RT.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { env } from "../config/env.js";
import { all, get, run, tx } from "../database/conexao.js";
import { auditar, recursosDoPlano } from "../middlewares/seguranca.js";
import { lerReceita } from "../services/aiCopilotService.js";
import { enfileirar } from "../services/whatsappDispatcherService.js";
import {
  agoraSP,
  anonimizarTextoReceita,
  criptografarBuffer,
  deCentavos,
  descriptografarBuffer,
  dinheiro,
  HttpError,
  hojeSP,
  log,
  normalizarWhatsapp,
  removerExifJpeg,
  somarDias,
} from "../utils/comum.js";
import { resolverFarmaciaPublica } from "./vitrineController.js";

const DIR_RECEITAS = path.join(env.STORAGE_DIR, "receitas");
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_ARQUIVOS_DISCO = 200;

function detectarImagem(buf) {
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: "image/jpeg", ext: "jpg" };
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: "image/png", ext: "png" };
  if (buf.subarray(0, 4).toString() === "RIFF" && buf.subarray(8, 12).toString() === "WEBP") return { mime: "image/webp", ext: "webp" };
  return null;
}

const receitaSchema = z
  .object({
    cliente_nome: z.string().trim().min(3, "Informe seu nome.").max(80),
    whatsapp: z
      .string()
      .trim()
      .refine((v) => /^\d{10,13}$/.test(v.replace(/\D/g, "")), "WhatsApp inválido (DDD + número)."),
    texto: z.string().trim().max(1000).optional(),
    imagem_base64: z.string().max(7_200_000).optional(),
    medico_proibiu_substituicao: z.boolean().default(false),
    consentimento_lgpd: z.literal(true, {
      message: "É obrigatório autorizar o tratamento dos dados de saúde para o orçamento (LGPD Art. 11).",
      errorMap: () => ({ message: "É obrigatório autorizar o tratamento dos dados de saúde para o orçamento (LGPD Art. 11)." }),
    }),
  })
  .refine((d) => d.texto || d.imagem_base64, {
    message: "Envie a foto da receita ou digite os medicamentos prescritos.",
    path: ["texto"],
  });

export async function receberReceita(req, res) {
  const f = resolverFarmaciaPublica(req);
  const d = receitaSchema.parse(req.body);

  let caminhoCriptografado = null;
  if (d.imagem_base64) {
    fs.mkdirSync(DIR_RECEITAS, { recursive: true });
    // Cota de disco para impedir esgotamento por uploads públicos
    const arquivosExistentes = fs.readdirSync(DIR_RECEITAS);
    if (arquivosExistentes.length >= MAX_ARQUIVOS_DISCO) {
      throw new HttpError(429, "Fila de armazenamento de receitas temporariamente cheia. Tente novamente em alguns minutos.");
    }

    const b64 = d.imagem_base64.replace(/^data:[^;]+;base64,/, "");
    const bufOriginal = Buffer.from(b64, "base64");
    if (bufOriginal.length > MAX_BYTES) throw new HttpError(413, "Imagem muito grande (máx. 5 MB).");
    const tipo = detectarImagem(bufOriginal);
    if (!tipo) throw new HttpError(415, "Formato não suportado. Envie JPG, PNG ou WEBP.");

    // Remove EXIF (GPS/câmera) e criptografa em repouso com AES-256-GCM
    const bufSemExif = tipo.ext === "jpg" ? removerExifJpeg(bufOriginal) : bufOriginal;
    const bufCifrado = criptografarBuffer(bufSemExif, env.JWT_SECRET);

    caminhoCriptografado = path.join(DIR_RECEITAS, `${crypto.randomUUID()}.${tipo.ext}.enc`);
    fs.writeFileSync(caminhoCriptografado, bufCifrado, { mode: 0o600 });
  }

  const temIA = recursosDoPlano(f.plano_ativo).includes("triagem_ia");
  const textoSanitizado = anonimizarTextoReceita(d.texto || "");
  // anonimizado_para_ia = 1 apenas quando houve texto sanitizado enviado ao motor de triagem (imagem nunca vai para IA)
  const flagAnonimizadoIa = textoSanitizado.length > 0 ? 1 : 0;
  const agora = agoraSP();
  const expiraImagem = `${somarDias(hojeSP(), 7)} ${agora.slice(11)}`;

  const id = run(
    `INSERT INTO orcamentos_receita
      (farmacia_id, cliente_nome, cliente_whatsapp, consentimento_lgpd_receita, medico_proibiu_substituicao, imagem_receita_path, imagem_expira_em, texto_informado, anonimizado_para_ia, status_triagem, motor_ia, criado_em)
     VALUES (?,?,?,1,?,?,?,?,?,?,?,?)`,
    f.id,
    d.cliente_nome,
    normalizarWhatsapp(d.whatsapp),
    d.medico_proibiu_substituicao ? 1 : 0,
    caminhoCriptografado,
    expiraImagem,
    textoSanitizado || null,
    flagAnonimizadoIa,
    temIA ? "AGUARDANDO_APROVACAO" : "REVISAO_MANUAL",
    temIA ? "processando" : "manual",
    agora
  ).lastInsertRowid;

  if (temIA) {
    // Se GEMINI_API_KEY estiver configurada, processa em background para não segurar a requisição pública por até 18s;
    // quando usa o motor determinístico local (< 5ms), conclui imediatamente.
    if (env.GEMINI_API_KEY) {
      setImmediate(() => {
        processarReceita(f.id, id, textoSanitizado, d.medico_proibiu_substituicao).catch((e) =>
          log("error", "Falha na triagem IA assíncrona", { orcamentoId: id, erro: e.message })
        );
      });
    } else {
      await processarReceita(f.id, id, textoSanitizado, d.medico_proibiu_substituicao);
    }
  }

  res.status(201).json({
    protocolo: `REC-${String(id).padStart(5, "0")}`,
    mensagem: "Receita recebida com segurança! Nosso(a) Farmacêutico(a) RT vai conferir e enviar o orçamento no seu WhatsApp.",
  });
}

/**
 * Cruza itens com o estoque exigindo:
 * - Mesmo princípio ativo DCB
 * - Mesma concentração (ex: 50mg não cruza com 100mg)
 * - Mesma forma farmacêutica quando especificada (ex: COMPRIMIDO_XR vs COMPRIMIDO)
 * - Separação explícita entre tipo_medicamento === 'REFERENCIA' e tipo_medicamento === 'GENERICO'
 */
export async function processarReceita(farmaciaId, orcamentoId, textoSanitizado, medicoProibiuSubstituicao = false) {
  const { motor, itens } = await lerReceita({ texto: textoSanitizado });
  tx(() => {
    let refCentavos = 0;
    let otimCentavos = 0;
    let margemCentavos = 0;
    let ganhoExtraMargemCentavos = 0;
    let semMatch = itens.length === 0;

    for (const it of itens) {
      const todosCandidatos = all(
        `SELECT *, (preco_venda_centavos - preco_custo_centavos) * 1.0 / NULLIF(preco_venda_centavos,0) AS margem
           FROM produtos
          WHERE farmacia_id = ? AND principio_ativo = ? AND pendente_classificacao = 0`,
        farmaciaId,
        it.principio_ativo
      );

      // Filtra por concentração exata (quando informada na prescrição) e forma farmacêutica compatível
      const compativeis = todosCandidatos.filter((p) => {
        if (it.concentracao && p.concentracao && p.concentracao.toLowerCase() !== it.concentracao.toLowerCase()) {
          return false;
        }
        if (it.forma_farmaceutica && p.forma_farmaceutica && p.forma_farmaceutica !== it.forma_farmaceutica) {
          return false;
        }
        return true;
      });

      const comEstoque = compativeis.filter((p) => p.estoque_total > 0);
      if (!comEstoque.length) {
        semMatch = true;
        run(
          "INSERT INTO itens_orcamento_ia (orcamento_id, item_prescrito_texto, quantidade, sem_estoque) VALUES (?,?,?,1)",
          orcamentoId,
          it.texto_original,
          it.quantidade
        );
        continue;
      }

      // Referência: prioriza produto explicitamente classificado como tipo_medicamento = 'REFERENCIA'
      const refs = comEstoque.filter((p) => p.tipo_medicamento === "REFERENCIA" || p.categoria === "REFERENCIA");
      const referencia = refs.length
        ? refs.reduce((a, b) => (b.preco_venda_centavos > a.preco_venda_centavos ? b : a))
        : comEstoque.reduce((a, b) => (b.preco_venda_centavos > a.preco_venda_centavos ? b : a));

      // Genérico intercambiável: se o médico proibiu substituição, mantém o referência;
      // caso contrário, busca entre os classificados como GENERICO o de MENOR PREÇO para o paciente
      const genericos = comEstoque.filter((p) => p.tipo_medicamento === "GENERICO" || p.categoria === "GENERICO_ALTA_MARGEM");
      const poolSugerido = genericos.length ? genericos : comEstoque;
      const sugerido = medicoProibiuSubstituicao
        ? referencia
        : poolSugerido.reduce((a, b) => (b.preco_venda_centavos < a.preco_venda_centavos ? b : a));

      run(
        `INSERT INTO itens_orcamento_ia
          (orcamento_id, item_prescrito_texto, produto_referencia_id, produto_sugerido_id, quantidade, preco_ref_centavos, preco_sugerido_centavos, margem_sugerido_pct, substituicao_bloqueada, sem_estoque)
         VALUES (?,?,?,?,?,?,?,?,?,0)`,
        orcamentoId,
        it.texto_original,
        referencia.id,
        sugerido.id,
        it.quantidade,
        referencia.preco_venda_centavos,
        sugerido.preco_venda_centavos,
        dinheiro(sugerido.margem * 100),
        medicoProibiuSubstituicao ? 1 : 0
      );

      const lucroRef = (referencia.preco_venda_centavos - referencia.preco_custo_centavos) * it.quantidade;
      const lucroSug = (sugerido.preco_venda_centavos - sugerido.preco_custo_centavos) * it.quantidade;

      refCentavos += referencia.preco_venda_centavos * it.quantidade;
      otimCentavos += sugerido.preco_venda_centavos * it.quantidade;
      margemCentavos += lucroSug;
      ganhoExtraMargemCentavos += Math.max(0, lucroSug - lucroRef);
    }

    run(
      `UPDATE orcamentos_receita
          SET motor_ia = ?, valor_ref_centavos = ?, valor_otimizado_centavos = ?, margem_ganha_centavos = ?, ganho_extra_margem_centavos = ?, status_triagem = ?
        WHERE id = ?`,
      motor,
      refCentavos,
      otimCentavos,
      margemCentavos,
      ganhoExtraMargemCentavos,
      semMatch ? "REVISAO_MANUAL" : "AGUARDANDO_APROVACAO",
      orcamentoId
    );
  });
}

export function listar(req, res) {
  const agora = agoraSP();
  const orcs = all(
    `SELECT o.id, o.cliente_nome, o.cliente_whatsapp, o.status_triagem, o.motor_ia, o.texto_informado,
            o.medico_proibiu_substituicao, o.valor_ref_centavos, o.valor_otimizado_centavos, o.margem_ganha_centavos,
            o.ganho_extra_margem_centavos, o.tempo_resposta_segundos, o.criado_em, o.anonimizado_para_ia,
            o.imagem_receita_path IS NOT NULL AS tem_imagem,
            MAX(0, CAST((julianday(?) - julianday(o.criado_em)) * 86400 AS INTEGER)) AS segundos_aguardando
       FROM orcamentos_receita o
      WHERE o.farmacia_id = ? AND o.status_triagem != 'DESCARTADO'
      ORDER BY o.id DESC LIMIT 50`,
    agora,
    req.usuario.farmacia_id
  );
  const itensPor = (id) =>
    all(
      `SELECT i.*, pr.nome_comercial AS referencia_nome, pr.laboratorio AS referencia_lab, pr.concentracao AS ref_concentracao,
              ps.nome_comercial AS sugerido_nome, ps.laboratorio AS sugerido_lab, ps.concentracao AS sug_concentracao
         FROM itens_orcamento_ia i
         LEFT JOIN produtos pr ON pr.id = i.produto_referencia_id
         LEFT JOIN produtos ps ON ps.id = i.produto_sugerido_id
        WHERE i.orcamento_id = ?`,
      id
    ).map((i) => ({
      ...i,
      preco_referencia: deCentavos(i.preco_ref_centavos),
      preco_sugerido: deCentavos(i.preco_sugerido_centavos),
    }));

  res.json({
    orcamentos: orcs.map((o) => ({
      ...o,
      protocolo: `REC-${String(o.id).padStart(5, "0")}`,
      valor_total_referencia: deCentavos(o.valor_ref_centavos),
      valor_total_otimizado_ia: deCentavos(o.valor_otimizado_centavos),
      margem_ganha_reais: deCentavos(o.margem_ganha_centavos),
      ganho_extra_margem_reais: deCentavos(o.ganho_extra_margem_centavos),
      economia_cliente: deCentavos(Math.max(0, o.valor_ref_centavos - o.valor_otimizado_centavos)),
      itens: itensPor(o.id),
    })),
  });
}

/** Descriptografa a imagem em memória somente para Farmacêutico(a) RT ou Diretor e audita cada visualização. */
export function imagem(req, res) {
  const o = get("SELECT imagem_receita_path FROM orcamentos_receita WHERE id = ? AND farmacia_id = ?", Number(req.params.id), req.usuario.farmacia_id);
  if (!o?.imagem_receita_path || !fs.existsSync(o.imagem_receita_path)) {
    throw new HttpError(404, "Imagem indisponível ou expirada pela política de retenção de 7 dias.");
  }
  if (!path.resolve(o.imagem_receita_path).startsWith(path.resolve(DIR_RECEITAS))) {
    throw new HttpError(403, "Acesso negado.");
  }
  auditar(req, "RECEITA_VISUALIZADA_CRIPTOGRAFADA", `orcamento:${req.params.id}`);
  const pacote = fs.readFileSync(o.imagem_receita_path);
  const claro = descriptografarBuffer(pacote, env.JWT_SECRET);
  const ext = o.imagem_receita_path.includes(".png") ? "image/png" : o.imagem_receita_path.includes(".webp") ? "image/webp" : "image/jpeg";
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Content-Type", ext);
  res.send(claro);
}

const brl = (v) => `R$ ${Number(v).toFixed(2).replace(".", ",")}`;

export function aprovarEnviar(req, res) {
  // Lei 13.021/2014 e Lei 9.787/1999: somente Farmacêutico(a) RT com CRF ativo pode assinar validação farmacêutica e intercambialidade
  if (req.usuario.cargo !== "FARMACEUTICO" || !req.usuario.crf_uf) {
    throw new HttpError(
      403,
      "A validação técnica de receita médica e intercambialidade de genéricos é ato privativo do(a) Farmacêutico(a) RT com CRF ativo (Lei 13.021/2014)."
    );
  }

  const farmacia = get("SELECT * FROM farmacias WHERE id = ?", req.usuario.farmacia_id);
  const o = get("SELECT * FROM orcamentos_receita WHERE id = ? AND farmacia_id = ?", Number(req.params.id), farmacia.id);
  if (!o) throw new HttpError(404, "Orçamento não encontrado.");
  if (!["AGUARDANDO_APROVACAO", "REVISAO_MANUAL", "ENVIADO_WHATSAPP"].includes(o.status_triagem)) {
    throw new HttpError(409, "Orçamento já finalizado.");
  }
  const itens = all(
    `SELECT i.*, pr.nome_comercial AS ref_nome, ps.nome_comercial AS sug_nome
       FROM itens_orcamento_ia i
       LEFT JOIN produtos pr ON pr.id = i.produto_referencia_id
       LEFT JOIN produtos ps ON ps.id = i.produto_sugerido_id
      WHERE i.orcamento_id = ?`,
    o.id
  );
  const validos = itens.filter((i) => i.produto_sugerido_id);
  const indisponiveis = itens.filter((i) => !i.produto_sugerido_id || i.sem_estoque);
  if (!validos.length) throw new HttpError(422, "Nenhum item com correspondência em estoque.");

  const linhas = validos.map((i) => {
    const pRef = deCentavos(i.preco_ref_centavos * i.quantidade);
    const pSug = deCentavos(i.preco_sugerido_centavos * i.quantidade);
    return i.produto_referencia_id === i.produto_sugerido_id || i.substituicao_bloqueada
      ? `• ${i.quantidade}x ${i.sug_nome}: *${brl(pSug)}*`
      : `• ${i.quantidade}x ${i.ref_nome}: ${brl(pRef)}\n   ↳ 💡 *Genérico Intercambiável (Lei 9.787/99):* ${i.sug_nome} por *${brl(pSug)}*`;
  });

  // Informa explicitamente ao paciente se algum item da receita estava sem estoque na loja
  const avisoSemEstoque = indisponiveis.length
    ? `\n\n⚠️ *Itens indisponíveis em estoque no momento:*\n` +
      indisponiveis.map((i) => `• ${i.quantidade}x ${i.item_prescrito_texto} _(sob encomenda ou indisponível)_`).join("\n")
    : "";

  const totRef = deCentavos(o.valor_ref_centavos);
  const totOtim = deCentavos(o.valor_otimizado_centavos);
  const economia = Math.max(0, totRef - totOtim);
  const texto =
    `Olá, ${o.cliente_nome.split(" ")[0]}! Segue o orçamento farmacêutico da sua receita (*REC-${String(o.id).padStart(5, "0")}*) — *${farmacia.nome_fantasia}* ⚕️:\n\n` +
    linhas.join("\n\n") +
    avisoSemEstoque +
    `\n\n💰 *Total Referência (itens disponíveis):* ${brl(totRef)}` +
    (o.medico_proibiu_substituicao
      ? `\n🔒 *Observação Médica:* Prescrição com restrição de substituição respeitada integralmente.`
      : `\n✅ *Total com Genéricos Intercambiáveis:* *${brl(totOtim)}* (Economia de ${brl(economia)} para você!)`) +
    `\n\nConferido por Farmacêutico(a) RT: *${req.usuario.nome}* (${req.usuario.crf_uf}).` +
    `\n_A receita original válida deve ser apresentada no ato da dispensação._`;

  const fila = enfileirar({
    farmacia,
    chave: `orcamento:${o.id}`,
    tipo: "ORCAMENTO_IA",
    telefone: o.cliente_whatsapp,
    texto,
  });
  const agora = agoraSP();
  run(
    `UPDATE orcamentos_receita SET status_triagem='ENVIADO_WHATSAPP', atendido_por_usuario_id=?,
       tempo_resposta_segundos = COALESCE(tempo_resposta_segundos, MAX(1, CAST((julianday(?) - julianday(criado_em)) * 86400 AS INTEGER)))
     WHERE id = ?`,
    req.usuario.id,
    agora,
    o.id
  );
  auditar(req, "ORCAMENTO_APROVADO_RT", `orcamento:${o.id}`);
  res.json({
    cliente: o.cliente_nome,
    telefone: o.cliente_whatsapp,
    protocolo: `REC-${String(o.id).padStart(5, "0")}`,
    link_wa_me: fila.link_wa_me,
    modo: fila.modo_envio,
    fila_id: fila.id,
    mensagem: texto,
    itens_sem_estoque: indisponiveis.map((i) => i.item_prescrito_texto),
  });
}

export function finalizar(req, res) {
  const { status } = z.object({ status: z.enum(["CONVERTIDO_EM_VENDA", "DESCARTADO"]) }).parse(req.body);
  const r = run(
    "UPDATE orcamentos_receita SET status_triagem = ? WHERE id = ? AND farmacia_id = ?",
    status,
    Number(req.params.id),
    req.usuario.farmacia_id
  );
  if (!r.changes) throw new HttpError(404, "Orçamento não encontrado.");
  auditar(req, "ORCAMENTO_FINALIZADO", `orcamento:${req.params.id}:${status}`);
  res.json({ ok: true });
}

const EXEMPLOS_RECEITA = [
  {
    nome: "Sr. Joaquim Albuquerque",
    whats: "5541991110099",
    texto: "1) Losartana 50mg — 2 caixas (uso contínuo)\n2) Rosuvastatina 10mg — 1 caixa\n3) Anlodipino 5mg — 1 caixa",
    proibiu: false,
  },
  {
    nome: "Dona Tereza Cavalcanti",
    whats: "5541991110088",
    texto: "1) Metformina XR 500mg — 3 caixas\n2) Levotiroxina 50mcg — 1 caixa\n3) Losartana 50mg — 1 caixa",
    proibiu: false,
  },
];
let indiceDemo = 0;

export async function demoSimular(req, res) {
  const ex = EXEMPLOS_RECEITA[indiceDemo % EXEMPLOS_RECEITA.length];
  indiceDemo++;
  const id = run(
    `INSERT INTO orcamentos_receita (farmacia_id, cliente_nome, cliente_whatsapp, consentimento_lgpd_receita, medico_proibiu_substituicao, texto_informado, motor_ia, criado_em)
     VALUES (?,?,?,1,?,?, 'processando', ?)`,
    req.usuario.farmacia_id,
    ex.nome,
    ex.whats,
    ex.proibiu ? 1 : 0,
    ex.texto,
    agoraSP()
  ).lastInsertRowid;
  await processarReceita(req.usuario.farmacia_id, id, ex.texto, ex.proibiu);
  res.status(201).json({ id, protocolo: `REC-${String(id).padStart(5, "0")}` });
}
