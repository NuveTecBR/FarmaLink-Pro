// Hub Showroom Comercial (index.html) — Calculadora de ROI com Premissas Editáveis e Cenário Conservador
import { apiFetch, alternarAltoContraste, aplicarTema, brl, carregarTemaInicial } from "./auth.js";

carregarTemaInicial();

function recalcularROI() {
  const pacDia = Number(document.getElementById("calc-continuo")?.value || 10);
  const delMes = Number(document.getElementById("calc-ifood")?.value || 30000);
  const valMes = Number(document.getElementById("calc-validade")?.value || 2500);

  const ticketMedio = Number(document.getElementById("prem-ticket")?.value || 55);
  const taxaConversaoPct = Number(document.getElementById("prem-conversao")?.value || 25);
  const taxaMktPct = Number(document.getElementById("prem-taxa-mkt")?.value || 18);

  document.getElementById("lbl-continuo-val").textContent = `${pacDia} pacientes/dia`;
  document.getElementById("lbl-ifood-val").textContent = brl(delMes);
  document.getElementById("lbl-validade-val").textContent = brl(valMes);

  // 1) Faturamento Bruto Estimado de Recompras (26 dias úteis * conversão editável * ticket médio editável)
  const faturamentoContinuo = Math.round(pacDia * 26 * (taxaConversaoPct / 100) * ticketMedio);
  // 2) Custo de Comissão de Marketplace Terceiro Evitado (taxa editável)
  const custoMktEvitado = Math.round(delMes * (taxaMktPct / 100));
  // 3) Custo de Estoque Recuperado antes do Vencimento (cenário conservador: 60% escoado a tempo)
  const custoEstoqueSalvo = Math.round(valMes * 0.6);

  document.getElementById("res-continuo").textContent = `${brl(faturamentoContinuo)}/mês (Faturamento bruto)`;
  document.getElementById("res-ifood").textContent = `${brl(custoMktEvitado)}/mês (Custo evitado)`;
  document.getElementById("res-validade").textContent = `${brl(custoEstoqueSalvo)}/mês (Custo recuperado)`;

  const beneficioCaixaMes = custoMktEvitado + custoEstoqueSalvo;
  document.getElementById("res-total-mes").textContent = `${brl(beneficioCaixaMes)}/mês em economia direta + ${brl(faturamentoContinuo)}/mês em recompras`;
  document.getElementById("res-total-ano").textContent =
    `Projeção anual ilustrativa (12 meses): ${brl(beneficioCaixaMes * 12)} em custos poupados e ${brl(faturamentoContinuo * 12)} em vendas recorrentes`;
}

document.addEventListener("DOMContentLoaded", async () => {
  recalcularROI();

  try {
    const cfg = await apiFetch("/api/v1/public/config");
    document.querySelectorAll("[data-link-demo-recompra]").forEach((a) => {
      if (cfg.demo && cfg.token_demo_recompra) {
        a.href = `/recompra.html?t=${encodeURIComponent(cfg.token_demo_recompra)}`;
      } else {
        a.classList.add("hidden");
      }
    });
  } catch { /* modo produção silencioso */ }

  ["calc-continuo", "calc-ifood", "calc-validade", "prem-ticket", "prem-conversao", "prem-taxa-mkt"].forEach((id) => {
    document.getElementById(id)?.addEventListener("input", recalcularROI);
  });

  document.getElementById("btn-hub-theme")?.addEventListener("click", () => {
    const atual = document.documentElement.getAttribute("data-theme") || "dark";
    aplicarTema(atual === "dark" ? "light" : "dark");
  });

  document.getElementById("btn-hub-contrast")?.addEventListener("click", alternarAltoContraste);

  document.querySelectorAll("[data-enter-cargo]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const cargo = btn.getAttribute("data-enter-cargo");
      btn.disabled = true;
      try {
        await apiFetch("/api/v1/auth/demo-login", { method: "POST", body: { cargo } });
        window.location.href = "/painel.html";
      } catch {
        window.location.href = "/login.html";
      }
    });
  });
});
