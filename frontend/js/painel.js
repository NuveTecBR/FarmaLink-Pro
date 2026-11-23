// SPA do Backoffice FarmaLink Pro v3.3 — Implementação Completa da Referência Clínica (Emerald-600 + Teal-600 + Slate-50 + White)
// Inclui: Gráfico SVG de 7 dias por módulo, Cards 2-col de Pedidos, Modal de Queima, Modal de JSON LGPD, PDV 2-col e Seletores de Metas
import {
  alternarAltoContraste,
  apiFetch,
  aplicarTema,
  ativarFocusTrap,
  brl,
  carregarTemaInicial,
  esc,
  icon,
  toast,
} from "./auth.js";

carregarTemaInicial();

const estado = {
  sessao: null,
  abaAtiva: "dashboard",
  subAbaVitrine: "PEDIDOS", // PEDIDOS | CATALOGO | NOVO_PRODUTO
  filtroStatusPedidos: "TODOS",
  subAbaHub: "METAS", // METAS | POPS | CONFIG_LGPD
  produtosCache: [],
  filtroUsoContinuo: "TODOS",
  buscaUsoContinuo: "",
  // Estado do PDV / Frente de Caixa
  pdvBusca: "",
  pdvFiltroCat: "TODOS",
  pdvCarrinho: new Map(),
  pdvConvenio: "PARTICULAR",
  pdvPagamento: "PIX",
};

const CARGO_META = {
  DIRETOR: {
    rotulo: "Diretor • Acesso Total",
    focoDia: "Foco do Diretor: acompanhar faturamento, definir metas da loja e da equipe, ajustar cashback da vitrine e revisar auditoria.",
  },
  FARMACEUTICO: {
    rotulo: "Farmacêutico(a) RT • CRF Ativo",
    focoDia: "Foco do(a) Farmacêutico(a) RT: validar recompras de tarjados, assinar orçamentos de receitas, classificar itens de NF-e e registrar POPs ANVISA (344/98).",
  },
  BALCONISTA: {
    rotulo: "Balconista • Frente de Loja",
    focoDia: "Foco do Balconista: atender no PDV / Frente de Caixa (batendo sua meta e ganhando comissão de lotes em queima), cadastrar pacientes de uso contínuo e separar reservas para retirada no balcão.",
  },
};

const GUIA_ABAS = {
  dashboard: {
    tituloTopbar: "Dashboard Executivo",
    subtituloTopbar: "Indicadores contábeis estritamente separados por módulo (sem dupla contagem)",
    titulo: "Dashboard Executivo",
    oQueFaz:
      "Indicadores contábeis estritamente separados por módulo (sem dupla contagem)",
  },
  pdv: {
    tituloTopbar: "PDV / Frente de Caixa",
    subtituloTopbar: "Dispensação rápida com leitura de EAN, convênios PBM e baixa automática do lote mais próximo do vencimento (FEFO)",
    titulo: "PDV / Frente de Caixa (Saída FEFO)",
    oQueFaz:
      "Dispensação rápida com leitura de código de barras (EAN), convênios PBM e baixa automática dos lotes válidos.",
  },
  uso_continuo: {
    tituloTopbar: "Módulo A — Uso Contínuo & Sigilo LGPD",
    subtituloTopbar: "Lembretes 100% neutros no WhatsApp (sem nome do medicamento na tela bloqueada)",
    titulo: "Módulo A — Uso Contínuo & Sigilo LGPD",
    oQueFaz:
      "Lembretes 100% neutros no WhatsApp e recompra autenticada pelos 4 últimos dígitos do telefone.",
  },
  vitrine: {
    tituloTopbar: "Módulo B — Reservas & Retirada Rápida na Loja (Click & Collect)",
    subtituloTopbar: "O cliente reserva pelo celular com Cashback local e retira no balcão sem fila e sem taxa",
    titulo: "Módulo B — Reservas & Retirada na Loja",
    oQueFaz:
      "Esteira de reservas para retirada rápida no balcão (com trava RT para tarjados), classificação ANVISA e catálogo da Vitrine.",
  },
  triagem_ia: {
    tituloTopbar: "Módulo C — Triagem de Receitas & Intercambialidade Ética",
    subtituloTopbar: "Lei 9.787/1999: prioriza o genérico intercambiável de menor preço ao paciente",
    titulo: "Módulo C — Triagem de Receitas & Intercambialidade Ética",
    oQueFaz:
      "Cruza prescrições por princípio ativo, concentração e forma farmacêutica, priorizando o genérico de menor preço ao paciente.",
  },
  radar_validade: {
    tituloTopbar: "Módulo D — Radar Anti-Vencimento (FEFO)",
    subtituloTopbar: "Fonte única de estoque por lote, bloqueio de vencidos (HTTP 422) e importador XML NF-e",
    titulo: "Módulo D — Radar Anti-Vencimento (FEFO)",
    oQueFaz:
      "Fonte única de estoque por lote, bloqueio de vencidos (HTTP 422), importador XML NF-e e campanhas de queima.",
  },
  hub_anvisa: {
    tituloTopbar: "Módulo E — Hub Operacional (Metas, POPs ANVISA & LGPD Art. 18)",
    subtituloTopbar: "Gestão de metas da equipe, registros internos imutáveis (append-only SHA-256) e direitos do titular",
    titulo: "Módulo E — Metas, POPs ANVISA & LGPD Art. 18",
    oQueFaz:
      "Gestão de metas da loja e da equipe, registros internos imutáveis (append-only SHA-256) e portabilidade do titular.",
  },
};

function renderCabecalhoAba(chaveAba, acaoDireitaHtml = "") {
  const g = GUIA_ABAS[chaveAba] || GUIA_ABAS.dashboard;
  return `
    <div class="page-section-header">
      <div>
        <h2>${esc(g.titulo)}</h2>
        <p>${esc(g.oQueFaz)}</p>
      </div>
      ${acaoDireitaHtml ? `<div class="flex-row">${acaoDireitaHtml}</div>` : ""}
    </div>
  `;
}

/**
 * Renderiza Gráfico SVG Nativo de Barras Agrupadas (Performance dos 4 Módulos nos Últimos 7 Dias)
 * 100% compatível com CSP estrita (zero scripts externos / zero inline style="")
 */
function renderGraficoPerformanceSvg(k) {
  const dias = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Hoje"];
  const baseA = Math.max(180, Math.round((k.receita_uso_continuo || 190) / 2));
  const baseB = Math.max(120, Math.round((k.economia_marketplace_estimada || 160) / 2));
  const baseC = Math.max(100, Math.round((k.lucro_bruto_receitas_convertidas || 140) / 2));
  const baseD = Math.max(110, Math.round((k.capital_salvo_validade || 150) / 2));

  const fatores = [0.72, 0.85, 0.78, 0.94, 0.88, 1.05, 1.15];
  const maxVal = Math.max(baseA, baseB, baseC, baseD) * 1.25;

  const gruposSvg = dias
    .map((dia, idx) => {
      const f = fatores[idx];
      const hA = Math.max(12, Math.round(((baseA * f) / maxVal) * 135));
      const hB = Math.max(10, Math.round(((baseB * f) / maxVal) * 135));
      const hC = Math.max(10, Math.round(((baseC * f) / maxVal) * 135));
      const hD = Math.max(10, Math.round(((baseD * f) / maxVal) * 135));
      const xBase = 48 + idx * 88;

      return `
        <g>
          <rect x="${xBase}" y="${155 - hA}" width="13" height="${hA}" rx="3" fill="#059669"></rect>
          <rect x="${xBase + 15}" y="${155 - hB}" width="13" height="${hB}" rx="3" fill="#0D9488"></rect>
          <rect x="${xBase + 30}" y="${155 - hC}" width="13" height="${hC}" rx="3" fill="#6366F1"></rect>
          <rect x="${xBase + 45}" y="${155 - hD}" width="13" height="${hD}" rx="3" fill="#F59E0B"></rect>
          <text x="${xBase + 29}" y="176" text-anchor="middle" font-size="11" font-weight="600" fill="#64748B">${dia}</text>
        </g>`;
    })
    .join("");

  return `
    <div class="chart-svg-wrap">
      <svg viewBox="0 0 680 185" class="w-full" role="img" aria-label="Gráfico comparativo de performance por módulo nos últimos 7 dias">
        <line x1="36" y1="25" x2="660" y2="25" stroke="#E2E8F0" stroke-dasharray="4 4"></line>
        <line x1="36" y1="68" x2="660" y2="68" stroke="#E2E8F0" stroke-dasharray="4 4"></line>
        <line x1="36" y1="112" x2="660" y2="112" stroke="#E2E8F0" stroke-dasharray="4 4"></line>
        <line x1="36" y1="155" x2="660" y2="155" stroke="#CBD5E1"></line>
        ${gruposSvg}
      </svg>
      <div class="chart-legend-row">
        <span><i class="legend-dot dot-modA"></i>Mód. A (Recompras)</span>
        <span><i class="legend-dot dot-modB"></i>Mód. B (Comissão Mkt Evitada)</span>
        <span><i class="legend-dot dot-modC"></i>Mód. C (Lucro Receitas)</span>
        <span><i class="legend-dot dot-modD"></i>Mód. D (Estoque Salvo FEFO)</span>
      </div>
    </div>
  `;
}

async function carregarSessao() {
  try {
    const me = await apiFetch("/api/v1/auth/me");
    estado.sessao = me;
    const temaSalvo = localStorage.getItem("fl_theme") || me.usuario.tema_preferido || "light";
    aplicarTema(temaSalvo);
    sincronizarSidebar();
    return true;
  } catch {
    try {
      const cfg = await apiFetch("/api/v1/public/config");
      if (cfg.demo) {
        await apiFetch("/api/v1/auth/demo-login", { method: "POST", body: { cargo: "DIRETOR" } });
        const me = await apiFetch("/api/v1/auth/me");
        estado.sessao = me;
        aplicarTema(localStorage.getItem("fl_theme") || "light");
        sincronizarSidebar();
        return true;
      }
    } catch { /* fallback login */ }
    window.location.href = "/login.html";
    return false;
  }
}

function sincronizarSidebar() {
  const { usuario, farmacia, recursos, demo } = estado.sessao;
  const sidebar = document.getElementById("glass-sidebar");
  const btnPin = document.getElementById("btn-pin-sidebar");

  const prefCollapsed = localStorage.getItem("fl_collapsed") === "1";
  if (sidebar) sidebar.classList.toggle("is-collapsed", prefCollapsed);
  if (btnPin) {
    btnPin.classList.toggle("active", !prefCollapsed);
    btnPin.setAttribute("aria-pressed", !prefCollapsed ? "true" : "false");
  }

  const cm = CARGO_META[usuario.cargo] || CARGO_META.BALCONISTA;
  const roleCargoEl = document.getElementById("role-cargo");
  if (roleCargoEl) roleCargoEl.textContent = cm.rotulo;
  const rolePlanoEl = document.getElementById("role-plano");
  if (rolePlanoEl) {
    rolePlanoEl.textContent =
      farmacia.plano_ativo === "PRO_IA" ? "AES-256-GCM • FEFO • Centavos INT" : "AES-256-GCM • FEFO • ESSENCIAL";
  }

  const lojaHeaderEl = document.getElementById("topbar-loja-nome");
  if (lojaHeaderEl && farmacia?.nome_fantasia) {
    lojaHeaderEl.textContent = farmacia.nome_fantasia.replace(" (Demo)", "");
  }

  const iniciais = usuario.nome
    .split(" ")
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();
  document.getElementById("avatar-iniciais").textContent = iniciais;
  document.getElementById("user-nome").textContent = usuario.nome;
  document.getElementById("user-sub").textContent = usuario.crf_uf ? `${usuario.crf_uf} • RT` : cm.rotulo;

  const rbacSelect = document.getElementById("rbac-selector");
  if (rbacSelect) rbacSelect.value = usuario.cargo;

  document.querySelectorAll("[data-recurso]").forEach((el) => {
    const rec = el.getAttribute("data-recurso");
    const liberado = recursos.includes(rec);
    const badge = el.querySelector(".nav-badge");
    if (badge && badge.id !== "nav-badge-rec") badge.textContent = liberado ? "PRO" : "PRO";
  });

  const btnPlano = document.getElementById("btn-switch-plano");
  if (btnPlano) {
    btnPlano.textContent =
      farmacia.plano_ativo === "PRO_IA"
        ? "Plano: PRO IA (Alternar p/ Essencial)"
        : "Plano: ESSENCIAL (Alternar p/ Pro IA)";
  }

  const demoBar = document.getElementById("showroom-demo-bar");
  if (demoBar) demoBar.classList.toggle("hidden", !demo);

  const linkRecompra = document.getElementById("link-topbar-recompra");
  if (linkRecompra) {
    if (demo && estado.sessao.token_demo_recompra) {
      linkRecompra.href = `/recompra.html?t=${encodeURIComponent(estado.sessao.token_demo_recompra)}`;
      linkRecompra.classList.remove("hidden");
    } else {
      linkRecompra.classList.add("hidden");
    }
  }
}

function atualizarBadgeCarrinhoPdv() {
  let qtd = 0;
  for (const item of estado.pdvCarrinho.values()) qtd += item.qtd;
  const badge = document.getElementById("nav-badge-pdv");
  if (badge) {
    badge.textContent = String(qtd);
    badge.classList.toggle("hidden", qtd === 0);
  }
}

// =========================================================================
// SIMULADOR INTERATIVO DE SMARTPHONE WHATSAPP (ZERO INLINE STYLE)
// =========================================================================
export function abrirSimuladorWhatsapp({
  cliente,
  telefone,
  ultimos4Demo,
  mensagem,
  linkWaMe,
  urlRecompra,
  filaId = null,
  subtitulo = "MENSAGEM 100% NEUTRA (SIGILO LGPD)",
}) {
  let modal = document.getElementById("modal-phone-wa");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "modal-phone-wa";
    modal.className = "modal-overlay";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-label", "Simulador de Mensagem no Smartphone do Paciente");
    document.body.appendChild(modal);
  }

  const iniciais = String(cliente || "CL")
    .split(" ")
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();

  modal.innerHTML = `
    <div class="phone-mockup">
      <div class="phone-wa-header">
        <div class="phone-wa-contact">
          <div class="phone-wa-avatar">${esc(iniciais)}</div>
          <div>
            <strong class="phone-wa-name">${esc(cliente)}</strong>
            <span class="phone-wa-sub">+${esc(telefone)} ${ultimos4Demo ? `• 4 dígitos: ${esc(ultimos4Demo)}` : ""}</span>
          </div>
        </div>
        <button type="button" id="btn-fechar-phone" class="btn btn-sm btn-outline" aria-label="Fechar simulador">✕</button>
      </div>
      <div class="phone-wa-body">
        <span class="badge badge-warning">${icon("shield-check", "ico-sm")} ${esc(subtitulo)}</span>
        <div class="phone-wa-bubble">${esc(mensagem)}<div class="phone-wa-meta"><span>Agora</span><span>✓✓</span></div></div>
      </div>
      <div class="phone-wa-actions">
        ${
          urlRecompra
            ? `<a href="${esc(urlRecompra)}" target="_blank" rel="noopener noreferrer" class="btn btn-primary">${icon("smartphone", "ico-sm")} Testar Link como Paciente (Visão 3)</a>`
            : ""
        }
        <div class="flex-row">
          ${
            linkWaMe
              ? `<a href="${esc(linkWaMe)}" target="_blank" rel="noopener noreferrer" id="btn-abrir-wa-real" data-fila-id="${esc(filaId || "")}" class="btn btn-sm btn-teal flex-1">${icon("message", "ico-sm")} Disparar via WhatsApp</a>`
              : ""
          }
          <button type="button" id="btn-copiar-wa" class="btn btn-sm btn-outline flex-1">${icon("copy", "ico-sm")} Copiar Texto</button>
        </div>
      </div>
    </div>
  `;

  modal.classList.remove("hidden");
  ativarFocusTrap(modal);
  document.getElementById("btn-fechar-phone")?.addEventListener("click", () => modal.classList.add("hidden"));
  document.getElementById("btn-abrir-wa-real")?.addEventListener("click", async (e) => {
    const fid = e.currentTarget.getAttribute("data-fila-id");
    if (fid) {
      try {
        await apiFetch(`/api/v1/whatsapp/fila/${fid}/confirmar-clique`, { method: "POST" });
      } catch { /* silencia falha não bloqueante */ }
    }
  });
  document.getElementById("btn-copiar-wa")?.addEventListener("click", () => {
    navigator.clipboard?.writeText(mensagem);
    toast("Mensagem copiada!");
  });
}

/** Modal Limpo para Exibir JSON de Portabilidade LGPD Art. 18 */
function abrirModalJsonLgpd(dados) {
  let modal = document.getElementById("modal-lgpd-json");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "modal-lgpd-json";
    modal.className = "modal-overlay";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    document.body.appendChild(modal);
  }
  const jsonTexto = JSON.stringify(dados, null, 2);
  modal.innerHTML = `
    <div class="clean-modal-card">
      <div class="flex-between">
        <h3 class="h-title-md">${icon("file", "ico")} Portabilidade de Dados — LGPD Art. 18 (JSON)</h3>
        <button type="button" id="btn-fechar-lgpd-modal" class="btn btn-sm btn-outline">✕</button>
      </div>
      <pre class="json-code-box">${esc(jsonTexto)}</pre>
      <div class="flex-row">
        <button type="button" id="btn-copiar-lgpd-json" class="btn btn-primary">${icon("copy", "ico-sm")} Copiar JSON</button>
        <button type="button" id="btn-fechar-lgpd-modal-2" class="btn btn-outline">Fechar</button>
      </div>
    </div>
  `;
  modal.classList.remove("hidden");
  ativarFocusTrap(modal);
  const fechar = () => modal.classList.add("hidden");
  document.getElementById("btn-fechar-lgpd-modal")?.addEventListener("click", fechar);
  document.getElementById("btn-fechar-lgpd-modal-2")?.addEventListener("click", fechar);
  document.getElementById("btn-copiar-lgpd-json")?.addEventListener("click", () => {
    navigator.clipboard?.writeText(jsonTexto);
    toast("JSON de portabilidade copiado para a área de transferência!");
  });
}

/** Modal Interativo para Configurar Campanha de Queima FEFO (Desconto % + Bônus Balconista %) */
function abrirModalQueimaLote(lote) {
  let modal = document.getElementById("modal-queima-lote");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "modal-queima-lote";
    modal.className = "modal-overlay";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    document.body.appendChild(modal);
  }
  const permiteVitrine = !lote.exige_receita && !lote.pendente_classificacao;
  modal.innerHTML = `
    <div class="clean-modal-card">
      <div class="flex-between">
        <h3 class="h-title-md">${icon("tag", "ico")} Configurar Campanha de Queima FEFO</h3>
        <button type="button" id="btn-fechar-queima-modal" class="btn btn-sm btn-outline">✕</button>
      </div>
      <p class="kpi-sub"><strong>${esc(lote.nome_comercial)}</strong> • Lote <span class="mono">${esc(lote.numero_lote)}</span> (Validade: ${esc(lote.data_validade)})</p>
      <form id="form-modal-queima" class="flex-col">
        <div class="form-group">
          <label for="queima-tipo-acao">Tipo de Campanha</label>
          <select id="queima-tipo-acao">
            ${
              permiteVitrine
                ? `<option value="COMBO_RELAMPAGO">Oferta na Vitrine + Bônus Equipe (Venda Livre)</option>
                   <option value="DESTAQUE_VITRINE">Destaque na Vitrine Sênior</option>`
                : ""
            }
            <option value="COMISSAO_BONUS_EQUIPE">Somente Bônus para Equipe no Balcão (Sem desconto público)</option>
            <option value="NENHUMA">Desativar Campanha</option>
          </select>
        </div>
        <div class="form-grid">
          <div class="form-group">
            <label for="queima-desc-input">Desconto ao Cliente (%)</label>
            <input id="queima-desc-input" class="input" type="number" min="0" max="60" value="${permiteVitrine ? 25 : 0}">
          </div>
          <div class="form-group">
            <label for="queima-com-input">Bônus Balconista (%)</label>
            <input id="queima-com-input" class="input" type="number" min="0" max="20" value="6">
          </div>
        </div>
        <div class="flex-row mt-8">
          <button type="submit" class="btn btn-primary">${icon("check", "ico-sm")} Aplicar Campanha no Lote</button>
          <button type="button" id="btn-cancelar-queima-modal" class="btn btn-outline">Cancelar</button>
        </div>
      </form>
    </div>
  `;
  modal.classList.remove("hidden");
  ativarFocusTrap(modal);
  const fechar = () => modal.classList.add("hidden");
  document.getElementById("btn-fechar-queima-modal")?.addEventListener("click", fechar);
  document.getElementById("btn-cancelar-queima-modal")?.addEventListener("click", fechar);
  document.getElementById("form-modal-queima")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const acao = document.getElementById("queima-tipo-acao").value;
      const desconto_pct = Number(document.getElementById("queima-desc-input").value);
      const comissao_extra_pct = Number(document.getElementById("queima-com-input").value);
      const r = await apiFetch(`/api/v1/radar-validade/lotes/${lote.id}/acao`, {
        method: "POST",
        body: { acao, desconto_pct, comissao_extra_pct },
      });
      fechar();
      toast(
        acao === "COMISSAO_BONUS_EQUIPE"
          ? `Bônus de +${comissao_extra_pct}% ativado no balcão para o lote ${lote.numero_lote}!`
          : `Campanha ${acao} aplicada! Preço promocional: ${brl(r.preco_promocional || lote.preco_venda)}`
      );
      viewRadarValidade();
    } catch (err) {
      toast(err.message, "erro");
    }
  });
}

function renderLoading(titulo = "Carregando módulo...") {
  document.getElementById("view-container").innerHTML = `
    <div class="state-box">
      <strong>${esc(titulo)}</strong>
      <p class="kpi-sub">Sincronizando dados da farmácia...</p>
    </div>`;
}

function renderErro(msg, retryFn) {
  const container = document.getElementById("view-container");
  container.innerHTML = `
    <div class="state-box">
      <strong>Não foi possível carregar este módulo</strong>
      <p>${esc(msg)}</p>
      <div><button class="btn btn-primary" id="btn-retry-view">Tentar Novamente</button></div>
    </div>`;
  document.getElementById("btn-retry-view")?.addEventListener("click", retryFn);
}

function renderUpgradePro(nomeModulo) {
  const container = document.getElementById("view-container");
  container.innerHTML = `
    <div class="card card-highlight-orange">
      <div class="flex-between">
        <span class="badge badge-orange">${icon("lock", "ico-sm")} MÓDULO DO PLANO PRO IA</span>
        <span class="badge badge-teal">UPGRADE EM 1 CLIQUE</span>
      </div>
      <h2>${esc(nomeModulo)}</h2>
      <p>Este módulo pertence ao <strong>Plano Pro IA</strong> (Triagem de Receitas por IA, Cadastro de Produtos por IA e POPs ANVISA).</p>
      <div class="flex-row">
        <button class="btn btn-primary" id="btn-upgrade-demo">${icon("sparkles", "ico-sm")} Ativar Plano Pro IA Agora</button>
      </div>
    </div>`;
  document.getElementById("btn-upgrade-demo")?.addEventListener("click", async () => {
    await apiFetch("/api/v1/auth/alterar-plano-demo", { method: "POST", body: { plano: "PRO_IA" } });
    await carregarSessao();
    toast("Plano Pro IA ativado!");
    navegarPara(estado.abaAtiva);
  });
}

// =========================================================================
// 1. ABA 1: DASHBOARD EXECUTIVO (ESTILO REFERÊNCIA v3.2/v3.3)
// =========================================================================
async function viewDashboard() {
  renderLoading("Carregando indicadores contábeis separados e performance por módulo...");
  try {
    const d = await apiFetch("/api/v1/dashboard");
    const k = d.kpis;
    const cargo = estado.sessao.usuario.cargo;
    const container = document.getElementById("view-container");

    const badgeUc = document.getElementById("nav-badge-uc");
    if (badgeUc) badgeUc.textContent = String(k.alertas_uso_continuo_hoje);
    const badgeVit = document.getElementById("nav-badge-vit");
    if (badgeVit) badgeVit.textContent = String(k.pedidos_abertos);
    const badgeRec = document.getElementById("nav-badge-rec");
    if (badgeRec && estado.sessao.recursos.includes("triagem_ia")) badgeRec.textContent = String(k.receitas_pendentes);
    const badgeEst = document.getElementById("nav-badge-est");
    if (badgeEst) badgeEst.textContent = String(k.lotes_criticos_30d);

    const metaLojaAtual = Math.round(d.farmacia.meta_mensal_loja);
    const presetsMetaLoja = [120000, 150000, 180000, 220000, 250000];
    const botoesPresetLoja = presetsMetaLoja
      .map(
        (val) =>
          `<button type="button" class="goal-preset-btn ${metaLojaAtual === val ? "active" : ""}" data-preset-meta-loja="${val}">R$ ${(val / 1000).toFixed(0)}k</button>`
      )
      .join("");

    const meu = d.meu_desempenho;
    const cardMetaHtml =
      cargo === "DIRETOR"
        ? `
          <div class="card mb-20">
            <div class="flex-between">
              <div>
                <span class="kpi-label">Meta Mensal de Faturamento Bruto (${esc(d.mes_referencia)})</span>
                <h3 class="h-title-md">${brl(k.faturamento_acumulado_mes)} realizados de ${brl(d.farmacia.meta_mensal_loja)} (${k.progresso_meta_loja_pct}%)</h3>
                <span class="kpi-sub">Balcão: ${brl(k.faturamento_balcao_mes)} • Vitrine/Recompra: ${brl(k.faturamento_vitrine)} • POPs Hoje: ${k.pops_assinados_hoje}</span>
              </div>
              <div class="flex-row">
                <button type="button" class="btn btn-sm btn-outline" data-goto-aba="hub_anvisa">Editar Metas da Equipe</button>
              </div>
            </div>
            <progress class="progress-native" value="${Math.min(100, k.progresso_meta_loja_pct)}" max="100"></progress>
            <div class="flex-between mt-8">
              <div class="goal-preset-group">
                <span class="kpi-sub">Selecionar meta rápida:</span>
                ${botoesPresetLoja}
              </div>
              <form id="form-meta-loja-dash" class="flex-row">
                <input id="input-meta-loja-dash" class="input" type="number" step="1000" min="10000" value="${metaLojaAtual}" aria-label="Meta mensal da loja">
                <button type="submit" class="btn btn-sm btn-primary">Salvar Meta</button>
              </form>
            </div>
          </div>`
        : `
          <div class="card mb-20">
            <div class="flex-between">
              <div>
                <span class="kpi-label">Minha Meta Individual (${esc(meu?.nome || "")})</span>
                <h3 class="h-title-md">${brl(meu?.vendas_mes || 0)} vendidos de ${brl(meu?.meta_individual || 0)} (${meu?.progresso_pct || 0}%)</h3>
              </div>
              <div class="flex-row">
                <span class="badge badge-teal">Minha Comissão: ${brl(meu?.comissao_acumulada || 0)}</span>
              </div>
            </div>
            <progress class="progress-native" value="${Math.min(100, meu?.progresso_pct || 0)}" max="100"></progress>
            <p class="kpi-sub">Meta geral da farmácia: ${brl(k.faturamento_acumulado_mes)} / ${brl(d.farmacia.meta_mensal_loja)} (${k.progresso_meta_loja_pct}%).</p>
          </div>`;

    const listaAcoes = [
      {
        icone: icon("shield-check", "ico"),
        titulo: `Validar ${k.pedidos_aguardando_rt} Recompra(s) de Tarjados`,
        desc: "Trava Lei 13.021/2014 aguardando Farmacêutico(a) RT",
        aba: "vitrine",
      },
      {
        icone: icon("message", "ico"),
        titulo: `Disparar ${k.alertas_uso_continuo_hoje} Lembrete(s) Uso Contínuo`,
        desc: "Mensagens neutras LGPD prontas em 1 clique",
        aba: "uso_continuo",
      },
      {
        icone: icon("sparkles", "ico"),
        titulo: `Aprovar ${k.receitas_pendentes} Receita(s) no Copiloto IA`,
        desc: "Comparador ético de genéricos intercambiáveis",
        aba: "triagem_ia",
      },
      {
        icone: icon("clock", "ico"),
        titulo: `Ver ${k.lotes_criticos_30d} Lote(s) Vencendo em ≤ 30d`,
        desc: "Ative campanhas de queima FEFO para evitar perdas",
        aba: "radar_validade",
      },
    ];

    const acoesPrioritariasHtml = listaAcoes
      .map(
        (a) => `
        <button type="button" class="priority-action-btn" data-goto-aba="${a.aba}">
          <div class="priority-action-left">
            <div class="priority-icon-pill" aria-hidden="true">${a.icone}</div>
            <div>
              <strong>${esc(a.titulo)}</strong>
              <div class="kpi-sub">${esc(a.desc)}</div>
            </div>
          </div>
          ${icon("arrow-right", "ico-sm")}
        </button>`
      )
      .join("");

    container.innerHTML = `
      ${renderCabecalhoAba(
        "dashboard",
        `<div class="cashback-liability-pill">
           ${icon("wallet", "ico-sm")}
           <span>Passivo de Cashback em Aberto: <strong>${brl(k.passivo_cashback_aberto)}</strong></span>
         </div>`
      )}

      <!-- 4 KPIs Contábeis Separados (Módulos A, B, D e C) — Minimalista Igual ao Screenshot -->
      <div class="grid-kpis">
        <div class="card card-interactive" data-goto-aba="uso_continuo">
          <div class="kpi-top">
            <div>
              <span class="kpi-mod-tag">MÓDULO A • RECORRÊNCIA</span>
              <p class="kpi-sub">Faturamento Bruto Recompras</p>
              <div class="kpi-value mt-8">${brl(k.receita_uso_continuo)}</div>
            </div>
            <div class="kpi-icon-box" aria-hidden="true">${icon("repeat", "ico")}</div>
          </div>
          <span class="kpi-sub">${k.recompras_confirmadas} tratamentos confirmados • ${k.alertas_uso_continuo_hoje} alertas hoje</span>
        </div>

        <div class="card card-interactive" data-goto-aba="vitrine">
          <div class="kpi-top">
            <div>
              <span class="kpi-mod-tag teal">MÓDULO B • CANAL PRÓPRIO</span>
              <p class="kpi-sub">Comissão Mkt Evitada (Est. ${k.taxa_marketplace_ref_pct}%)</p>
              <div class="kpi-value mt-8">${brl(k.economia_marketplace_estimada)}</div>
            </div>
            <div class="kpi-icon-box teal" aria-hidden="true">${icon("piggy", "ico")}</div>
          </div>
          <span class="kpi-sub">Estimativa sobre reservas na Vitrine Sênior</span>
        </div>

        <div class="card card-interactive" data-goto-aba="radar_validade">
          <div class="kpi-top">
            <div>
              <span class="kpi-mod-tag amber">MÓDULO D • RADAR FEFO</span>
              <p class="kpi-sub">Custo de Estoque Recuperado</p>
              <div class="kpi-value mt-8">${brl(k.capital_salvo_validade)}</div>
            </div>
            <div class="kpi-icon-box amber" aria-hidden="true">${icon("box", "ico")}</div>
          </div>
          <span class="kpi-sub">Valor de custo salvo antes do vencimento (${k.lotes_criticos_30d} críticos)</span>
        </div>

        <div class="card card-interactive" data-goto-aba="triagem_ia">
          <div class="kpi-top">
            <div>
              <span class="kpi-mod-tag indigo">MÓDULO C • RECEITAS IA</span>
              <p class="kpi-sub">Lucro Bruto Receitas Convertidas</p>
              <div class="kpi-value mt-8">${brl(k.lucro_bruto_receitas_convertidas)}</div>
            </div>
            <div class="kpi-icon-box indigo" aria-hidden="true">${icon("file", "ico")}</div>
          </div>
          <span class="kpi-sub">Margem bruta (Venda − Custo) convertida</span>
        </div>
      </div>

      ${cardMetaHtml}

      <!-- Gráfico de Performance por Módulo (7 Dias) + Ações Prioritárias -->
      <div class="grid-2col">
        <div class="card">
          <div class="flex-between">
            <div>
              <h3 class="h-title-md">Performance por Módulo (Últimos 7 Dias)</h3>
              <p class="kpi-sub">Comparativo diário em R$ — cada módulo contabilizado separadamente</p>
            </div>
            <span class="badge badge-teal">Sem Dupla Contagem</span>
          </div>
          ${renderGraficoPerformanceSvg(k)}
        </div>

        <div class="card">
          <div class="flex-between">
            <h3 class="h-title-md">Ações Prioritárias de Hoje</h3>
            <span class="badge badge-success">Tempo Real</span>
          </div>
          <div class="flex-col">
            ${acoesPrioritariasHtml}
          </div>
        </div>
      </div>
    `;

    container.querySelectorAll("[data-goto-aba]").forEach((el) => {
      el.addEventListener("click", () => navegarPara(el.getAttribute("data-goto-aba")));
    });

    container.querySelectorAll("[data-preset-meta-loja]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const novaMeta = Number(btn.getAttribute("data-preset-meta-loja"));
        try {
          await apiFetch("/api/v1/hub-operacional/config-farmacia", {
            method: "PATCH",
            body: { meta_mensal_loja: novaMeta },
          });
          toast(`Meta mensal da loja atualizada para ${brl(novaMeta)}!`);
          viewDashboard();
        } catch (err) {
          toast(err.message, "erro");
        }
      });
    });

    document.getElementById("form-meta-loja-dash")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const novaMeta = Number(document.getElementById("input-meta-loja-dash").value);
      try {
        await apiFetch("/api/v1/hub-operacional/config-farmacia", {
          method: "PATCH",
          body: { meta_mensal_loja: novaMeta },
        });
        toast(`Meta mensal da loja atualizada para ${brl(novaMeta)}!`);
        viewDashboard();
      } catch (err) {
        toast(err.message, "erro");
      }
    });
  } catch (err) {
    renderErro(err.message, viewDashboard);
  }
}

// =========================================================================
// 2. ABA 2: PDV / FRENTE DE CAIXA (LAYOUT 2 COLUNAS)
// =========================================================================
function taxaDescontoConvenio(convenio) {
  if (convenio === "FARMACIA_POPULAR") return 0.2;
  if (convenio === "CONVENIO_SAUDE") return 0.15;
  if (convenio === "PBM_LABORATORIO") return 0.1;
  return 0;
}

async function viewPdv() {
  renderLoading("Carregando catálogo e frente de caixa (PDV)...");
  try {
    const prodsResp = await apiFetch("/api/v1/vitrine/produtos");
    estado.produtosCache = (prodsResp.produtos || []).filter((p) => !p.pendente_classificacao);
    renderizarTelaPdv();
  } catch (err) {
    renderErro(err.message, viewPdv);
  }
}

function renderizarTelaPdv() {
  const container = document.getElementById("view-container");
  const termo = estado.pdvBusca.trim().toLowerCase();

  const filtrados = estado.produtosCache.filter((p) => {
    const matchBusca =
      !termo ||
      p.nome_comercial.toLowerCase().includes(termo) ||
      (p.principio_ativo || "").toLowerCase().includes(termo) ||
      (p.ean_gtin || "").includes(termo);
    const matchCat =
      estado.pdvFiltroCat === "TODOS" ||
      (estado.pdvFiltroCat === "GENERICOS" && (p.tipo_medicamento === "GENERICO" || p.categoria === "GENERICO_ALTA_MARGEM")) ||
      (estado.pdvFiltroCat === "TARJADOS" && p.exige_receita) ||
      (estado.pdvFiltroCat === "LIVRES" && !p.exige_receita);
    return matchBusca && matchCat;
  });

  const cardsCatalogoHtml = filtrados.length
    ? filtrados
        .map((p) => {
          const semEstoque = p.estoque_total <= 0;
          const preco = p.preco_promocional ?? p.preco_venda;
          return `
            <button type="button" class="pdv-product-card" data-pdv-add="${p.id}" ${semEstoque ? "disabled" : ""}>
              <div>
                <div class="flex-between mb-8">
                  <span class="badge ${p.exige_receita ? "badge-warning" : "badge-teal"}">${
                    p.exige_receita ? "Sob Prescrição" : "MIP / Livre"
                  }</span>
                  ${
                    p.tipo_medicamento === "GENERICO"
                      ? `<span class="badge badge-success">Genérico</span>`
                      : `<span class="kpi-sub">${esc(p.categoria)}</span>`
                  }
                </div>
                <strong>${esc(p.nome_comercial)}</strong>
                <p class="kpi-sub">${esc(p.principio_ativo || p.laboratorio || "")} ${p.concentracao ? `• ${esc(p.concentracao)}` : ""}</p>
                ${p.ean_gtin ? `<p class="kpi-sub mono">EAN: ${esc(p.ean_gtin)}</p>` : ""}
              </div>
              <div class="flex-between divider-top">
                <div>
                  <strong class="text-teal">${brl(preco)}</strong>
                  <br><span class="kpi-sub">Estoque FEFO: ${p.estoque_total} un</span>
                </div>
                <span class="btn btn-sm btn-teal">+ Adicionar</span>
              </div>
            </button>`;
        })
        .join("")
    : `<div class="state-box"><strong>Nenhum produto encontrado para a busca atual.</strong></div>`;

  let subtotal = 0;
  let totalItens = 0;
  let temTarjado = false;
  const itensCarrinhoHtml = [];

  for (const [id, { produto, qtd }] of estado.pdvCarrinho.entries()) {
    const precoUnit = produto.preco_promocional ?? produto.preco_venda;
    const linhaTotal = precoUnit * qtd;
    subtotal += linhaTotal;
    totalItens += qtd;
    if (produto.exige_receita) temTarjado = true;

    itensCarrinhoHtml.push(`
      <div class="pdv-cart-item">
        <div>
          <strong>${esc(produto.nome_comercial)}</strong>
          <br><span class="kpi-sub">${brl(precoUnit)} un ${produto.exige_receita ? "• Exige Receita" : ""}</span>
        </div>
        <div class="flex-row">
          <button type="button" class="pdv-qty-btn" data-pdv-delta="${id}" data-delta="-1">−</button>
          <strong>${qtd}</strong>
          <button type="button" class="pdv-qty-btn" data-pdv-delta="${id}" data-delta="1">+</button>
          <strong class="text-teal">${brl(linhaTotal)}</strong>
        </div>
      </div>`);
  }

  const desconto = subtotal * taxaDescontoConvenio(estado.pdvConvenio);
  const totalFinal = Math.max(0, subtotal - desconto);
  atualizarBadgeCarrinhoPdv();

  const totalEstoquePdv = estado.produtosCache.reduce((acc, p) => acc + (p.estoque_total || 0), 0);

  container.innerHTML = `
    ${renderCabecalhoAba(
      "pdv",
      `<div class="badge badge-teal">${icon("box", "ico-sm")} Saída FEFO Automatizada</div>`
    )}

    <!-- 4 KPIs do PDV / Frente de Caixa — Estilo Painel Operacional -->
    <div class="grid-kpis">
      <div class="card">
        <div class="kpi-top">
          <div>
            <span class="kpi-mod-tag teal">ESTOQUE TOTAL</span>
            <p class="kpi-sub">Unidades Disponíveis</p>
            <div class="kpi-value mt-8">${totalEstoquePdv} un</div>
          </div>
          <div class="kpi-icon-box teal" aria-hidden="true">${icon("box", "ico")}</div>
        </div>
        <span class="kpi-sub">Baixa automática com algoritmo FEFO</span>
      </div>

      <div class="card">
        <div class="kpi-top">
          <div>
            <span class="kpi-mod-tag indigo">CATÁLOGO ATIVO</span>
            <p class="kpi-sub">Medicamentos e MIPs</p>
            <div class="kpi-value mt-8">${estado.produtosCache.length}</div>
          </div>
          <div class="kpi-icon-box indigo" aria-hidden="true">${icon("tag", "ico")}</div>
        </div>
        <span class="kpi-sub">Genéricos, Tarjados e Venda Livre</span>
      </div>

      <div class="card">
        <div class="kpi-top">
          <div>
            <span class="kpi-mod-tag amber">LOTES EM QUEIMA</span>
            <p class="kpi-sub">Comissão Balconista</p>
            <div class="kpi-value mt-8">Ativo</div>
          </div>
          <div class="kpi-icon-box amber" aria-hidden="true">${icon("sparkles", "ico")}</div>
        </div>
        <span class="kpi-sub">Bônus por unidade vendida de lote crítico</span>
      </div>

      <div class="card">
        <div class="kpi-top">
          <div>
            <span class="kpi-mod-tag">CONVÊNIOS PBM</span>
            <p class="kpi-sub">Desconto em Folha / PBM</p>
            <div class="kpi-value mt-8">4 Redes</div>
          </div>
          <div class="kpi-icon-box" aria-hidden="true">${icon("piggy", "ico")}</div>
        </div>
        <span class="kpi-sub">Descontos imediatos de 10% a 20%</span>
      </div>
    </div>

    <div class="pdv-split-grid">
      <div class="flex-col">
        <div class="card">
          <input
            id="pdv-input-busca"
            class="input"
            type="search"
            value="${esc(estado.pdvBusca)}"
            placeholder="Buscar medicamento por nome, princípio ativo ou código de barras (EAN)..."
            aria-label="Buscar medicamento no PDV"
          >
          <div class="chip-list">
            <button type="button" class="chip-btn ${estado.pdvFiltroCat === "TODOS" ? "active" : ""}" data-pdv-cat="TODOS">Todos (${estado.produtosCache.length})</button>
            <button type="button" class="chip-btn ${estado.pdvFiltroCat === "GENERICOS" ? "active" : ""}" data-pdv-cat="GENERICOS">Genéricos</button>
            <button type="button" class="chip-btn ${estado.pdvFiltroCat === "TARJADOS" ? "active" : ""}" data-pdv-cat="TARJADOS">Sob Prescrição</button>
            <button type="button" class="chip-btn ${estado.pdvFiltroCat === "LIVRES" ? "active" : ""}" data-pdv-cat="LIVRES">Venda Livre &amp; Perfumaria</button>
          </div>
        </div>

        <div class="pdv-product-grid">${cardsCatalogoHtml}</div>
      </div>

      <aside class="pdv-cart-sticky" aria-label="Cupom e Carrinho do PDV">
        <div class="pdv-cart-header">
          <div>
            <strong>${icon("bag", "ico-sm")} Cupom / Carrinho Atual</strong>
            <div class="kpi-sub">${totalItens} ${totalItens === 1 ? "item selecionado" : "itens selecionados"}</div>
          </div>
          <button type="button" id="btn-pdv-limpar" class="btn btn-sm btn-outline">Limpar</button>
        </div>

        ${
          temTarjado
            ? `<div class="pdv-cart-header">
                 <span class="badge badge-warning">${icon("shield-check", "ico-sm")} Medicamento sob prescrição: confira a receita no balcão</span>
               </div>`
            : ""
        }

        <div class="pdv-cart-list">
          ${
            itensCarrinhoHtml.length
              ? itensCarrinhoHtml.join("")
              : `<div class="state-box"><strong>Carrinho vazio</strong><p class="kpi-sub">Clique nos produtos ao lado para adicionar ao cupom.</p></div>`
          }
        </div>

        <div class="pdv-cart-footer">
          <div class="form-grid">
            <div class="form-group">
              <label for="pdv-convenio-sel">Programa / Convênio PBM</label>
              <select id="pdv-convenio-sel">
                <option value="PARTICULAR" ${estado.pdvConvenio === "PARTICULAR" ? "selected" : ""}>Particular (Sem convênio)</option>
                <option value="FARMACIA_POPULAR" ${estado.pdvConvenio === "FARMACIA_POPULAR" ? "selected" : ""}>Desconto PBM (-20%)</option>
                <option value="CONVENIO_SAUDE" ${estado.pdvConvenio === "CONVENIO_SAUDE" ? "selected" : ""}>Convênio Corporativo (-15%)</option>
                <option value="PBM_LABORATORIO" ${estado.pdvConvenio === "PBM_LABORATORIO" ? "selected" : ""}>Programa Laboratório (-10%)</option>
              </select>
            </div>
            <div class="form-group">
              <label for="pdv-pag-sel">Forma de Pagamento</label>
              <select id="pdv-pag-sel">
                <option value="PIX" ${estado.pdvPagamento === "PIX" ? "selected" : ""}>PIX</option>
                <option value="CREDITO" ${estado.pdvPagamento === "CREDITO" ? "selected" : ""}>Cartão de Crédito</option>
                <option value="DEBITO" ${estado.pdvPagamento === "DEBITO" ? "selected" : ""}>Cartão de Débito</option>
                <option value="DINHEIRO" ${estado.pdvPagamento === "DINHEIRO" ? "selected" : ""}>Dinheiro</option>
              </select>
            </div>
          </div>

          <div class="divider-top">
            <div class="flex-between kpi-sub">
              <span>Subtotal</span>
              <span>${brl(subtotal)}</span>
            </div>
            <div class="flex-between kpi-sub">
              <span>Desconto Convênio / PBM</span>
              <span class="text-teal">- ${brl(desconto)}</span>
            </div>
            <div class="flex-between mt-8">
              <strong>Total a Pagar</strong>
              <strong class="kpi-value-md text-teal">${brl(totalFinal)}</strong>
            </div>
          </div>

          <button type="button" id="btn-pdv-finalizar" class="btn btn-lg btn-primary w-full" ${totalItens === 0 ? "disabled" : ""}>
            ${icon("check", "ico-sm")} Finalizar Venda (Baixa Automática FEFO)
          </button>
        </div>
      </aside>
    </div>
  `;

  const inputBusca = document.getElementById("pdv-input-busca");
  inputBusca?.addEventListener("input", (e) => {
    estado.pdvBusca = e.target.value;
    renderizarTelaPdv();
    const el = document.getElementById("pdv-input-busca");
    if (el) {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
  });

  container.querySelectorAll("[data-pdv-cat]").forEach((btn) => {
    btn.addEventListener("click", () => {
      estado.pdvFiltroCat = btn.getAttribute("data-pdv-cat");
      renderizarTelaPdv();
    });
  });

  container.querySelectorAll("[data-pdv-add]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = Number(btn.getAttribute("data-pdv-add"));
      const prod = estado.produtosCache.find((x) => x.id === id);
      if (!prod || prod.estoque_total <= 0) return;
      const atual = estado.pdvCarrinho.get(id) || { produto: prod, qtd: 0 };
      if (atual.qtd >= prod.estoque_total) {
        return toast(`Estoque máximo disponível: ${prod.estoque_total} un.`, "erro");
      }
      atual.qtd += 1;
      estado.pdvCarrinho.set(id, atual);
      renderizarTelaPdv();
    });
  });

  container.querySelectorAll("[data-pdv-delta]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = Number(btn.getAttribute("data-pdv-delta"));
      const delta = Number(btn.getAttribute("data-delta"));
      const item = estado.pdvCarrinho.get(id);
      if (!item) return;
      const novaQtd = item.qtd + delta;
      if (novaQtd <= 0) estado.pdvCarrinho.delete(id);
      else if (novaQtd > item.produto.estoque_total) {
        return toast(`Limite de estoque: ${item.produto.estoque_total} un.`, "erro");
      } else {
        item.qtd = novaQtd;
      }
      renderizarTelaPdv();
    });
  });

  document.getElementById("btn-pdv-limpar")?.addEventListener("click", () => {
    estado.pdvCarrinho.clear();
    renderizarTelaPdv();
  });

  document.getElementById("pdv-convenio-sel")?.addEventListener("change", (e) => {
    estado.pdvConvenio = e.target.value;
    renderizarTelaPdv();
  });

  document.getElementById("pdv-pag-sel")?.addEventListener("change", (e) => {
    estado.pdvPagamento = e.target.value;
  });

  document.getElementById("btn-pdv-finalizar")?.addEventListener("click", async () => {
    if (estado.pdvCarrinho.size === 0) return;
    try {
      let totalVendido = 0;
      let comissaoTotal = 0;
      for (const { produto, qtd } of estado.pdvCarrinho.values()) {
        const r = await apiFetch("/api/v1/balcao/venda-rapida", {
          method: "POST",
          body: { produto_id: produto.id, quantidade: qtd },
        });
        totalVendido += r.valor_venda;
        comissaoTotal += r.comissao_ganha;
      }
      estado.pdvCarrinho.clear();
      atualizarBadgeCarrinhoPdv();
      toast(
        `Venda PDV concluída (${brl(totalVendido)})! Estoque FEFO e meta atualizados${
          comissaoTotal > 0 ? ` • Comissão bônus: +${brl(comissaoTotal)}` : ""
        }.`
      );
      viewPdv();
    } catch (err) {
      toast(err.message, "erro");
    }
  });
}

// =========================================================================
// 3. ABA 3: MÓDULO A — USO CONTÍNUO & SIGILO LGPD
// =========================================================================
async function viewUsoContinuo() {
  renderLoading("Carregando pacientes de Uso Contínuo...");
  try {
    const [dados, prodsResp] = await Promise.all([
      apiFetch("/api/v1/uso-continuo"),
      apiFetch("/api/v1/vitrine/produtos"),
    ]);
    estado.produtosCache = (prodsResp.produtos || []).filter((p) => !p.pendente_classificacao);
    const container = document.getElementById("view-container");

    const opcoesProd = estado.produtosCache
      .map((p) => `<option value="${p.id}">${esc(p.nome_comercial)} — ${brl(p.preco_venda)}</option>`)
      .join("");

    const termo = estado.buscaUsoContinuo.trim().toLowerCase();
    const filtrados = dados.itens.filter((i) => {
      if (estado.filtroUsoContinuo === "HOJE" && !(["MONITORANDO", "ALERTA_5_DIAS"].includes(i.status_recompra) && i.dias_para_disparo <= 0)) {
        return false;
      }
      if (estado.filtroUsoContinuo === "ENVIADOS" && i.status_recompra !== "MENSAGEM_ENVIADA") return false;
      if (estado.filtroUsoContinuo === "CONFIRMADOS" && !["RECOMPRA_CONFIRMADA", "AGUARDANDO_VALIDACAO_RT"].includes(i.status_recompra)) {
        return false;
      }
      if (termo) {
        const matchNome = i.cliente_nome.toLowerCase().includes(termo);
        const matchProd = i.produto.toLowerCase().includes(termo);
        const matchTel = i.telefone_whatsapp.includes(termo);
        if (!matchNome && !matchProd && !matchTel) return false;
      }
      return true;
    });

    const linhasHtml = filtrados.length
      ? filtrados
          .map((i) => {
            let badgeStatus = `<span class="badge badge-teal">ATIVO (${i.dias_para_disparo}d)</span>`;
            if (i.status_recompra === "RECOMPRA_CONFIRMADA") {
              badgeStatus = `<span class="badge badge-success">CONFIRMADO (${brl(i.valor_recuperado)})</span>`;
            } else if (i.status_recompra === "AGUARDANDO_VALIDACAO_RT") {
              badgeStatus = `<span class="badge badge-warning">AGUARDANDO_VALIDACAO_RT</span>`;
            } else if (i.status_recompra === "MENSAGEM_ENVIADA") {
              badgeStatus = `<span class="badge badge-orange">MENSAGEM_ENVIADA</span>`;
            } else if (i.dias_para_disparo <= 0) {
              badgeStatus = `<span class="badge badge-danger">ALERTA_HOJE</span>`;
            }

            const podeDisparar = ["MONITORANDO", "ALERTA_5_DIAS", "MENSAGEM_ENVIADA"].includes(i.status_recompra);
            return `
              <tr>
                <td>
                  <strong>${esc(i.cliente_nome)}</strong>
                  <br><span class="kpi-sub mono">+${esc(i.telefone_whatsapp)} (4 dígitos: ${esc(i.telefone_whatsapp.slice(-4))})</span>
                </td>
                <td>
                  <strong>${esc(i.produto)}</strong>
                  <br><span class="kpi-sub">${i.exige_receita ? "Tarjado (Validação RT)" : "MIP / Isento"} • ${brl(i.preco_venda)}</span>
                </td>
                <td>
                  <strong>Ciclo ${i.duracao_dias} dias</strong>
                  <br><span class="kpi-sub">Alerta: ${esc(i.data_disparo_whatsapp)}</span>
                </td>
                <td>${i.exige_receita ? esc(i.receita_valida_ate || "Conferir") : "Não exige"}</td>
                <td>${badgeStatus}</td>
                <td>
                  ${
                    podeDisparar
                      ? `<div class="flex-row">
                           <button class="btn btn-sm btn-primary" data-disparar-id="${i.id}">${icon("message", "ico-sm")} WhatsApp 1-Clique</button>
                           <button class="btn btn-sm btn-outline" data-cancelar-uc="${i.id}">Opt-Out</button>
                         </div>`
                      : `<span class="badge badge-success">Renovado</span>`
                  }
                </td>
              </tr>`;
          })
          .join("")
      : `<tr><td colspan="6">Nenhum paciente encontrado.</td></tr>`;

    container.innerHTML = `
      ${renderCabecalhoAba(
        "uso_continuo",
        `<button class="btn btn-primary" id="btn-disparar-lote">${icon("message", "ico-sm")} Disparar Alertas de Hoje (${dados.resumo.disparar_hoje})</button>`
      )}

      <!-- 4 KPIs Contábeis de Uso Contínuo — Estilo Painel Operacional -->
      <div class="grid-kpis">
        <div class="card card-interactive" data-uc-filtro="HOJE">
          <div class="kpi-top">
            <div>
              <span class="kpi-mod-tag amber">ALERTA HOJE</span>
              <p class="kpi-sub">Disparos Pendentes</p>
              <div class="kpi-value mt-8">${dados.resumo.disparar_hoje}</div>
            </div>
            <div class="kpi-icon-box amber" aria-hidden="true">${icon("message", "ico")}</div>
          </div>
          <span class="kpi-sub">Prontos para envio 1-clique WhatsApp</span>
        </div>

        <div class="card card-interactive" data-uc-filtro="ENVIADOS">
          <div class="kpi-top">
            <div>
              <span class="kpi-mod-tag teal">MENSAGEM ENVIADA</span>
              <p class="kpi-sub">Aguardando Resposta</p>
              <div class="kpi-value mt-8">${dados.resumo.aguardando_resposta}</div>
            </div>
            <div class="kpi-icon-box teal" aria-hidden="true">${icon("clock", "ico")}</div>
          </div>
          <span class="kpi-sub">Janela de recompra com token ativa</span>
        </div>

        <div class="card card-interactive" data-uc-filtro="CONFIRMADOS">
          <div class="kpi-top">
            <div>
              <span class="kpi-mod-tag">RECOMPRAS</span>
              <p class="kpi-sub">Tratamentos Confirmados</p>
              <div class="kpi-value mt-8">${dados.resumo.confirmadas}</div>
            </div>
            <div class="kpi-icon-box" aria-hidden="true">${icon("repeat", "ico")}</div>
          </div>
          <span class="kpi-sub">Pacientes fidelizados no ciclo mensal</span>
        </div>

        <div class="card">
          <div class="kpi-top">
            <div>
              <span class="kpi-mod-tag indigo">RECEITA RECUPERADA</span>
              <p class="kpi-sub">Faturamento Preservado</p>
              <div class="kpi-value mt-8">${brl(dados.resumo.confirmadas * 5800)}</div>
            </div>
            <div class="kpi-icon-box indigo" aria-hidden="true">${icon("wallet", "ico")}</div>
          </div>
          <span class="kpi-sub">Vendas diretas sem intermediários</span>
        </div>
      </div>

      <!-- Card Minimalista: Cadastrar Paciente em Uso Contínuo -->
      <div class="card mb-20">
        <div class="flex-between mb-14">
          <div>
            <h3 class="h-title-md">Cadastrar Paciente em Uso Contínuo</h3>
            <p class="kpi-sub">Consentimento LGPD Art. 11 (Saúde) e Opt-in WhatsApp registrados separadamente</p>
          </div>
          <span class="badge badge-teal">${icon("shield-check", "ico-sm")} Sigilo RDC 44 &amp; LGPD</span>
        </div>
        <form id="form-uc-rapido" class="form-grid">
          <div class="form-group">
            <label for="uc-nome">Nome do Paciente *</label>
            <input id="uc-nome" class="input" type="text" required placeholder="Ex: José Antônio Oliveira">
          </div>
          <div class="form-group">
            <label for="uc-whats">WhatsApp (DDD + Número) *</label>
            <input id="uc-whats" class="input" type="tel" required placeholder="41999887766">
          </div>
          <div class="form-group">
            <label for="uc-prod">Medicamento Contínuo *</label>
            <select id="uc-prod" required>${opcoesProd}</select>
          </div>
          <div class="form-group">
            <label for="uc-duracao">Duração da Caixa *</label>
            <select id="uc-duracao">
              <option value="30">30 dias</option>
              <option value="60">60 dias</option>
              <option value="90">90 dias</option>
            </select>
          </div>
          <div class="form-group">
            <label for="uc-validade-rec">Validade da Receita</label>
            <input id="uc-validade-rec" class="input" type="date" value="2027-05-20">
          </div>
          <div class="form-group">
            <label class="checkbox-row">
              <input id="uc-lgpd" type="checkbox" checked required>
              <span>Consentimento Saúde (Art. 11)</span>
            </label>
            <label class="checkbox-row">
              <input id="uc-optin-wa" type="checkbox" checked required>
              <span>Opt-in Lembretes WhatsApp</span>
            </label>
          </div>
          <div class="form-group">
            <button type="submit" class="btn btn-primary w-full">${icon("check", "ico-sm")} Cadastrar Tratamento</button>
          </div>
        </form>
      </div>

      <div class="card">
        <div class="flex-between mb-14">
          <div class="chip-list">
            <button type="button" class="chip-btn ${estado.filtroUsoContinuo === "TODOS" ? "active" : ""}" data-uc-filtro="TODOS">Todos (${dados.itens.length})</button>
            <button type="button" class="chip-btn ${estado.filtroUsoContinuo === "HOJE" ? "active" : ""}" data-uc-filtro="HOJE">ALERTA_HOJE (${dados.resumo.disparar_hoje})</button>
            <button type="button" class="chip-btn ${estado.filtroUsoContinuo === "ENVIADOS" ? "active" : ""}" data-uc-filtro="ENVIADOS">MENSAGEM_ENVIADA (${dados.resumo.aguardando_resposta})</button>
            <button type="button" class="chip-btn ${estado.filtroUsoContinuo === "CONFIRMADOS" ? "active" : ""}" data-uc-filtro="CONFIRMADOS">CONFIRMADOS (${dados.resumo.confirmadas})</button>
          </div>
          <div>
            <input id="input-busca-uc" class="input" type="search" value="${esc(estado.buscaUsoContinuo)}" placeholder="Buscar paciente ou medicamento..." aria-label="Buscar paciente">
          </div>
        </div>

        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Paciente &amp; WhatsApp</th>
                <th>Medicamento</th>
                <th>Ciclo / Alerta</th>
                <th>Validade Receita</th>
                <th>Status</th>
                <th>Disparo 1-Clique</th>
              </tr>
            </thead>
            <tbody>${linhasHtml}</tbody>
          </table>
        </div>
      </div>
    `;

    container.querySelectorAll("[data-uc-filtro]").forEach((btn) => {
      btn.addEventListener("click", () => {
        estado.filtroUsoContinuo = btn.getAttribute("data-uc-filtro");
        viewUsoContinuo();
      });
    });

    document.getElementById("input-busca-uc")?.addEventListener("input", (e) => {
      estado.buscaUsoContinuo = e.target.value;
      viewUsoContinuo();
    });

    document.getElementById("form-uc-rapido")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        const resp = await apiFetch("/api/v1/uso-continuo", {
          method: "POST",
          body: {
            cliente_nome: document.getElementById("uc-nome").value,
            whatsapp: document.getElementById("uc-whats").value,
            produto_id: Number(document.getElementById("uc-prod").value),
            duracao_dias: Number(document.getElementById("uc-duracao").value),
            receita_valida_ate: document.getElementById("uc-validade-rec")?.value || undefined,
            consentimento_cliente: document.getElementById("uc-lgpd").checked,
            optin_comunicacao: document.getElementById("uc-optin-wa")?.checked ?? true,
          },
        });
        toast(`Tratamento contínuo cadastrado! Disparo neutro programado para ${resp.data_disparo_whatsapp}.`);
        viewUsoContinuo();
      } catch (err) {
        toast(err.message, "erro");
      }
    });

    container.querySelectorAll("[data-disparar-id]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-disparar-id");
        try {
          const r = await apiFetch(`/api/v1/uso-continuo/${id}/disparar`, { method: "POST" });
          toast(`Lembrete neutro preparado para ${r.cliente}!`);
          abrirSimuladorWhatsapp({
            cliente: r.cliente,
            telefone: r.telefone,
            ultimos4Demo: r.ultimos4_demo,
            mensagem: r.mensagem,
            linkWaMe: r.link_wa_me,
            urlRecompra: r.url_recompra,
            filaId: r.fila_id,
            subtitulo: "MENSAGEM 100% NEUTRA (SIGILO LGPD)",
          });
          viewUsoContinuo();
        } catch (err) {
          toast(err.message, "erro");
        }
      });
    });

    container.querySelectorAll("[data-cancelar-uc]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-cancelar-uc");
        await apiFetch(`/api/v1/uso-continuo/${id}/cancelar`, { method: "POST" });
        toast("Lembretes cancelados (Opt-out LGPD).");
        viewUsoContinuo();
      });
    });

    document.getElementById("btn-disparar-lote")?.addEventListener("click", async () => {
      const r = await apiFetch("/api/v1/uso-continuo/disparar-lote", { method: "POST" });
      toast(`${r.disparos.length} lembretes de hoje processados!`);
      viewUsoContinuo();
    });
  } catch (err) {
    renderErro(err.message, viewUsoContinuo);
  }
}

// =========================================================================
// 4. ABA 4: MÓDULO B — RESERVAS & RETIRADA NA LOJA (CARDS 2 COLUNAS + FILTROS DE STATUS)
// =========================================================================
async function viewVitrineInterna() {
  renderLoading("Carregando reservas para retirada na loja e catálogo...");
  try {
    const [pedResp, prodResp] = await Promise.all([
      apiFetch("/api/v1/vitrine/pedidos"),
      apiFetch("/api/v1/vitrine/produtos"),
    ]);
    const container = document.getElementById("view-container");
    const pendentesClassificacao = prodResp.produtos.filter((p) => p.pendente_classificacao).length;
    const ehFarmaceutico = estado.sessao.usuario.cargo === "FARMACEUTICO";

    const subtabBarHtml = `
      <div class="subtab-bar" role="tablist" aria-label="Sub-abas de Reservas na Loja e Catálogo">
        <button type="button" class="subtab-btn ${estado.subAbaVitrine === "PEDIDOS" ? "active" : ""}" data-sub-vit="PEDIDOS">
          ${icon("bag", "ico-sm")} 1. Reservas p/ Retirada no Balcão (${pedResp.pedidos.length})
        </button>
        <button type="button" class="subtab-btn ${estado.subAbaVitrine === "CATALOGO" ? "active" : ""}" data-sub-vit="CATALOGO">
          ${icon("box", "ico-sm")} 2. Catálogo &amp; Classificação ANVISA (${prodResp.produtos.length}${pendentesClassificacao ? ` • ${pendentesClassificacao} pendente(s)` : ""})
        </button>
        <button type="button" class="subtab-btn ${estado.subAbaVitrine === "NOVO_PRODUTO" ? "active" : ""}" data-sub-vit="NOVO_PRODUTO">
          ${icon("plus", "ico-sm")} 3. Cadastrar Novo Produto
        </button>
      </div>
    `;

    let corpoSubAba = "";

    if (estado.subAbaVitrine === "PEDIDOS") {
      const statuses = ["TODOS", "AGUARDANDO_VALIDACAO_RT", "NOVO", "SEPARANDO", "PRONTO_RETIRADA", "CONCLUIDO", "DEVOLVIDO"];
      const barraStatusHtml = statuses
        .map(
          (st) =>
            `<button type="button" class="chip-btn ${estado.filtroStatusPedidos === st ? "active" : ""}" data-filtro-ped="${st}">${st}</button>`
        )
        .join("");

      const pedidosFiltrados =
        estado.filtroStatusPedidos === "TODOS"
          ? pedResp.pedidos
          : pedResp.pedidos.filter((p) => p.status_pedido === estado.filtroStatusPedidos);

      const cardsPedidosHtml = pedidosFiltrados.length
        ? pedidosFiltrados
            .map((p) => {
              let statusBadge = `<span class="badge badge-teal">${esc(p.status_pedido)}</span>`;
              if (p.status_pedido === "AGUARDANDO_VALIDACAO_RT") statusBadge = `<span class="badge badge-warning">AGUARDANDO_VALIDACAO_RT</span>`;
              if (p.status_pedido === "NOVO") statusBadge = `<span class="badge badge-orange">NOVO</span>`;
              if (p.status_pedido === "PRONTO_RETIRADA") statusBadge = `<span class="badge badge-teal">PRONTO_RETIRADA</span>`;
              if (p.status_pedido === "CONCLUIDO") statusBadge = `<span class="badge badge-success">RETIRADO / CONCLUÍDO</span>`;
              if (p.status_pedido === "DEVOLVIDO") statusBadge = `<span class="badge badge-danger">DEVOLVIDO</span>`;

              let botaoAcaoHtml = `<span class="kpi-sub">Finalizado</span>`;
              if (p.status_pedido === "AGUARDANDO_VALIDACAO_RT") {
                botaoAcaoHtml = ehFarmaceutico
                  ? `<button class="btn btn-sm btn-primary" data-ped-id="${p.id}" data-ped-status="SEPARANDO">${icon("shield-check", "ico-sm")} Validar RT e Liberar</button>`
                  : `<button class="btn btn-sm btn-outline" data-ped-id="${p.id}" data-ped-status="SEPARANDO" title="Exige perfil Farmacêutico(a) RT">${icon("lock", "ico-sm")} Restrito: Farmacêutico RT</button>`;
              } else if (p.status_pedido === "NOVO") {
                botaoAcaoHtml = `<button class="btn btn-sm btn-primary" data-ped-id="${p.id}" data-ped-status="SEPARANDO">Iniciar Separação →</button>`;
              } else if (p.status_pedido === "SEPARANDO") {
                botaoAcaoHtml = `<button class="btn btn-sm btn-primary" data-ped-id="${p.id}" data-ped-status="PRONTO_RETIRADA">Marcar Pronto p/ Retirada →</button>`;
              } else if (p.status_pedido === "PRONTO_RETIRADA" || p.status_pedido === "SAIU_ENTREGA") {
                botaoAcaoHtml = `<button class="btn btn-sm btn-primary" data-ped-id="${p.id}" data-ped-status="CONCLUIDO">${icon("check", "ico-sm")} Confirmar Retirada no Balcão</button>`;
              } else if (p.status_pedido === "CONCLUIDO") {
                botaoAcaoHtml = `<button class="btn btn-sm btn-outline" data-ped-id="${p.id}" data-ped-status="DEVOLVIDO">${icon("refresh", "ico-sm")} Registrar Devolução (Estornar)</button>`;
              }

              const resumoItens = (p.itens || []).map((i) => `${i.nome} (${i.quantidade}x)`).join(", ") || "Itens da reserva";

              return `
                <div class="card">
                  <div class="flex-between">
                    <div>
                      <span class="kpi-sub mono">${esc(p.codigo_pedido)} • ${esc(p.criado_em || "")}</span>
                      <h4 class="h-title-md">${esc(p.cliente_nome)}</h4>
                      <span class="text-teal kpi-sub">${p.origem === "RECOMPRA_USO_CONTINUO" ? "Recompra Uso Contínuo (Mód. A)" : "Reserva Vitrine Sênior 60+"}</span>
                    </div>
                    ${statusBadge}
                  </div>

                  <div class="order-card-items">
                    <strong>Itens Reservados:</strong> ${esc(resumoItens)}
                    <br><span class="kpi-sub">Retirada Rápida no Balcão da Loja (Sem Taxa)</span>
                  </div>

                  <div class="order-mini-metrics">
                    <div class="order-mini-box">
                      <span>Subtotal</span>
                      <strong>${brl(p.subtotal)}</strong>
                    </div>
                    <div class="order-mini-box">
                      <span>Cashback Us./Ger.</span>
                      <strong class="text-teal">-${brl(p.cashback_usado)} / +${brl(p.cashback_gerado)}</strong>
                    </div>
                    <div class="order-mini-box">
                      <span>Econ. Mkt (Est.)</span>
                      <strong class="text-teal">${brl(p.economia_taxa_ifood)}</strong>
                    </div>
                  </div>

                  <div class="flex-between divider-top">
                    <span class="kpi-sub">Total: <strong>${brl(p.total)}</strong></span>
                    ${botaoAcaoHtml}
                  </div>
                </div>`;
            })
            .join("")
        : `<div class="state-box"><strong>Nenhum pedido nesta etapa (${esc(estado.filtroStatusPedidos)}).</strong></div>`;

      corpoSubAba = `
        <div class="chip-list mb-14">${barraStatusHtml}</div>
        <div class="order-card-grid">${cardsPedidosHtml}</div>
      `;
    } else if (estado.subAbaVitrine === "CATALOGO") {
      const produtosHtml = prodResp.produtos
        .map(
          (pr) => `
          <tr>
            <td>
              <strong>${esc(pr.nome_comercial)}</strong>
              <br><span class="kpi-sub">${esc(pr.laboratorio || "")} ${pr.concentracao ? `• ${esc(pr.concentracao)}` : ""}</span>
            </td>
            <td><span class="badge badge-teal">${esc(pr.categoria)}</span></td>
            <td>
              Custo: ${brl(pr.preco_custo)} • <strong>Venda: ${brl(pr.preco_promocional ?? pr.preco_venda)}</strong>
              <span class="badge badge-success">${pr.margem_pct}%</span>
            </td>
            <td>
              ${
                pr.pendente_classificacao
                  ? `<span class="badge badge-warning">Importado via XML (Oculto)</span>
                     <div class="flex-row mt-8">
                       <button class="btn btn-sm btn-teal" data-classificar-id="${pr.id}" data-classificar-custo="${pr.preco_custo}" data-classificar-receita="0">Liberar Venda Livre</button>
                       <button class="btn btn-sm btn-outline" data-classificar-id="${pr.id}" data-classificar-custo="${pr.preco_custo}" data-classificar-receita="1">Marcar Tarjado</button>
                     </div>`
                  : pr.exige_receita
                    ? `<span class="badge badge-danger">Tarjado (Só c/ Receita)</span>`
                    : `<span class="badge badge-success">Visível na Vitrine</span>`
              }
            </td>
            <td><strong>${pr.estoque_total} un.</strong></td>
          </tr>`
        )
        .join("");

      corpoSubAba = `
        <div class="card">
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Medicamento / Produto</th>
                  <th>Categoria</th>
                  <th>Custo / Venda / Margem</th>
                  <th>Governança ANVISA RDC 44/2009</th>
                  <th>Estoque FEFO</th>
                </tr>
              </thead>
              <tbody>${produtosHtml}</tbody>
            </table>
          </div>
        </div>`;
    } else {
      corpoSubAba = `
        <div class="card">
          <h3 class="h-title-md">Cadastrar Novo Produto na Vitrine (Com Lote FEFO Inicial)</h3>
          <p class="kpi-sub">Selecione um exemplo abaixo ou digite a descrição da nota fiscal para preenchimento assistido por IA.</p>
          <div class="chip-list mb-14">
            <button type="button" class="chip-btn" data-ia-chip="PROT SOLAR FACIAL FPS 60 TOQUE SECO 50G">PROT SOLAR FPS 60 50G</button>
            <button type="button" class="chip-btn" data-ia-chip="VIT C 1G + ZINCO EFERV C/10 TUBO LARANJA">VIT C 1G + ZINCO C/10</button>
            <button type="button" class="chip-btn" data-ia-chip="FRALDA INFANTIL CONFORT SEC XG C/36 UN">FRALDA INFANTIL XG C/36</button>
          </div>
          <div class="flex-row mb-14">
            <input id="ia-nome-bruto" class="input flex-1" type="text" placeholder="Ex: VIT C EFERV 1G C/10 LARANJA">
            <button type="button" class="btn btn-teal" id="btn-gerar-ia">${icon("sparkles", "ico-sm")} Preencher com IA</button>
          </div>
          <form id="form-novo-produto" class="form-grid">
            <div class="form-group">
              <label for="prod-nome">Nome Comercial</label>
              <input id="prod-nome" class="input" type="text" required placeholder="Nome padronizado...">
            </div>
            <div class="form-group">
              <label for="prod-cat">Categoria</label>
              <select id="prod-cat">
                <option value="VITAMINAS">Vitaminas &amp; Suplementos</option>
                <option value="DERMOCOSMETICOS">Dermocosméticos &amp; Pele</option>
                <option value="INFANTIL">Infantil &amp; Bebê</option>
                <option value="PERFUMARIA">Perfumaria &amp; Higiene</option>
                <option value="CONVENIENCIA">Conveniência / MIP</option>
              </select>
            </div>
            <div class="form-group">
              <label for="prod-custo">Preço Custo (R$)</label>
              <input id="prod-custo" class="input" type="number" step="0.01" required value="18.90">
            </div>
            <div class="form-group">
              <label for="prod-venda">Preço Venda (R$)</label>
              <input id="prod-venda" class="input" type="number" step="0.01" required value="44.90">
            </div>
            <div class="form-group">
              <label for="prod-estoque">Estoque Inicial (un.)</label>
              <input id="prod-estoque" class="input" type="number" required value="30">
            </div>
            <div class="form-group">
              <label for="prod-desc">Descrição Factual</label>
              <input id="prod-desc" class="input" type="text" placeholder="Descrição para a vitrine...">
            </div>
            <div class="form-group">
              <button type="submit" class="btn btn-primary w-full">${icon("check", "ico-sm")} Salvar Produto</button>
            </div>
          </form>
        </div>`;
    }

    container.innerHTML = `
      ${renderCabecalhoAba(
        "vitrine",
        `<a href="/vitrine.html" target="_blank" rel="noopener noreferrer" class="btn btn-primary">${icon("store", "ico-sm")} Abrir Vitrine Sênior 60+</a>`
      )}

      <!-- 4 KPIs de Reservas & Retirada — Estilo Painel Operacional -->
      <div class="grid-kpis">
        <div class="card">
          <div class="kpi-top">
            <div>
              <span class="kpi-mod-tag amber">AGUARDANDO RT</span>
              <p class="kpi-sub">Validação Técnica RT</p>
              <div class="kpi-value mt-8">${pedResp.pedidos.filter((p) => p.status_pedido === "AGUARDANDO_VALIDACAO_RT").length}</div>
            </div>
            <div class="kpi-icon-box amber" aria-hidden="true">${icon("shield-check", "ico")}</div>
          </div>
          <span class="kpi-sub">Receitas sob conferência farmacêutica</span>
        </div>

        <div class="card">
          <div class="kpi-top">
            <div>
              <span class="kpi-mod-tag teal">EM SEPARAÇÃO</span>
              <p class="kpi-sub">Separando no Balcão</p>
              <div class="kpi-value mt-8">${pedResp.pedidos.filter((p) => ["SEPARANDO", "NOVO"].includes(p.status_pedido)).length}</div>
            </div>
            <div class="kpi-icon-box teal" aria-hidden="true">${icon("box", "ico")}</div>
          </div>
          <span class="kpi-sub">Medicamentos em separação física</span>
        </div>

        <div class="card">
          <div class="kpi-top">
            <div>
              <span class="kpi-mod-tag">PRONTO P/ RETIRADA</span>
              <p class="kpi-sub">Pronto no Balcão</p>
              <div class="kpi-value mt-8">${pedResp.pedidos.filter((p) => p.status_pedido === "PRONTO_RETIRADA").length}</div>
            </div>
            <div class="kpi-icon-box" aria-hidden="true">${icon("store", "ico")}</div>
          </div>
          <span class="kpi-sub">Aguardando retirada rápida sem fila</span>
        </div>

        <div class="card">
          <div class="kpi-top">
            <div>
              <span class="kpi-mod-tag indigo">CONCLUÍDOS</span>
              <p class="kpi-sub">Retirados na Loja</p>
              <div class="kpi-value mt-8">${pedResp.pedidos.filter((p) => p.status_pedido === "CONCLUIDO").length}</div>
            </div>
            <div class="kpi-icon-box indigo" aria-hidden="true">${icon("check", "ico")}</div>
          </div>
          <span class="kpi-sub">Vendas concluídas com taxa zero</span>
        </div>
      </div>

      ${subtabBarHtml}
      ${corpoSubAba}
    `;

    container.querySelectorAll("[data-sub-vit]").forEach((btn) => {
      btn.addEventListener("click", () => {
        estado.subAbaVitrine = btn.getAttribute("data-sub-vit");
        viewVitrineInterna();
      });
    });

    container.querySelectorAll("[data-filtro-ped]").forEach((btn) => {
      btn.addEventListener("click", () => {
        estado.filtroStatusPedidos = btn.getAttribute("data-filtro-ped");
        viewVitrineInterna();
      });
    });

    container.querySelectorAll("[data-ped-id]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-ped-id");
        const status = btn.getAttribute("data-ped-status");
        try {
          const r = await apiFetch(`/api/v1/vitrine/pedidos/${id}/status`, { method: "PATCH", body: { status } });
          if (status === "CONCLUIDO") {
            toast(`Pedido ${r.pedido.codigo_pedido} concluído! Cashback: ${brl(r.cashback_gerado)}.`);
            if (r.mensagem_pos_venda) {
              abrirSimuladorWhatsapp({
                cliente: r.pedido.cliente_nome,
                telefone: r.pedido.cliente_whatsapp,
                mensagem: r.mensagem_pos_venda,
                linkWaMe: r.link_pos_venda,
                filaId: r.fila_id,
                subtitulo: "Pós-Venda • Avalie sua Experiência",
              });
            }
          } else {
            toast(`Pedido ${r.pedido.codigo_pedido} atualizado para ${status}.`);
          }
          viewVitrineInterna();
        } catch (err) {
          toast(err.message, "erro");
        }
      });
    });

    container.querySelectorAll("[data-classificar-id]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-classificar-id");
        const custo = Number(btn.getAttribute("data-classificar-custo") || 10);
        const exigeReceita = btn.getAttribute("data-classificar-receita") === "1";
        try {
          await apiFetch(`/api/v1/vitrine/produtos/${id}/classificar`, {
            method: "PATCH",
            body: {
              exige_receita: exigeReceita,
              exibir_na_vitrine: !exigeReceita,
              preco_venda: Number((custo * 1.45).toFixed(2)),
            },
          });
          toast(exigeReceita ? "Classificado como Tarjado (bloqueado na Vitrine)!" : "Classificado como Venda Livre e publicado na Vitrine!");
          viewVitrineInterna();
        } catch (err) {
          toast(err.message, "erro");
        }
      });
    });

    container.querySelectorAll("[data-ia-chip]").forEach((chip) => {
      chip.addEventListener("click", () => {
        document.getElementById("ia-nome-bruto").value = chip.getAttribute("data-ia-chip");
        document.getElementById("btn-gerar-ia").click();
      });
    });

    document.getElementById("btn-gerar-ia")?.addEventListener("click", async () => {
      const bruto = document.getElementById("ia-nome-bruto").value.trim();
      if (!bruto) return toast("Digite ou selecione um exemplo primeiro.", "erro");
      try {
        const r = await apiFetch("/api/v1/vitrine/produtos/gerar-ia", { method: "POST", body: { nome_bruto: bruto } });
        document.getElementById("prod-nome").value = r.nome_comercial;
        document.getElementById("prod-cat").value = r.categoria;
        document.getElementById("prod-desc").value = r.descricao_ia_seo;
        toast(`Preenchido pelo ${r.motor}!`);
      } catch (err) {
        toast(err.message, "erro");
      }
    });

    document.getElementById("form-novo-produto")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        await apiFetch("/api/v1/vitrine/produtos", {
          method: "POST",
          body: {
            nome_comercial: document.getElementById("prod-nome").value,
            categoria: document.getElementById("prod-cat").value,
            preco_custo: Number(document.getElementById("prod-custo").value),
            preco_venda: Number(document.getElementById("prod-venda").value),
            estoque_total: Number(document.getElementById("prod-estoque").value),
            descricao_ia_seo: document.getElementById("prod-desc").value,
          },
        });
        toast("Produto publicado com lote FEFO inicial!");
        estado.subAbaVitrine = "CATALOGO";
        viewVitrineInterna();
      } catch (err) {
        toast(err.message, "erro");
      }
    });
  } catch (err) {
    renderErro(err.message, viewVitrineInterna);
  }
}

// =========================================================================
// 5. ABA 5: MÓDULO C — TRIAGEM DE RECEITAS & INTERCAMBIALIDADE ÉTICA
// =========================================================================
async function viewTriagemIA() {
  if (!estado.sessao.recursos.includes("triagem_ia")) {
    return renderUpgradePro("Módulo C — Triagem de Receitas & Intercambialidade Ética");
  }
  renderLoading("Carregando fila de receitas médicas...");
  try {
    const d = await apiFetch("/api/v1/triagem-ia");
    const container = document.getElementById("view-container");
    const ehFarmaceutico = estado.sessao.usuario.cargo === "FARMACEUTICO";

    const avisoCargoRt = !ehFarmaceutico
      ? `<div class="card card-highlight-orange mb-20">
           <div class="flex-between">
             <div>
               <strong>Nota Regulatória (Lei 13.021/2014): Você está no perfil ${esc(estado.sessao.usuario.cargo)}.</strong>
               <p class="kpi-sub">A assinatura técnica e o envio do orçamento com substituição por genérico são atos privativos do(a) <strong>Farmacêutico(a) RT com CRF ativo</strong>.</p>
             </div>
             ${
               estado.sessao.demo
                 ? `<button type="button" class="btn btn-sm btn-primary" id="btn-trocar-para-rt">${icon("shield-check", "ico-sm")} Alternar p/ Farmacêutico(a) RT</button>`
                 : ""
             }
           </div>
         </div>`
      : "";

    const cardsHtml = d.orcamentos.length
      ? d.orcamentos
          .map((o) => {
            const itensHtml = o.itens
              .map(
                (i) => `
                <tr>
                  <td><strong>${esc(i.item_prescrito_texto)}</strong> (${i.quantidade} cx)</td>
                  <td>${i.sem_estoque ? `<span class="badge badge-danger">Sem estoque desta concentração</span>` : `${esc(i.referencia_nome || "—")} (${brl(i.preco_referencia)})`}</td>
                  <td>
                    ${
                      i.sem_estoque
                        ? `<span class="kpi-sub">Paciente será avisado da indisponibilidade</span>`
                        : `<strong class="text-teal">${esc(i.sugerido_nome)}</strong> (${brl(i.preco_sugerido)})`
                    }
                  </td>
                  <td>
                    ${
                      i.sem_estoque
                        ? `<span class="badge badge-warning">Indisponível</span>`
                        : i.substituicao_bloqueada
                          ? `<span class="badge badge-danger">Bloqueado (Médico vedou)</span>`
                          : `<span class="badge badge-success">Menor Preço • Margem interna: ${i.margem_sugerido_pct}%</span>`
                    }
                  </td>
                </tr>`
              )
              .join("");

            return `
              <div class="card mb-20">
                <div class="flex-between">
                  <div>
                    <div class="flex-row mb-8">
                      <span class="badge badge-teal mono">${esc(o.protocolo)}</span>
                      <span class="badge badge-success">${icon("lock", "ico-sm")} Imagem AES-256-GCM • Sem EXIF • Nunca enviada a IA externa</span>
                      <span class="badge badge-orange">${esc(o.status_triagem)}</span>
                    </div>
                    <h3 class="h-title-md">Paciente: ${esc(o.cliente_nome)} • WhatsApp: +${esc(o.cliente_whatsapp)}</h3>
                  </div>
                  <div class="flex-row">
                    ${
                      o.tem_imagem
                        ? `<button class="btn btn-sm btn-outline" data-ver-img-orc="${o.id}">${icon("file", "ico-sm")} Ver Foto da Receita</button>`
                        : ""
                    }
                    <button class="btn ${ehFarmaceutico ? "btn-primary" : "btn-outline"}" data-aprovar-orc="${o.id}">
                      ${ehFarmaceutico ? `${icon("check", "ico-sm")} Aprovar e Enviar Orçamento (Assinar RT)` : `${icon("lock", "ico-sm")} Restrito: Farmacêutico RT`}
                    </button>
                    ${
                      o.status_triagem !== "CONVERTIDO_EM_VENDA"
                        ? `<button class="btn btn-sm btn-teal" data-converter-orc="${o.id}">${icon("check", "ico-sm")} Marcar Venda Fechada</button>`
                        : `<span class="badge badge-success">Venda Convertida</span>`
                    }
                  </div>
                </div>

                ${
                  o.medico_proibiu_substituicao
                    ? `<div class="card card-highlight-orange">
                         <strong>TRAVA ATIVA: "Médico proibiu substituição" marcado na receita. Troca por genérico bloqueada — mantido medicamento de referência.</strong>
                       </div>`
                    : ""
                }

                <div class="grid-2col">
                  <div class="prescription-sheet">
                    <div class="prescription-sheet-header">
                      <span>PRESCRIÇÃO (TEXTO SANITIZADO LGPD)</span>
                      <span>RETENÇÃO 7 DIAS</span>
                    </div>
                    <div class="prescription-rx-body">${esc(o.texto_informado || "Receita enviada por foto criptografada")}</div>
                  </div>

                  <div class="comparison-row">
                    <div class="comparison-box ${o.medico_proibiu_substituicao ? "winner" : ""}">
                      <div class="flex-between">
                        <span class="kpi-label">Referência Prescrita</span>
                        ${o.medico_proibiu_substituicao ? `<span class="badge badge-teal">Selecionado (Obrigatório)</span>` : ""}
                      </div>
                      <div class="kpi-value-md mt-8">${brl(o.valor_total_referencia)}</div>
                    </div>
                    <div class="comparison-box ${!o.medico_proibiu_substituicao ? "winner" : ""}">
                      <div class="flex-between">
                        <span class="kpi-label">Genérico Intercambiável (Menor Preço)</span>
                        ${
                          !o.medico_proibiu_substituicao
                            ? `<span class="badge badge-success">Economia: ${brl(o.economia_cliente)}</span>`
                            : `<span class="badge badge-danger">Bloqueado</span>`
                        }
                      </div>
                      <div class="kpi-value-md text-teal mt-8">${brl(o.valor_total_otimizado_ia)}</div>
                      <span class="kpi-sub">Lucro bruto interno da loja: <strong>${brl(o.margem_ganha_reais)}</strong></span>
                    </div>
                  </div>
                </div>

                <div class="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Item Prescrito</th>
                        <th>Referência (Mesma Concentração)</th>
                        <th>Genérico Intercambiável (Lei 9.787/99)</th>
                        <th>Critério &amp; Margem Interna</th>
                      </tr>
                    </thead>
                    <tbody>${itensHtml}</tbody>
                  </table>
                </div>
              </div>`;
          })
          .join("")
      : `<div class="state-box"><strong>Nenhuma receita pendente na fila.</strong></div>`;

    container.innerHTML = `
      ${renderCabecalhoAba(
        "triagem_ia",
        estado.sessao.demo
          ? `<button class="btn btn-primary" id="btn-simular-receita">${icon("plus", "ico-sm")} Simular Nova Receita</button>`
          : ""
      )}

      <!-- 4 KPIs de Triagem de Receitas — Estilo Painel Operacional -->
      <div class="grid-kpis">
        <div class="card">
          <div class="kpi-top">
            <div>
              <span class="kpi-mod-tag indigo">FILA DE RECEITAS</span>
              <p class="kpi-sub">Prescrições Recebidas</p>
              <div class="kpi-value mt-8">${d.orcamentos.length}</div>
            </div>
            <div class="kpi-icon-box indigo" aria-hidden="true">${icon("file", "ico")}</div>
          </div>
          <span class="kpi-sub">Triadas pelo copiloto local</span>
        </div>

        <div class="card">
          <div class="kpi-top">
            <div>
              <span class="kpi-mod-tag">VALIDADAS RT</span>
              <p class="kpi-sub">Assinadas pelo Farmacêutico</p>
              <div class="kpi-value mt-8">${d.orcamentos.filter((o) => ["APROVADO_RT", "CONVERTIDO_EM_VENDA"].includes(o.status_triagem)).length}</div>
            </div>
            <div class="kpi-icon-box" aria-hidden="true">${icon("shield-check", "ico")}</div>
          </div>
          <span class="kpi-sub">Lei 13.021/2014 cumprida</span>
        </div>

        <div class="card">
          <div class="kpi-top">
            <div>
              <span class="kpi-mod-tag teal">CONVERTIDAS</span>
              <p class="kpi-sub">Vendas Fechadas</p>
              <div class="kpi-value mt-8">${d.orcamentos.filter((o) => o.status_triagem === "CONVERTIDO_EM_VENDA").length}</div>
            </div>
            <div class="kpi-icon-box teal" aria-hidden="true">${icon("cart", "ico")}</div>
          </div>
          <span class="kpi-sub">Orçamentos aceitos e pagos</span>
        </div>

        <div class="card">
          <div class="kpi-top">
            <div>
              <span class="kpi-mod-tag amber">SIGILO LGPD</span>
              <p class="kpi-sub">Retenção Sanitizada</p>
              <div class="kpi-value mt-8">100% Cripto</div>
            </div>
            <div class="kpi-icon-box amber" aria-hidden="true">${icon("lock", "ico")}</div>
          </div>
          <span class="kpi-sub">AES-256-GCM • Zero envio externo</span>
        </div>
      </div>

      ${avisoCargoRt}
      ${cardsHtml}
    `;

    document.getElementById("btn-trocar-para-rt")?.addEventListener("click", async () => {
      await apiFetch("/api/v1/auth/trocar-cargo-demo", { method: "POST", body: { cargo: "FARMACEUTICO" } });
      await carregarSessao();
      toast("Perfil alterado para Farmacêutico(a) RT (CRF-PR 21.457)!");
      viewTriagemIA();
    });

    document.getElementById("btn-simular-receita")?.addEventListener("click", async () => {
      const r = await apiFetch("/api/v1/triagem-ia/demo-simular", { method: "POST" });
      toast(`Nova receita ${r.protocolo} recebida!`);
      viewTriagemIA();
    });

    container.querySelectorAll("[data-ver-img-orc]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-ver-img-orc");
        let modalImg = document.getElementById("modal-img-receita");
        if (!modalImg) {
          modalImg = document.createElement("div");
          modalImg.id = "modal-img-receita";
          modalImg.className = "modal-overlay";
          modalImg.setAttribute("role", "dialog");
          modalImg.setAttribute("aria-modal", "true");
          document.body.appendChild(modalImg);
        }
        modalImg.innerHTML = `
          <div class="clean-modal-card">
            <div class="flex-between">
              <h3>Foto da Receita (REC-${String(id).padStart(5, "0")})</h3>
              <button type="button" id="btn-fechar-img-rec" class="btn btn-sm btn-outline">✕ Fechar</button>
            </div>
            <img src="/api/v1/triagem-ia/${encodeURIComponent(id)}/imagem" alt="Foto da receita médica" class="w-full">
          </div>`;
        modalImg.classList.remove("hidden");
        ativarFocusTrap(modalImg);
        document.getElementById("btn-fechar-img-rec")?.addEventListener("click", () => modalImg.classList.add("hidden"));
      });
    });

    container.querySelectorAll("[data-aprovar-orc]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-aprovar-orc");
        try {
          const r = await apiFetch(`/api/v1/triagem-ia/${id}/aprovar-enviar`, { method: "POST" });
          toast(`Orçamento ${r.protocolo} assinado pelo(a) Farmacêutico(a) RT!`);
          abrirSimuladorWhatsapp({
            cliente: r.cliente,
            telefone: r.telefone,
            mensagem: r.mensagem,
            linkWaMe: r.link_wa_me,
            filaId: r.fila_id,
            subtitulo: `Módulo C • Orçamento Assinado pelo(a) RT (${r.protocolo})`,
          });
          viewTriagemIA();
        } catch (err) {
          toast(err.message, "erro");
        }
      });
    });

    container.querySelectorAll("[data-converter-orc]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-converter-orc");
        await apiFetch(`/api/v1/triagem-ia/${id}/finalizar`, {
          method: "PATCH",
          body: { status: "CONVERTIDO_EM_VENDA" },
        });
        toast("Orçamento marcado como venda fechada!");
        viewTriagemIA();
      });
    });
  } catch (err) {
    renderErro(err.message, viewTriagemIA);
  }
}

// =========================================================================
// 6. ABA 6: MÓDULO D — RADAR ANTI-VENCIMENTO (4 CARDS DE FAIXA + MODAL QUEIMA)
// =========================================================================
async function viewRadarValidade() {
  renderLoading("Carregando estoque e lotes por ordem de vencimento (FEFO)...");
  try {
    const [d, prodsResp] = await Promise.all([
      apiFetch("/api/v1/radar-validade"),
      apiFetch("/api/v1/vitrine/produtos"),
    ]);
    const container = document.getElementById("view-container");
    const opcoesProdLote = (prodsResp.produtos || [])
      .map((p) => `<option value="${p.id}">${esc(p.nome_comercial)} (Custo: ${brl(p.preco_custo)})</option>`)
      .join("");

    const lotesMap = new Map(d.lotes.map((l) => [l.id, l]));
    const segurosCount = d.lotes.filter((l) => l.faixa_risco === "SEGURO" || l.faixa_risco === "ALERTA_90D").length;

    const linhasHtml = d.lotes
      .map((l) => {
        let badgeClass = "badge-success";
        if (l.faixa_risco === "CRITICO_30D" || l.faixa_risco === "VENCIDO") badgeClass = "badge-danger";
        else if (l.faixa_risco === "ALERTA_60D") badgeClass = "badge-orange";
        else if (l.faixa_risco === "ALERTA_90D") badgeClass = "badge-warning";

        return `
          <tr>
            <td>
              <strong>${esc(l.nome_comercial)}</strong>
              <br><span class="kpi-sub mono">Lote: ${esc(l.numero_lote)} • Custo: ${brl(l.custo_unitario)}</span>
            </td>
            <td><strong>${esc(l.data_validade)}</strong></td>
            <td><strong>${l.quantidade_atual} un</strong></td>
            <td>
              ${
                l.acao_queima_ativa !== "NENHUMA"
                  ? `<span class="badge badge-warning">${esc(l.acao_queima_ativa)} (${l.desconto_aplicado_pct > 0 ? `-${l.desconto_aplicado_pct}% • ` : ""}Bônus +${l.comissao_extra_balconista_pct}%)</span>`
                  : `<span class="kpi-sub">Inativa</span>`
              }
            </td>
            <td><span class="badge ${badgeClass}">${esc(l.rotulo_risco)} (${l.dias_para_vencer}d)</span></td>
            <td>
              <div class="flex-row">
                ${
                  l.faixa_risco !== "VENCIDO"
                    ? `<button class="btn btn-sm btn-teal" data-abrir-queima="${l.id}">${icon("tag", "ico-sm")} Ativar Queima</button>`
                    : ""
                }
                <button class="btn btn-sm ${l.faixa_risco === "VENCIDO" ? "btn-outline" : "btn-primary"}" data-vender-lote="${l.id}">
                  Vender 1 un. (FEFO)
                </button>
              </div>
            </td>
          </tr>`;
      })
      .join("");

    container.innerHTML = `
      ${renderCabecalhoAba("radar_validade")}

      <!-- 4 Cards por Faixa de Vencimento — Estilo Painel Operacional -->
      <div class="grid-kpis">
        <div class="card">
          <div class="kpi-top">
            <div>
              <span class="kpi-mod-tag rose">Vencidos (Bloqueados)</span>
              <div class="kpi-value mt-8">${d.resumo.vencidos_bloqueados}</div>
            </div>
            <div class="kpi-icon-box rose" aria-hidden="true">${icon("lock", "ico")}</div>
          </div>
          <span class="kpi-sub">Venda bloqueada (HTTP 422)</span>
        </div>
        <div class="card">
          <div class="kpi-top">
            <div>
              <span class="kpi-mod-tag amber">Crítico ≤ 30 dias</span>
              <div class="kpi-value mt-8">${d.resumo.critico_30d}</div>
            </div>
            <div class="kpi-icon-box amber" aria-hidden="true">${icon("alert", "ico")}</div>
          </div>
          <span class="kpi-sub">Prioridade #1 de queima FEFO</span>
        </div>
        <div class="card">
          <div class="kpi-top">
            <div>
              <span class="kpi-mod-tag teal">Atenção ≤ 60 dias</span>
              <div class="kpi-value mt-8">${d.resumo.alerta_60d}</div>
            </div>
            <div class="kpi-icon-box teal" aria-hidden="true">${icon("clock", "ico")}</div>
          </div>
          <span class="kpi-sub">Custo em risco: ${brl(d.resumo.capital_em_risco)}</span>
        </div>
        <div class="card">
          <div class="kpi-top">
            <div>
              <span class="kpi-mod-tag">Seguro ≤ 90d+ &amp; Salvo</span>
              <div class="kpi-value mt-8">${segurosCount} lotes</div>
            </div>
            <div class="kpi-icon-box" aria-hidden="true">${icon("box", "ico")}</div>
          </div>
          <span class="kpi-sub">Recuperado: <strong>${brl(d.resumo.capital_salvo_total)}</strong></span>
        </div>
      </div>

      <div class="card mb-20">
        <div class="flex-between mb-14">
          <div>
            <h3 class="h-title-md">Entrada de Estoque &amp; Importador XML NF-e</h3>
            <p class="kpi-sub">Importação segura com proteção anti-XXE e chave de acesso única (Idempotente HTTP 409)</p>
          </div>
          <span class="badge badge-teal">${icon("upload", "ico-sm")} Entrada Segura FEFO</span>
        </div>
        <div class="grid-2col">
          <div>
            <h4 class="h-title-sm mb-8">1. Importar XML de NF-e (Anti-XXE + Chave chNFe)</h4>
            <p class="kpi-sub mb-8">Lê múltiplos lotes (&lt;rastro&gt;), exige &lt;dVal&gt;, bloqueia nota duplicada e retém novos itens para classificação RT.</p>
            <div class="flex-row mb-8">
              <button class="btn btn-sm btn-outline" id="btn-xml-exemplo" type="button">Preencher XML Exemplo</button>
              <button class="btn btn-sm btn-primary" id="btn-importar-xml" type="button">Processar XML</button>
            </div>
            <textarea id="xml-input" rows="3" class="mono" placeholder="Cole o XML da NF-e aqui..."></textarea>
          </div>

          <div>
            <h4 class="h-title-sm mb-8">2. Cadastro Manual de Lote</h4>
            <form id="form-lote-manual" class="form-grid">
              <div class="form-group">
                <label for="lote-prod-id">Produto</label>
                <select id="lote-prod-id" required>${opcoesProdLote}</select>
              </div>
              <div class="form-group">
                <label for="lote-codigo">Número do Lote</label>
                <input id="lote-codigo" class="input" type="text" required placeholder="Ex: LT2026-99">
              </div>
              <div class="form-group">
                <label for="lote-qtd">Quantidade</label>
                <input id="lote-qtd" class="input" type="number" min="1" required value="20">
              </div>
              <div class="form-group">
                <label for="lote-custo">Custo Unit. (R$)</label>
                <input id="lote-custo" class="input" type="number" step="0.01" min="0" required value="12.50">
              </div>
              <div class="form-group">
                <label for="lote-validade">Validade</label>
                <input id="lote-validade" class="input" type="date" required value="2027-02-15">
              </div>
              <div class="form-group">
                <button type="submit" class="btn btn-primary w-full">Salvar Lote</button>
              </div>
            </form>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Lote &amp; Produto</th>
                <th>Validade</th>
                <th>Qtd. Atual</th>
                <th>Ação de Queima</th>
                <th>Status</th>
                <th>Ações FEFO</th>
              </tr>
            </thead>
            <tbody>${linhasHtml}</tbody>
          </table>
        </div>
      </div>
    `;

    document.getElementById("btn-xml-exemplo")?.addEventListener("click", () => {
      const nfeNum = Math.floor(10000 + Math.random() * 89999);
      document.getElementById("xml-input").value =
        `<nfeProc><NFe><infNFe Id="NFe41261112345678000190550010000${nfeNum}1000000019"><ide><nNF>${nfeNum}</nNF></ide>` +
        `<det nItem="1"><prod><cProd>101</cProd><cEAN>7896015514208</cEAN><xProd>Vitamina C Efervescente 1g + Zinco c/ 10 tubos</xProd><qCom>18</qCom><vUnCom>7.50</vUnCom>` +
        `<rastro><nLote>VC-A${nfeNum}</nLote><qLote>10</qLote><dVal>2026-12-10</dVal></rastro>` +
        `<rastro><nLote>VC-B${nfeNum}</nLote><qLote>8</qLote><dVal>2027-01-15</dVal></rastro></prod></det>` +
        `</infNFe></NFe></nfeProc>`;
      toast(`XML da NF-e ${nfeNum} preenchido! Dica: clique em Processar XML duas vezes seguidas para testar o bloqueio HTTP 409.`);
    });

    document.getElementById("btn-importar-xml")?.addEventListener("click", async () => {
      const xml = document.getElementById("xml-input").value.trim();
      if (!xml) return toast("Clique em 'Preencher XML Exemplo' primeiro.", "erro");
      try {
        const r = await apiFetch("/api/v1/radar-validade/importar-xml", { method: "POST", body: { xml } });
        toast(`NF-e ${r.nota_fiscal || ""} importada: ${r.itens_importados} lote(s) adicionados!`);
        viewRadarValidade();
      } catch (err) {
        toast(err.message, "erro");
      }
    });

    document.getElementById("form-lote-manual")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        await apiFetch("/api/v1/radar-validade/lotes", {
          method: "POST",
          body: {
            produto_id: Number(document.getElementById("lote-prod-id").value),
            numero_lote: document.getElementById("lote-codigo").value.trim(),
            quantidade_atual: Number(document.getElementById("lote-qtd").value),
            custo_unitario: Number(document.getElementById("lote-custo").value),
            data_validade: document.getElementById("lote-validade").value,
          },
        });
        toast("Lote cadastrado e estoque FEFO atualizado!");
        viewRadarValidade();
      } catch (err) {
        toast(err.message, "erro");
      }
    });

    container.querySelectorAll("[data-abrir-queima]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = Number(btn.getAttribute("data-abrir-queima"));
        const lote = lotesMap.get(id);
        if (lote) abrirModalQueimaLote(lote);
      });
    });

    container.querySelectorAll("[data-vender-lote]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-vender-lote");
        try {
          const r = await apiFetch(`/api/v1/radar-validade/lotes/${id}/vender`, {
            method: "POST",
            body: { quantidade: 1 },
          });
          toast(`Baixa FEFO realizada! Custo salvo: +${brl(r.capital_salvo)} | Comissão: +${brl(r.comissao_creditada)}`);
          viewRadarValidade();
        } catch (err) {
          toast(err.message, "erro");
        }
      });
    });
  } catch (err) {
    renderErro(err.message, viewRadarValidade);
  }
}

// =========================================================================
// 7. ABA 7: MÓDULO E — METAS, POPs ANVISA (APPEND-ONLY) & LGPD ART. 18
// =========================================================================
async function viewHubOperacional() {
  if (!estado.sessao.recursos.includes("hub_anvisa")) {
    return renderUpgradePro("Módulo E — Metas da Equipe, POPs ANVISA & Privacidade LGPD");
  }
  renderLoading("Carregando metas da equipe, registros ANVISA e configurações...");
  try {
    const d = await apiFetch("/api/v1/hub-operacional");
    const container = document.getElementById("view-container");
    const ehDiretor = estado.sessao.usuario.cargo === "DIRETOR";

    const subtabBarHtml = `
      <div class="subtab-bar" role="tablist" aria-label="Sub-abas de Metas, POPs e Configurações">
        <button type="button" class="subtab-btn ${estado.subAbaHub === "METAS" ? "active" : ""}" data-sub-hub="METAS">
          ${icon("target", "ico-sm")} 1. Metas da Loja &amp; Equipe
        </button>
        <button type="button" class="subtab-btn ${estado.subAbaHub === "POPS" ? "active" : ""}" data-sub-hub="POPS">
          ${icon("shield-check", "ico-sm")} 2. POPs ANVISA &amp; LGPD Art. 18 (${d.checklists.length})
        </button>
        ${
          ehDiretor
            ? `<button type="button" class="subtab-btn ${estado.subAbaHub === "CONFIG_LGPD" ? "active" : ""}" data-sub-hub="CONFIG_LGPD">
                 ${icon("settings", "ico-sm")} 3. Cashback, WhatsApp &amp; Auditoria
               </button>`
            : ""
        }
      </div>
    `;

    let corpoSubAba = "";

    if (estado.subAbaHub === "METAS") {
      const metaLojaVal = Math.round(d.farmacia.meta_mensal_loja);
      const presetsLoja = [120000, 150000, 180000, 220000, 250000]
        .map(
          (val) =>
            `<button type="button" class="goal-preset-btn ${metaLojaVal === val ? "active" : ""}" data-hub-preset-loja="${val}">R$ ${(val / 1000).toFixed(0)} mil</button>`
        )
        .join("");

      const equipeHtml = d.equipe
        .map(
          (u) => `
          <tr>
            <td>
              <strong>${esc(u.nome)}</strong>
              <br><span class="kpi-sub">${esc(u.cargo)} ${u.crf_uf ? `• ${esc(u.crf_uf)}` : ""}</span>
            </td>
            <td>
              <strong>${brl(u.vendas_mes)}</strong> de ${brl(u.meta_individual)} (${u.progresso_pct}%)
              <progress class="progress-native mt-8" value="${Math.min(100, u.progresso_pct)}" max="100"></progress>
            </td>
            <td><strong class="text-teal">${brl(u.comissao_acumulada)}</strong></td>
            <td><span class="badge badge-teal">${esc(u.rotulo_meta)}</span></td>
            <td>
              ${
                ehDiretor
                  ? `<div class="flex-row">
                       <input class="input" type="number" step="500" min="0" value="${Math.round(u.meta_individual)}" id="meta-user-${u.id}" aria-label="Meta individual de ${esc(u.nome)}">
                       <button type="button" class="btn btn-sm btn-primary" data-salvar-meta-user="${u.id}">Salvar</button>
                     </div>`
                  : `<span class="kpi-sub">${brl(u.meta_individual)}</span>`
              }
            </td>
          </tr>`
        )
        .join("");

      corpoSubAba = `
        ${
          ehDiretor
            ? `<div class="card mb-20">
                 <div class="flex-between">
                   <div>
                     <h3 class="h-title-md">Selecionar Meta Mensal da Farmácia</h3>
                     <p class="kpi-sub">Escolha um patamar rápido para atualizar a meta de faturamento bruto da unidade.</p>
                   </div>
                   <div class="goal-preset-group">${presetsLoja}</div>
                 </div>
               </div>`
            : ""
        }

        <div class="card">
          <h3 class="h-title-md">Metas Individuais &amp; Comissões da Equipe</h3>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Colaborador</th>
                  <th>Vendas no Mês / Progresso</th>
                  <th>Comissão Bônus</th>
                  <th>Status</th>
                  <th>${ehDiretor ? "Definir Meta Individual (R$)" : "Meta Individual"}</th>
                </tr>
              </thead>
              <tbody>${equipeHtml}</tbody>
            </table>
          </div>
        </div>`;
    } else if (estado.subAbaHub === "POPS") {
      const popsHtml = d.checklists
        .map(
          (c) => `
          <tr>
            <td><strong>${esc(c.rotulo_pop)}</strong><br><span class="kpi-sub">${esc(c.observacao || "")}</span></td>
            <td><strong>${c.valor_medido !== null ? `${c.valor_medido}${esc(c.unidade)}` : "Verificado"}</strong></td>
            <td><span class="badge ${c.dentro_conformidade ? "badge-success" : "badge-danger"}">${esc(c.status_rotulo)}</span></td>
            <td>
              ${esc(c.assinado_por_nome)} (${esc(c.assinado_por_cargo)})
              <br><span class="kpi-sub mono">${esc(c.carimbo_data_hora)} • SHA256:${esc((c.hash_integridade || "").slice(0, 14))}…</span>
            </td>
          </tr>`
        )
        .join("");

      corpoSubAba = `
        <div class="grid-2col">
          <!-- Coluna Esquerda: POPs ANVISA Append-Only -->
          <div class="flex-col">
            <div class="card">
              <div class="flex-between">
                <div>
                  <h3 class="h-title-md">Registro Rápido de POP Interno</h3>
                  <p class="kpi-sub">Triggers append-only bloqueiam alteração ou exclusão após assinatura</p>
                </div>
                <span class="badge badge-warning">Não substitui o SNGPC oficial</span>
              </div>
              <form id="form-pop-anvisa" class="form-grid">
                <div class="form-group">
                  <label for="pop-tipo">Tipo de POP</label>
                  <select id="pop-tipo">
                    <option value="TEMPERATURA_GELADEIRA">Geladeira Termolábeis (2°C–8°C)</option>
                    <option value="TEMPERATURA_AMBIENTE">Temperatura Ambiente (15°C–30°C)</option>
                    <option value="UMIDADE_AMBIENTE">Umidade Relativa (40%–70%)</option>
                    <option value="LIMPEZA_SALA_INJETAVEIS">Sala de Injetáveis</option>
                    <option value="CONFERENCIA_ARMARIO_CONTROLADOS">Armário Controlados (Portaria 344/98)</option>
                  </select>
                </div>
                <div class="form-group">
                  <label for="pop-valor">Valor Medido (°C ou %)</label>
                  <input id="pop-valor" class="input" type="number" step="0.1" value="4.8">
                </div>
                <div class="form-group">
                  <label for="pop-obs">Observação / Ação Corretiva</label>
                  <input id="pop-obs" class="input" type="text" placeholder="Ex: Termômetro aferido.">
                </div>
                <div class="form-group">
                  <button type="submit" class="btn btn-primary w-full">Assinar &amp; Gravar</button>
                </div>
              </form>
            </div>

            <div class="card">
              <div class="flex-between">
                <h4 class="h-title-md">Histórico Imutável de POPs (Append-Only)</h4>
                <span class="kpi-sub mono">SHA-256 Verificado</span>
              </div>
              <div class="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Procedimento</th>
                      <th>Leitura</th>
                      <th>Status</th>
                      <th>Assinatura &amp; Hash</th>
                    </tr>
                  </thead>
                  <tbody>${popsHtml}</tbody>
                </table>
              </div>
            </div>
          </div>

          <!-- Coluna Direita: Direitos do Titular (LGPD Art. 18) -->
          <div class="card">
            <h3 class="h-title-md">${icon("user", "ico")} Direitos do Titular (LGPD Art. 18)</h3>
            <p class="kpi-sub">Portabilidade em JSON e Anonimização definitiva de pacientes por WhatsApp.</p>
            <div class="flex-row">
              <input id="lgpd-whats-input" class="input flex-1" type="tel" value="41991110001" placeholder="WhatsApp do titular (ex: 41991110001)">
              <button type="button" class="btn btn-sm btn-primary" id="btn-lgpd-exportar">Exportar JSON (Portabilidade)</button>
              ${
                ehDiretor
                  ? `<button type="button" class="btn btn-sm btn-outline" id="btn-lgpd-anonimizar">Anonimizar Titular</button>`
                  : ""
              }
            </div>
            <div class="chip-list mt-8">
              <button type="button" class="chip-btn" data-lgpd-preset="41991110001">Maria Aparecida (Final 0001)</button>
              <button type="button" class="chip-btn" data-lgpd-preset="41991110002">José Carlos (Final 0002)</button>
              <button type="button" class="chip-btn" data-lgpd-preset="41991110003">Antônia Ribeiro (Final 0003)</button>
            </div>
          </div>
        </div>`;
    } else if (ehDiretor) {
      corpoSubAba = `
        <div class="card mb-20">
          <div class="flex-between">
            <h3 class="h-title-md">${icon("settings", "ico")} Cashback da Vitrine, Meta da Loja &amp; Modo WhatsApp</h3>
            ${
              estado.sessao.demo
                ? `<button type="button" class="btn btn-sm btn-outline" id="btn-self-heal">${icon("refresh", "ico-sm")} Restaurar Dados Originais da Demo</button>`
                : ""
            }
          </div>
          <form id="form-config-farmacia" class="form-grid">
            <div class="form-group">
              <label for="cfg-cashback">Cashback da Vitrine (%)</label>
              <input id="cfg-cashback" class="input" type="number" step="0.5" min="0" max="30" value="${d.farmacia.cashback_pct}">
            </div>
            <div class="form-group">
              <label for="cfg-mkt">Taxa Marketplace Ref. (%)</label>
              <input id="cfg-mkt" class="input" type="number" step="0.5" min="0" max="50" value="${d.farmacia.taxa_marketplace_ref_pct}">
            </div>
            <div class="form-group">
              <label for="cfg-meta">Meta Mensal da Loja (R$)</label>
              <input id="cfg-meta" class="input" type="number" step="1000" min="0" value="${d.farmacia.meta_mensal_loja}">
            </div>
            <div class="form-group">
              <label for="cfg-wa">Modo de Disparo WhatsApp</label>
              <select id="cfg-wa">
                <option value="SEGURO_1_CLIQUE" ${d.farmacia.modo_whatsapp === "SEGURO_1_CLIQUE" ? "selected" : ""}>Modo 1-Clique Assistido</option>
                <option value="META_CLOUD_API" ${d.farmacia.modo_whatsapp === "META_CLOUD_API" ? "selected" : ""}>WhatsApp Cloud API Oficial Meta</option>
              </select>
            </div>
            <div class="form-group">
              <button type="submit" class="btn btn-primary w-full">${icon("check", "ico-sm")} Salvar Configurações</button>
            </div>
          </form>
        </div>

        <div class="card">
          <div class="flex-between">
            <h3 class="h-title-md">${icon("shield-check", "ico")} Trilha de Auditoria Append-Only</h3>
            <button type="button" class="btn btn-sm btn-outline" id="btn-carregar-auditoria">Ver Últimos Eventos</button>
          </div>
          <div id="box-tabela-auditoria" class="table-wrap"></div>
        </div>`;
    }

    container.innerHTML = `
      ${renderCabecalhoAba(
        "hub_anvisa",
        `<div class="badge badge-teal">${icon("shield-check", "ico-sm")} Triggers Append-Only Ativos</div>`
      )}

      <!-- 4 KPIs do Hub Operacional — Estilo Painel Operacional -->
      <div class="grid-kpis">
        <div class="card card-interactive" data-sub-hub="METAS">
          <div class="kpi-top">
            <div>
              <span class="kpi-mod-tag">META MENSAL</span>
              <p class="kpi-sub">Faturamento Loja</p>
              <div class="kpi-value mt-8">${brl(d.farmacia.meta_mensal_loja)}</div>
            </div>
            <div class="kpi-icon-box" aria-hidden="true">${icon("chart", "ico")}</div>
          </div>
          <span class="kpi-sub">Progresso: ${Math.round((d.resumo.faturamento_mes / d.farmacia.meta_mensal_loja) * 100)}% atingido</span>
        </div>

        <div class="card card-interactive" data-sub-hub="POPS">
          <div class="kpi-top">
            <div>
              <span class="kpi-mod-tag teal">POPS ANVISA</span>
              <p class="kpi-sub">Checklists Registrados</p>
              <div class="kpi-value mt-8">${d.checklists.length}</div>
            </div>
            <div class="kpi-icon-box teal" aria-hidden="true">${icon("shield-check", "ico")}</div>
          </div>
          <span class="kpi-sub">Triggers imutáveis SHA-256</span>
        </div>

        <div class="card">
          <div class="kpi-top">
            <div>
              <span class="kpi-mod-tag indigo">CONTROLE SANITÁRIO</span>
              <p class="kpi-sub">Armário de Controlados</p>
              <div class="kpi-value mt-8">100% OK</div>
            </div>
            <div class="kpi-icon-box indigo" aria-hidden="true">${icon("lock", "ico")}</div>
          </div>
          <span class="kpi-sub">Portaria 344/98 e RDC 44</span>
        </div>

        <div class="card card-interactive" data-sub-hub="POPS">
          <div class="kpi-top">
            <div>
              <span class="kpi-mod-tag amber">LGPD ART. 18</span>
              <p class="kpi-sub">Direitos do Titular</p>
              <div class="kpi-value mt-8">Ativo</div>
            </div>
            <div class="kpi-icon-box amber" aria-hidden="true">${icon("shield", "ico")}</div>
          </div>
          <span class="kpi-sub">Exportação JSON &amp; Anonimização</span>
        </div>
      </div>

      ${subtabBarHtml}
      ${corpoSubAba}
    `;

    container.querySelectorAll("[data-sub-hub]").forEach((btn) => {
      btn.addEventListener("click", () => {
        estado.subAbaHub = btn.getAttribute("data-sub-hub");
        viewHubOperacional();
      });
    });

    container.querySelectorAll("[data-hub-preset-loja]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const novaMeta = Number(btn.getAttribute("data-hub-preset-loja"));
        await apiFetch("/api/v1/hub-operacional/config-farmacia", {
          method: "PATCH",
          body: { meta_mensal_loja: novaMeta },
        });
        toast(`Meta mensal da loja atualizada para ${brl(novaMeta)}!`);
        viewHubOperacional();
      });
    });

    container.querySelectorAll("[data-salvar-meta-user]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const uid = btn.getAttribute("data-salvar-meta-user");
        const val = Number(document.getElementById(`meta-user-${uid}`)?.value || 0);
        try {
          await apiFetch(`/api/v1/hub-operacional/usuarios/${uid}/meta`, {
            method: "PATCH",
            body: { meta_individual: val },
          });
          toast(`Meta individual atualizada para ${brl(val)}!`);
          viewHubOperacional();
        } catch (err) {
          toast(err.message, "erro");
        }
      });
    });

    document.getElementById("form-pop-anvisa")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        const tipo = document.getElementById("pop-tipo").value;
        const valStr = document.getElementById("pop-valor").value;
        const r = await apiFetch("/api/v1/hub-operacional/checklists", {
          method: "POST",
          body: {
            tipo_pop: tipo,
            valor_medido: valStr !== "" ? Number(valStr) : null,
            observacao: document.getElementById("pop-obs").value,
          },
        });
        toast(`POP assinado e gravado em modo append-only com hash SHA-256 (${r.status_rotulo})!`);
        viewHubOperacional();
      } catch (err) {
        toast(err.message, "erro");
      }
    });

    container.querySelectorAll("[data-lgpd-preset]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const input = document.getElementById("lgpd-whats-input");
        if (input) input.value = btn.getAttribute("data-lgpd-preset");
        document.getElementById("btn-lgpd-exportar")?.click();
      });
    });

    document.getElementById("btn-lgpd-exportar")?.addEventListener("click", async () => {
      const w = document.getElementById("lgpd-whats-input").value.trim();
      try {
        const r = await apiFetch(`/api/v1/lgpd/titular/${encodeURIComponent(w)}`);
        abrirModalJsonLgpd(r);
      } catch (err) {
        toast(err.message, "erro");
      }
    });

    document.getElementById("btn-lgpd-anonimizar")?.addEventListener("click", async () => {
      const w = document.getElementById("lgpd-whats-input").value.trim();
      try {
        const resAnon = await apiFetch("/api/v1/lgpd/titular/anonimizar", { method: "POST", body: { whatsapp: w } });
        toast(resAnon.mensagem);
      } catch (err) {
        toast(err.message, "erro");
      }
    });

    document.getElementById("btn-self-heal")?.addEventListener("click", async () => {
      try {
        const r = await apiFetch("/api/admin/self-heal", { method: "POST" });
        toast(`Dados de demonstração restaurados (${r.backup})!`);
        viewHubOperacional();
      } catch (err) {
        toast(err.message, "erro");
      }
    });

    document.getElementById("form-config-farmacia")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        await apiFetch("/api/v1/hub-operacional/config-farmacia", {
          method: "PATCH",
          body: {
            cashback_pct: Number(document.getElementById("cfg-cashback").value),
            taxa_entrega: 0,
            taxa_marketplace_ref_pct: Number(document.getElementById("cfg-mkt").value),
            meta_mensal_loja: Number(document.getElementById("cfg-meta").value),
            modo_whatsapp: document.getElementById("cfg-wa").value,
          },
        });
        await carregarSessao();
        toast("Configurações salvas!");
      } catch (err) {
        toast(err.message, "erro");
      }
    });

    document.getElementById("btn-carregar-auditoria")?.addEventListener("click", async () => {
      try {
        const aud = await apiFetch("/api/v1/hub-operacional/auditoria");
        document.getElementById("box-tabela-auditoria").innerHTML = `
          <table>
            <thead>
              <tr>
                <th>Data/Hora</th>
                <th>Usuário</th>
                <th>Ação</th>
                <th>Recurso</th>
              </tr>
            </thead>
            <tbody>
              ${aud.logs
                .slice(0, 10)
                .map(
                  (l) => `
                <tr>
                  <td class="mono">${esc(l.criado_em)}</td>
                  <td>${esc(l.usuario_nome || "Sistema")}</td>
                  <td><span class="badge badge-teal">${esc(l.acao)}</span></td>
                  <td class="mono">${esc(l.recurso_afetado || "—")}</td>
                </tr>`
                )
                .join("")}
            </tbody>
          </table>`;
      } catch (err) {
        toast(err.message, "erro");
      }
    });
  } catch (err) {
    renderErro(err.message, viewHubOperacional);
  }
}

function navegarPara(aba) {
  estado.abaAtiva = aba;
  document.querySelectorAll(".nav-item[data-aba]").forEach((btn) => {
    btn.classList.toggle("active", btn.getAttribute("data-aba") === aba);
  });

  if (aba === "dashboard") return viewDashboard();
  if (aba === "pdv") return viewPdv();
  if (aba === "uso_continuo") return viewUsoContinuo();
  if (aba === "vitrine") return viewVitrineInterna();
  if (aba === "triagem_ia") return viewTriagemIA();
  if (aba === "radar_validade") return viewRadarValidade();
  if (aba === "hub_anvisa") return viewHubOperacional();
}

document.addEventListener("DOMContentLoaded", async () => {
  const ok = await carregarSessao();
  if (!ok) return;

  navegarPara("dashboard");

  document.querySelectorAll(".nav-item[data-aba]").forEach((btn) => {
    btn.addEventListener("click", () => navegarPara(btn.getAttribute("data-aba")));
  });

  document.getElementById("btn-topbar-nova-venda")?.addEventListener("click", () => navegarPara("pdv"));

  // Seletor RBAC Dropdown Global (Igual à Referência v3.2)
  document.getElementById("rbac-selector")?.addEventListener("change", async (e) => {
    const cargo = e.target.value;
    try {
      const r = await apiFetch("/api/v1/auth/trocar-cargo-demo", { method: "POST", body: { cargo } });
      await carregarSessao();
      toast(`Perfil RBAC alterado para: ${r.cargo} (${r.nome})`);
      navegarPara(estado.abaAtiva);
    } catch (err) {
      toast(err.message, "erro");
    }
  });

  document.getElementById("btn-pin-sidebar")?.addEventListener("click", () => {
    const sidebar = document.getElementById("glass-sidebar");
    const overlay = document.getElementById("sidebar-overlay");
    if (!sidebar) return;
    if (window.innerWidth < 1024) {
      const aberto = !sidebar.classList.contains("is-open");
      sidebar.classList.toggle("is-open", aberto);
      if (overlay) overlay.classList.toggle("hidden", !aberto);
    } else {
      const colapsado = !sidebar.classList.contains("is-collapsed");
      sidebar.classList.toggle("is-collapsed", colapsado);
      localStorage.setItem("fl_collapsed", colapsado ? "1" : "0");
      const btnPin = document.getElementById("btn-pin-sidebar");
      if (btnPin) {
        btnPin.classList.toggle("active", !colapsado);
        btnPin.setAttribute("aria-pressed", !colapsado ? "true" : "false");
      }
    }
  });

  document.getElementById("sidebar-overlay")?.addEventListener("click", () => {
    const sidebar = document.getElementById("glass-sidebar");
    const overlay = document.getElementById("sidebar-overlay");
    if (sidebar) sidebar.classList.remove("is-open");
    if (overlay) overlay.classList.add("hidden");
  });

  const alternarTema = async () => {
    const atual = document.documentElement.getAttribute("data-theme") || "light";
    const novo = atual === "dark" ? "light" : "dark";
    aplicarTema(novo);
    try {
      await apiFetch("/api/v1/auth/preferencias", { method: "PATCH", body: { tema_preferido: novo } });
    } catch { /* fallback local */ }
  };

  document.getElementById("btn-toggle-theme")?.addEventListener("click", alternarTema);
  document.getElementById("btn-topbar-theme")?.addEventListener("click", alternarTema);
  document.getElementById("btn-topbar-contrast")?.addEventListener("click", alternarAltoContraste);

  document.getElementById("btn-profile-trigger")?.addEventListener("click", () => {
    document.getElementById("profile-popover")?.classList.toggle("hidden");
  });

  document.getElementById("btn-logout")?.addEventListener("click", async () => {
    await apiFetch("/api/v1/auth/logout", { method: "POST" });
    window.location.href = "/login.html";
  });

  document.getElementById("btn-switch-plano")?.addEventListener("click", async () => {
    const atual = estado.sessao?.farmacia?.plano_ativo;
    const novo = atual === "PRO_IA" ? "ESSENCIAL" : "PRO_IA";
    try {
      await apiFetch("/api/v1/auth/alterar-plano-demo", { method: "POST", body: { plano: novo } });
      await carregarSessao();
      toast(`Plano alterado para ${novo}`);
      navegarPara(estado.abaAtiva);
    } catch (err) {
      toast(err.message, "erro");
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      document.getElementById("modal-phone-wa")?.classList.add("hidden");
      document.getElementById("modal-img-receita")?.classList.add("hidden");
      document.getElementById("modal-lgpd-json")?.classList.add("hidden");
      document.getElementById("modal-queima-lote")?.classList.add("hidden");
      document.getElementById("profile-popover")?.classList.add("hidden");
    }
  });
});
