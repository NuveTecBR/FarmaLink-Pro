// Página Pública de Recompra 1-Clique (Verificação de 4 Dígitos do Telefone, Validação RT p/ Tarjados e Zero Inline Styles)
import { alternarAltoContraste, apiFetch, aplicarTema, brl, carregarTemaInicial, esc, toast } from "./auth.js";

carregarTemaInicial();

let dadosToken = null;
let tokenAtual = "";
let ultimos4Verificados = "";
let nivelFonte = Number(localStorage.getItem("fl_font_level") || 0);

function aplicarNivelFonte(nivel) {
  nivelFonte = nivel % 3;
  document.documentElement.classList.toggle("font-large", nivelFonte === 1);
  document.documentElement.classList.toggle("font-xlarge", nivelFonte === 2);
  localStorage.setItem("fl_font_level", String(nivelFonte));
  const btn = document.getElementById("btn-font-toggle");
  if (btn) {
    const rotulos = ["Aumentar Letra (A+)", "Letra Extra Grande (A++)", "Voltar Letra Padrão (A)"];
    btn.textContent = rotulos[nivelFonte];
  }
}

function atualizarSimulacaoTotal() {
  if (!dadosToken) return;
  const qtd = Number(document.getElementById("rec-qtd")?.value || 1);
  const usarCb = document.getElementById("rec-usar-cb")?.checked && dadosToken.saldo_cashback > 0;
  const subtotal = dadosToken.preco * qtd;
  const tetoCb = subtotal * 0.3;
  const desconto = usarCb ? Math.min(dadosToken.saldo_cashback, tetoCb, subtotal) : 0;
  const total = subtotal - desconto;

  const box = document.getElementById("rec-calculo-vivo");
  if (box) {
    box.innerHTML = `
      <div>${qtd}x ${esc(dadosToken.produto)}: <strong>${brl(subtotal)}</strong> • Retirada na Loja: <strong>Grátis (Sem Fila)</strong></div>
      ${desconto > 0 ? `<div class="text-orange-strong">Desconto do seu Cashback (teto 30%): <strong>- ${brl(desconto)}</strong></div>` : ""}
      <div class="text-teal-strong">Total Final na Retirada: <strong>${brl(total)}</strong></div>
    `;
  }
}

async function carregarRecompra(ultimos4 = "") {
  const params = new URLSearchParams(window.location.search);
  tokenAtual = params.get("t") || "";
  if (!tokenAtual) {
    try {
      const cfg = await apiFetch("/api/v1/public/config");
      if (cfg.demo && cfg.token_demo_recompra) {
        tokenAtual = cfg.token_demo_recompra;
      }
    } catch { /* sem token demo */ }
  }
  const box = document.getElementById("recompra-card");
  if (!tokenAtual) {
    box.innerHTML = `
      <h2>Link de recompra ausente ou incompleto</h2>
      <p>Acesse o link enviado pela sua farmácia no WhatsApp ou visite a Vitrine Digital Sênior.</p>
      <a href="/vitrine.html" class="btn btn-teal">Ir para a Vitrine da Farmácia</a>`;
    return;
  }

  try {
    const query = ultimos4 ? `?ultimos4=${encodeURIComponent(ultimos4)}` : "";
    const d = await apiFetch(`/api/v1/public/recompra/${encodeURIComponent(tokenAtual)}${query}`);
    dadosToken = d;
    document.getElementById("recompra-loja-nome").textContent = d.farmacia.nome_fantasia;

    if (d.farmacia.telefone_whatsapp) {
      const btnAt = document.getElementById("btn-recompra-atendente");
      if (btnAt) {
        const num = String(d.farmacia.telefone_whatsapp).replace(/\D/g, "");
        const e164 = num.length <= 11 ? `55${num}` : num;
        btnAt.href = `https://wa.me/${e164}?text=${encodeURIComponent("Olá! Preciso de ajuda com a recompra do meu medicamento.")}`;
      }
    }

    if (d.farmacia.razao_social) {
      document.getElementById("footer-razao").textContent = `${d.farmacia.razao_social} — CNPJ: ${d.farmacia.cnpj}`;
      document.getElementById("footer-endereco").textContent = `${d.farmacia.endereco_completo} • ${d.farmacia.afe_anvisa || ""}`;
      document.getElementById("footer-rt").textContent = `Farmacêutico(a) RT: ${d.farmacia.farmaceutico_rt_nome} (${d.farmacia.farmaceutico_rt_crf})`;
      document.getElementById("footer-dpo").textContent = `SAC: ${d.farmacia.telefone_sac || "0800-770-4100"} • Encarregado de Dados (DPO): ${d.farmacia.dpo_email}`;
    }

    if (!d.ativo) {
      box.innerHTML = `
        <div class="recompra-header-box">
          <span class="badge badge-teal">REPOSIÇÃO JÁ SOLICITADA</span>
        </div>
        <h2>Olá, ${esc(d.cliente_primeiro_nome)}! Seu pedido já foi registrado.</h2>
        <p>A sua solicitação de reposição já foi recebida pela farmácia e o próximo ciclo de lembrete foi agendado.</p>
        <div class="flex-row mt-10">
          <a href="/vitrine.html" class="btn btn-teal">Visitar Vitrine da Farmácia</a>
          <a href="/painel.html" class="btn btn-outline">Voltar ao Painel da Farmácia</a>
        </div>`;
      return;
    }

    document.getElementById("rec-saudacao").textContent = `Olá, ${d.cliente_primeiro_nome}! Tudo bem com você?`;
    const input4 = document.getElementById("rec-ultimos4");
    if (d.dica_demo_ultimos4 && input4 && !input4.value) {
      input4.value = d.dica_demo_ultimos4;
      if (!ultimos4) {
        ultimos4Verificados = d.dica_demo_ultimos4;
        return carregarRecompra(d.dica_demo_ultimos4);
      }
    }

    document.getElementById("rec-produto-nome").textContent = d.produto;
    document.getElementById("rec-preco-unit").textContent = `Preço unitário: ${brl(d.preco)} (Caixa p/ ${d.duracao_dias} dias)${
      d.exige_receita ? " • Sujeito a validação do(a) Farmacêutico(a) RT (RDC 44/2009)" : ""
    }`;
    document.getElementById("rec-end-atual").textContent = d.local_retirada || d.farmacia?.endereco_completo || "Balcão da Farmácia (Retirada Rápida Sem Fila)";

    const cbBox = document.getElementById("box-cashback-token");
    if (d.verificado && d.saldo_cashback > 0) {
      cbBox.classList.remove("hidden");
      document.getElementById("lbl-saldo-cb").textContent = `Usar meu saldo de Cashback (${brl(d.saldo_cashback)}) para desconto imediato`;
    } else {
      cbBox.classList.add("hidden");
    }

    atualizarSimulacaoTotal();
  } catch (err) {
    box.innerHTML = `
      <h2>${esc(err.message)}</h2>
      <p>Você também pode falar diretamente com um atendente humano ou acessar a Vitrine Digital Sênior.</p>
      <a href="/vitrine.html" class="btn btn-teal">Ir para a Vitrine da Farmácia</a>`;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  aplicarNivelFonte(nivelFonte);
  carregarRecompra();

  document.getElementById("btn-topbar-theme")?.addEventListener("click", () => {
    const atual = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    aplicarTema(atual);
  });

  document.getElementById("btn-font-toggle")?.addEventListener("click", () => {
    aplicarNivelFonte(nivelFonte + 1);
  });

  document.getElementById("btn-contrast-toggle")?.addEventListener("click", alternarAltoContraste);

  document.getElementById("btn-validar-4digitos")?.addEventListener("click", () => {
    const val = document.getElementById("rec-ultimos4")?.value.trim() || "";
    if (!/^\d{4}$/.test(val)) {
      return toast("Digite exatamente os 4 últimos números do seu WhatsApp.", "erro");
    }
    ultimos4Verificados = val;
    carregarRecompra(val);
  });

  document.getElementById("rec-qtd")?.addEventListener("change", atualizarSimulacaoTotal);
  document.getElementById("rec-usar-cb")?.addEventListener("change", atualizarSimulacaoTotal);

  document.getElementById("form-confirmar-recompra")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const ultimos4 = document.getElementById("rec-ultimos4")?.value.trim() || ultimos4Verificados;
    try {
      const r = await apiFetch(`/api/v1/public/recompra/${encodeURIComponent(tokenAtual)}/confirmar`, {
        method: "POST",
        body: {
          ultimos4_telefone: ultimos4,
          quantidade: Number(document.getElementById("rec-qtd").value),
          forma_pagamento: document.getElementById("rec-pag").value,
          usar_cashback: document.getElementById("rec-usar-cb")?.checked || false,
        },
      });
      document.getElementById("recompra-card").innerHTML = `
        <div class="recompra-header-box">
          <span class="badge badge-teal">RESERVA ${esc(r.codigo_pedido)} REGISTRADA!</span>
        </div>
        <h2>${r.exige_validacao_rt ? "Encaminhado para Validação do(a) Farmacêutico(a) RT" : "Sua reserva entrou em separação para retirada rápida no balcão!"}</h2>
        <div class="sacola-resumo-box">
          <div>Item Reservado: <strong>${esc(dadosToken.produto)}</strong></div>
          <div>Local de Retirada: <strong>Balcão da Farmácia (Sem Fila e Sem Taxa)</strong></div>
          ${r.cashback_usado > 0 ? `<div class="text-orange-strong">Cashback descontado: <strong>- ${brl(r.cashback_usado)}</strong></div>` : ""}
          <div class="text-teal-strong">Total a Pagar na Retirada: <strong>${brl(r.total)}</strong></div>
          ${r.aviso_regulatorio ? `<div class="aviso-simulado-box mt-10">${esc(r.aviso_regulatorio)}</div>` : ""}
          ${r.chave_pix_simulada ? `<div class="aviso-simulado-box mt-10">Chave PIX CNPJ (Simulada p/ Demo): <strong>${esc(r.chave_pix_simulada)}</strong></div>` : ""}
        </div>
        <div class="flex-row mt-10">
          <a href="/vitrine.html" class="btn btn-teal">Ver Outros Produtos da Vitrine</a>
          <a href="/painel.html" class="btn btn-outline">Ver Reserva no Painel da Farmácia</a>
        </div>`;
      toast("Reserva para retirada confirmada com sucesso!");
    } catch (err) {
      toast(err.message, "erro");
    }
  });
});
