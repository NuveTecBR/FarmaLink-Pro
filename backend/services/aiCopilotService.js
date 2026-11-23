// Copiloto de IA — Conformidade LGPD Art. 11/33 e Intercambialidade Lei 9.787/99:
// - NUNCA envia fotos de receitas (que contêm nome/CPF/CRM) para APIs externas.
// - Extrai princípio ativo DCB, concentração (ex: 50mg) e forma farmacêutica (ex: COMPRIMIDO).
// - Gera descrições factuais de produtos sem alegações terapêuticas infundadas.
import { env } from "../config/env.js";
import { anonimizarTextoReceita, log } from "../utils/comum.js";

const TIMEOUT_MS = 18000;

async function chamarGeminiTextoSanitizado(textoAnonimizado, schemaHint) {
  if (!env.GEMINI_API_KEY || !textoAnonimizado) return null;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${env.GEMINI_MODEL}:generateContent`, {
      method: "POST",
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: textoAnonimizado }] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0.1 },
        systemInstruction: { parts: [{ text: schemaHint }] },
      }),
    });
    if (!r.ok) throw new Error(`Gemini HTTP ${r.status}`);
    const data = await r.json();
    const texto = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
    return JSON.parse(texto);
  } catch (e) {
    log("error", "Falha na IA externa — acionando motor determinístico local", { erro: e.message });
    return null;
  } finally {
    clearTimeout(t);
  }
}

// Sinônimos DCB (Denominação Comum Brasileira)
const SINONIMOS = {
  losartana: ["losartana", "losartan", "anti-hipertensivo losartana"],
  metformina: ["metformina", "cloridrato de metformina", "metformina xr"],
  rosuvastatina: ["rosuvastatina", "rosuvastatina calcica"],
  levotiroxina: ["levotiroxina", "levotiroxina sodica", "t4 50mcg"],
  anlodipino: ["anlodipino", "amlodipino", "besilato de anlodipino"],
  amoxicilina: ["amoxicilina", "amoxicilina tri-hidratada"],
  dipirona: ["dipirona", "dipirona monoidratada"],
};

const semAcento = (s) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

export function extrairConcentracao(linha) {
  const m = String(linha || "").match(/\b(\d+(?:[.,]\d+)?\s*(?:mg|mcg|g|ui|ml))\b/i);
  return m ? m[1].replace(/\s+/g, "").replace(",", ".").toLowerCase() : null;
}

export function extrairFormaFarmaceutica(linha) {
  const s = semAcento(String(linha || ""));
  if (/\bxr\b|liberacao prolongada/.test(s)) return "COMPRIMIDO_XR";
  if (/eferv/.test(s)) return "COMPRIMIDO_EFERVESCENTE";
  if (/caps/.test(s)) return "CAPSULA";
  if (/gotas|solucao|xarope/.test(s)) return "SOLUCAO_ORAL";
  if (/comp|cpr/.test(s)) return "COMPRIMIDO";
  return null;
}

export function extrairItensLocal(texto) {
  const limpo = anonimizarTextoReceita(texto);
  const itens = [];
  const linhas = semAcento(limpo || "")
    .split(/[\n;,]+/)
    .map((l) => l.trim())
    .filter(Boolean);
  for (const linha of linhas) {
    for (const [principio, nomes] of Object.entries(SINONIMOS)) {
      if (nomes.some((n) => linha.includes(n))) {
        const conc = extrairConcentracao(linha);
        const forma = extrairFormaFarmaceutica(linha);
        const chaveItem = `${principio}:${conc || ""}:${forma || ""}`;
        if (!itens.some((i) => `${i.principio_ativo}:${i.concentracao || ""}:${i.forma_farmaceutica || ""}` === chaveItem)) {
          const qtd = Number((linha.match(/(\d+)\s*(cx|caixa|caixas|un)/) || [])[1] || 1);
          itens.push({
            texto_original: linha,
            principio_ativo: principio,
            concentracao: conc,
            forma_farmaceutica: forma,
            quantidade: Math.min(qtd, 10),
          });
        }
      }
    }
  }
  return itens;
}

/**
 * Recebe APENAS o texto dos medicamentos. A imagem fica criptografada localmente
 * para revisão visual exclusiva do(a) Farmacêutico(a) RT e jamais sai do servidor.
 */
export async function lerReceita({ texto }) {
  const textoSanitizado = anonimizarTextoReceita(texto || "");
  if (!textoSanitizado) {
    return { motor: "revisao-visual-rt-local", itens: [] };
  }

  const instrucao =
    "Você é um assistente de triagem farmacêutica. Extraia SOMENTE os princípios ativos DCB prescritos, sua concentração e forma farmacêutica. " +
    'Responda JSON: {"itens":[{"texto_original":string,"principio_ativo":string (minúsculo, sem acento, DCB),"concentracao":string|null (ex: "50mg","500mg","50mcg"),"forma_farmaceutica":string|null (ex: "COMPRIMIDO","COMPRIMIDO_XR","CAPSULA"),"quantidade":number}]}.';

  const ia = await chamarGeminiTextoSanitizado(`Itens prescritos anonimizados: ${textoSanitizado}`, instrucao);
  if (ia?.itens?.length) {
    const itens = ia.itens
      .filter((i) => i && typeof i.principio_ativo === "string")
      .slice(0, 15)
      .map((i) => ({
        texto_original: String(i.texto_original || i.principio_ativo).slice(0, 120),
        principio_ativo: semAcento(i.principio_ativo).trim(),
        concentracao: i.concentracao ? String(i.concentracao).replace(/\s+/g, "").toLowerCase() : extrairConcentracao(i.texto_original),
        forma_farmaceutica: i.forma_farmaceutica ? String(i.forma_farmaceutica).toUpperCase() : extrairFormaFarmaceutica(i.texto_original),
        quantidade: Math.max(1, Math.min(10, Number(i.quantidade) || 1)),
      }));
    return { motor: `gemini-texto-anonimizado:${env.GEMINI_MODEL}`, itens };
  }
  return { motor: "copiloto-local-deterministico", itens: extrairItensLocal(textoSanitizado) };
}

const CATEGORIAS_PALAVRAS = [
  ["VITAMINAS", ["vit", "omega", "whey", "colageno", "suplement", "magnesio", "zinco"]],
  ["DERMOCOSMETICOS", ["fps", "protetor", "hidrat", "serum", "ceramid", "facial", "dermo", "locao"]],
  ["INFANTIL", ["fralda", "bebe", "infantil", "lenco", "mamadeira"]],
  ["PERFUMARIA", ["shampoo", "condicionador", "sabonete", "desodor", "creme dental", "escova", "perfume"]],
];

function titulo(s) {
  return s.toLowerCase().replace(/\b(\p{L})/gu, (m) => m.toUpperCase());
}

export function gerarProdutoLocal(nomeBruto) {
  const base = semAcento(nomeBruto);
  const cat = CATEGORIAS_PALAVRAS.find(([, ps]) => ps.some((p) => base.includes(p)))?.[0] || "CONVENIENCIA";
  const limpo = titulo(
    nomeBruto
      .replace(/\bC\/\s?/gi, "c/ ")
      .replace(/\bEFERV\b/gi, "Efervescente")
      .replace(/\bVIT\b/gi, "Vitamina")
      .replace(/\bPROT\b/gi, "Protetor")
      .replace(/\bCPR\b|\bCOMP\b/gi, "Comprimidos")
      .replace(/\bCAPS\b/gi, "Cápsulas")
      .replace(/\bUN\b/gi, "Unidades")
      .replace(/\s+/g, " ")
      .trim()
  ).replace(/\bC\/ /g, "c/ ");

  // Descrições 100% factuais sem alegações terapêuticas ou de saúde sem comprovação
  const complementoFactual = {
    VITAMINAS: "Suplemento alimentar para uso adulto conforme recomendação da embalagem.",
    DERMOCOSMETICOS: "Produto cosmético para cuidado e higiene da pele.",
    INFANTIL: "Item de higiene e cuidado infantil.",
    PERFUMARIA: "Item de higiene pessoal e perfumaria para uso diário.",
    CONVENIENCIA: "Item disponível para entrega pelo canal próprio da farmácia.",
  }[cat];

  const tags = [...new Set(base.split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !/^\d+$/.test(w)))].slice(0, 6);
  return {
    nome_comercial: limpo,
    categoria: cat,
    descricao_ia_seo: `${limpo}. ${complementoFactual}`,
    tags_busca_ia: tags.join(","),
  };
}

export async function gerarProduto(nomeBruto) {
  const instrucao =
    "Você padroniza nomes de produtos de farmácia a partir de notas fiscais (somente itens de venda livre, SEM fazer alegações de saúde, sem dizer hipoalergênico, biodisponibilidade ou imunidade). Responda JSON " +
    '{"nome_comercial":string,"categoria":"VITAMINAS|DERMOCOSMETICOS|INFANTIL|PERFUMARIA|CONVENIENCIA","descricao_ia_seo":string (factual, máx 200 caracteres),"tags_busca_ia":string}.';
  const ia = await chamarGeminiTextoSanitizado(`Produto da nota fiscal: ${nomeBruto}`, instrucao);
  const permitidas = ["VITAMINAS", "DERMOCOSMETICOS", "INFANTIL", "PERFUMARIA", "CONVENIENCIA"];
  if (ia?.nome_comercial && permitidas.includes(ia.categoria)) {
    return {
      motor: `gemini:${env.GEMINI_MODEL}`,
      nome_comercial: String(ia.nome_comercial).slice(0, 120),
      categoria: ia.categoria,
      descricao_ia_seo: String(ia.descricao_ia_seo || "").slice(0, 300),
      tags_busca_ia: String(ia.tags_busca_ia || "").slice(0, 200),
    };
  }
  return { motor: "copiloto-local-deterministico", ...gerarProdutoLocal(nomeBruto) };
}
