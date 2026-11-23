// Utilidades: Aritmética inteira em centavos, datas/horas em America/Sao_Paulo, hash SHA-256, AES-256-GCM e sanitização LGPD
import crypto from "node:crypto";

const TZ = "America/Sao_Paulo";

/** Data local de São Paulo no formato YYYY-MM-DD */
export function hojeSP(base = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(base);
}

/** Data e hora local de São Paulo no formato YYYY-MM-DD HH:MM:SS (evita gravar UTC no SQLite) */
export function agoraSP(base = new Date()) {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(base);
  const m = Object.fromEntries(partes.map((p) => [p.type, p.value]));
  const hh = m.hour === "24" ? "00" : m.hour;
  return `${m.year}-${m.month}-${m.day} ${hh}:${m.minute}:${m.second}`;
}

export function somarDias(isoDate, dias) {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + dias));
  return dt.toISOString().slice(0, 10);
}

export function somarMinutosSP(minutos, base = new Date()) {
  return agoraSP(new Date(base.getTime() + minutos * 60_000));
}

/** Se a data calculada cair em domingo (0), antecipa para sábado (-1d) para evitar disparo em domingo. */
export function ajustarDiaDisparo(isoDate) {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCDay() === 0) {
    return somarDias(isoDate, -1);
  }
  return isoDate;
}

export function diffDias(a, b) {
  const pa = Date.UTC(...a.split("-").map((v, i) => (i === 1 ? v - 1 : +v)));
  const pb = Date.UTC(...b.split("-").map((v, i) => (i === 1 ? v - 1 : +v)));
  return Math.round((pb - pa) / 86400000);
}

export function faixaRisco(dataValidade, hoje = hojeSP()) {
  const d = diffDias(hoje, dataValidade);
  if (d < 0) return { faixa: "VENCIDO", dias: d };
  if (d <= 30) return { faixa: "CRITICO_30D", dias: d };
  if (d <= 60) return { faixa: "ALERTA_60D", dias: d };
  if (d <= 90) return { faixa: "ALERTA_90D", dias: d };
  return { faixa: "SEGURO", dias: d };
}

// ---------- Aritmética Monetária Exata em Centavos Inteiros (INTEGER) ----------
export const paraCentavos = (reais) => Math.round(Number(reais || 0) * 100);
export const deCentavos = (centavos) => Math.round(Number(centavos || 0)) / 100;
export const dinheiro = (reais) => deCentavos(paraCentavos(reais));

// ---------- Hash SHA-256 para Tokens de Recompra e Assinatura de Integridade ----------
export function hashSha256(valor) {
  return crypto.createHash("sha256").update(String(valor)).digest("hex");
}

// ---------- Sanitização LGPD de Texto de Receita (Remove CPF, Telefone, CRM, Nomes) ----------
export function anonimizarTextoReceita(texto) {
  if (!texto) return "";
  return String(texto)
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, "[CPF_OCULTO]")
    .replace(/\bCRM[-/\sA-Z]*\d{3,8}\b/gi, "[CRM_OCULTO]")
    .replace(/\b(?:\+?55\s?)?(?:\(?\d{2}\)?\s?)?\d{4,5}-?\d{4}\b/g, "[TEL_OCULTO]")
    .replace(/^(?:paciente|nome|dr\.?|dra\.?|m[eé]dico|endere[cç]o)\s*:.*$/gim, "")
    .trim();
}

// ---------- Remoção de EXIF JPEG e Criptografia AES-256-GCM em Repouso ----------
export function removerExifJpeg(buf) {
  if (!Buffer.isBuffer(buf) || buf[0] !== 0xff || buf[1] !== 0xd8) return buf;
  const partes = [buf.subarray(0, 2)];
  let pos = 2;
  while (pos < buf.length - 1) {
    if (buf[pos] !== 0xff) {
      partes.push(buf.subarray(pos));
      break;
    }
    const marker = buf[pos + 1];
    if (marker === 0xda || marker === 0xd9) {
      partes.push(buf.subarray(pos));
      break;
    }
    const len = buf.readUInt16BE(pos + 2);
    if (!((marker >= 0xe1 && marker <= 0xef) || marker === 0xfe)) {
      partes.push(buf.subarray(pos, pos + 2 + len));
    }
    pos += 2 + len;
  }
  return Buffer.concat(partes);
}

export function criptografarBuffer(buf, segredo) {
  const key = crypto.createHash("sha256").update(String(segredo)).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(buf), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]);
}

export function descriptografarBuffer(pacote, segredo) {
  const key = crypto.createHash("sha256").update(String(segredo)).digest();
  const iv = pacote.subarray(0, 12);
  const tag = pacote.subarray(12, 28);
  const enc = pacote.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]);
}

export function normalizarWhatsapp(tel) {
  let d = String(tel || "").replace(/\D/g, "");
  if (d.length === 10 || d.length === 11) d = "55" + d;
  return d;
}

export function linkWaMe(telefone, texto) {
  return `https://wa.me/${normalizarWhatsapp(telefone)}?text=${encodeURIComponent(texto)}`;
}

const SENSIVEIS = /senha|password|token|cpf|authorization|cookie|secret|imagem/i;
function mascarar(obj) {
  if (!obj || typeof obj !== "object") return obj;
  const out = Array.isArray(obj) ? [] : {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = SENSIVEIS.test(k) ? "[MASCARADO]" : typeof v === "object" ? mascarar(v) : v;
  }
  return out;
}

export function log(level, msg, extra = {}) {
  const linha = { timestamp: agoraSP(), level, msg, ...mascarar(extra) };
  (level === "error" ? console.error : console.log)(JSON.stringify(linha));
}

export class HttpError extends Error {
  constructor(status, mensagem, detalhes) {
    super(mensagem);
    this.status = status;
    this.detalhes = detalhes;
  }
}
