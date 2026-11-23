// Parser resiliente de NF-e (XML de entrada da distribuidora) — Anti-XXE, limite de tamanho, chNFe e múltiplos <rastro>
import { hashSha256 } from "../utils/comum.js";

const MAX_XML_LENGTH = 1_500_000;

const tag = (bloco, nome) => {
  const m = bloco.match(new RegExp(`<${nome}>([\\s\\S]*?)</${nome}>`, "i"));
  return m ? m[1].trim() : null;
};

export function parseNFe(xml) {
  if (typeof xml !== "string" || xml.length > MAX_XML_LENGTH) {
    throw new Error("XML ausente ou excede o tamanho máximo permitido (1,5 MB).");
  }
  if (/<!DOCTYPE|<!ENTITY|SYSTEM\s+["']|PUBLIC\s+["']/i.test(xml)) {
    throw new Error("XML com DOCTYPE/ENTITY externas rejeitado por segurança (Proteção Anti-XXE).");
  }
  if (!/<infNFe|<det/i.test(xml)) {
    throw new Error("Arquivo não parece ser uma NF-e válida.");
  }

  const numero = tag(xml, "nNF");
  const chNFeMatch = xml.match(/Id=["']NFe(\d{44})["']/i) || xml.match(/<chNFe>(\d{44})<\/chNFe>/i);
  // Mesmo que o XML simplificado não traga chNFe nem nNF, gera chave determinística SHA-256 para impedir duplicação
  const chaveAcesso = chNFeMatch
    ? chNFeMatch[1]
    : numero
      ? `NFE-NUM-${numero}`
      : `NFE-HASH-${hashSha256(xml.replace(/\s+/g, " ").trim()).slice(0, 32)}`;

  const itens = [];
  for (const det of xml.match(/<det[\s>][\s\S]*?<\/det>/gi) || []) {
    const prod = tag(det, "prod") || det;
    const ean = tag(prod, "cEAN");
    const codigo = tag(prod, "cProd");
    const descricao = (tag(prod, "xProd") || "").slice(0, 120);
    const qtdTotal = Math.max(0, Math.round(Number(tag(prod, "qCom") || 0)));
    const valorUnit = Number(tag(prod, "vUnCom") || 0);

    // Suporta múltiplos blocos <rastro> dentro do mesmo <det>
    const rastros = det.match(/<rastro[\s>][\s\S]*?<\/rastro>/gi) || [];
    if (rastros.length > 0) {
      for (const rBloco of rastros) {
        const qtdLote = Math.max(1, Math.round(Number(tag(rBloco, "qLote") || qtdTotal / rastros.length || 1)));
        itens.push({
          codigo,
          ean: ean && /^\d{8,14}$/.test(ean) ? ean : null,
          descricao,
          quantidade: qtdLote,
          valor_unitario: valorUnit,
          lote: tag(rBloco, "nLote"),
          validade: (tag(rBloco, "dVal") || "").slice(0, 10) || null,
        });
      }
    } else if (descricao && qtdTotal > 0) {
      itens.push({
        codigo,
        ean: ean && /^\d{8,14}$/.test(ean) ? ean : null,
        descricao,
        quantidade: qtdTotal,
        valor_unitario: valorUnit,
        lote: tag(det, "nLote"),
        validade: (tag(det, "dVal") || "").slice(0, 10) || null,
      });
    }
  }

  if (!itens.length) throw new Error("Nenhum item válido encontrado na NF-e.");
  return { numero, chave_acesso: chaveAcesso, itens };
}
