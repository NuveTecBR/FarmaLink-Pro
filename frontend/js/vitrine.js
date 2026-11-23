// Vitrine Digital Pública Sênior 60+ (Zero inline styles, Escala 18/21/24px em REM, Alto Contraste, Focus Trap e ANVISA RDC 44/2009)
import {
  alternarAltoContraste,
  apiFetch,
  ativarFocusTrap,
  brl,
  carregarTemaInicial,
  esc,
  icon,
  inicializarCookieBanner,
  toast,
} from "./auth.js";

carregarTemaInicial();

const estado = {
  farmacia: null,
  produtos: [],
  carrinho: new Map(),
  categoriaFiltro: "TODAS",
  busca: "",
  nivelFonte: Number(localStorage.getItem("fl_font_level") || 0), // 0 = 18px, 1 = 21px (A+), 2 = 24px (A++)
};

function aplicarNivelFonte(nivel) {
  estado.nivelFonte = nivel % 3;
  document.documentElement.classList.toggle("font-large", estado.nivelFonte === 1);
  document.documentElement.classList.toggle("font-xlarge", estado.nivelFonte === 2);
  localStorage.setItem("fl_font_level", String(estado.nivelFonte));
  const btn = document.getElementById("btn-font-toggle");
  if (btn) {
    const rotulos = ["Aumentar Letra (A+)", "Letra Extra Grande (A++)", "Voltar Letra Padrão (A)"];
    btn.textContent = rotulos[estado.nivelFonte];
  }
}

async function carregarCatalogo() {
  try {
    const d = await apiFetch("/api/v1/public/vitrine");
    estado.farmacia = d.farmacia;
    estado.produtos = d.produtos;
    preencherDadosFarmacia(d.farmacia);
    renderizarProdutos();
  } catch (err) {
    document.getElementById("produtos-grid").innerHTML = `<div class="produto-card"><strong>Erro ao carregar vitrine:</strong><p>${esc(err.message)}</p></div>`;
  }
}

function preencherDadosFarmacia(f) {
  document.getElementById("loja-nome-header").textContent = f.nome_fantasia;
  document.getElementById("loja-sub-header").textContent = `Reserva & Retirada na Loja (Sem Fila) • ${f.cashback_pct}% de Cashback • ${f.horario_funcionamento}`;
  const pillCbTit = document.getElementById("pill-cashback-titulo");
  if (pillCbTit) pillCbTit.textContent = `${f.cashback_pct}% de Cashback (Validade 90d)`;
  const pillCbSub = document.getElementById("pill-cashback-sub");
  if (pillCbSub) pillCbSub.textContent = `Abate até ${f.cashback_teto_pedido_pct || 30}% do próximo pedido`;
  const pillRt = document.getElementById("pill-rt-sub");
  if (pillRt) pillRt.textContent = `${f.farmaceutico_rt_nome} (${f.farmaceutico_rt_crf})`;
  const stripTxt = document.getElementById("demo-strip-texto");
  if (stripTxt) {
    stripTxt.innerHTML = `<strong>Experiência do Cliente Final (Sênior 60+ WCAG 2.1 AA)</strong> — Canal próprio da farmácia com ${esc(f.cashback_pct)}% de Cashback local`;
  }
  document.getElementById("footer-razao").textContent = `${f.razao_social} — CNPJ: ${f.cnpj}`;
  document.getElementById("footer-licencas").textContent = `${f.afe_anvisa} • ${f.licenca_sanitaria}`;
  document.getElementById("footer-endereco").textContent = `${f.endereco_completo} • Horário: ${f.horario_funcionamento}`;
  document.getElementById("footer-rt").textContent = `Farmacêutico(a) Responsável Técnico(a): ${f.farmaceutico_rt_nome} (${f.farmaceutico_rt_crf})`;
  document.getElementById("footer-dpo").textContent = `SAC: ${f.telefone_sac} • Encarregado de Dados (DPO / LGPD): ${f.dpo_email}`;

  const btnHumano = document.getElementById("btn-atendente-humano");
  if (btnHumano && f.telefone_whatsapp) {
    const num = String(f.telefone_whatsapp).replace(/\D/g, "");
    const e164 = num.length <= 11 ? `55${num}` : num;
    btnHumano.href = `https://wa.me/${e164}?text=${encodeURIComponent("Olá! Preciso de ajuda de um atendente humano da farmácia.")}`;
  }
}

function renderizarProdutos() {
  const grid = document.getElementById("produtos-grid");
  const termo = estado.busca.toLowerCase();

  const filtrados = estado.produtos.filter((p) => {
    const okCat =
      estado.categoriaFiltro === "TODAS" ||
      (estado.categoriaFiltro === "OFERTAS" ? p.oferta_relampago || p.preco_promocional : p.categoria === estado.categoriaFiltro);
    const okBusca =
      !termo ||
      p.nome_comercial.toLowerCase().includes(termo) ||
      (p.laboratorio || "").toLowerCase().includes(termo) ||
      (p.tags_busca_ia || "").toLowerCase().includes(termo) ||
      (p.descricao_ia_seo || "").toLowerCase().includes(termo);
    return okCat && okBusca;
  });

  if (!filtrados.length) {
    grid.innerHTML = `
      <div class="produto-card">
        <strong>Nenhum item encontrado para essa busca.</strong>
        <p>Procura um medicamento sujeito a receita médica? Clique em <strong>"Enviar Receita para o(a) Farmacêutico(a) RT"</strong> acima.</p>
      </div>`;
    return;
  }

  const pctCashback = estado.farmacia?.cashback_pct || 5;

  grid.innerHTML = filtrados
    .map((p) => {
      const precoEfetivo = p.preco_promocional ?? p.preco_venda;
      const temPromo = p.preco_promocional && p.preco_promocional < p.preco_venda;
      const descontoPct = temPromo ? Math.round((1 - p.preco_promocional / p.preco_venda) * 100) : 0;
      const valorCb = (precoEfetivo * pctCashback) / 100;

      return `
        <article class="produto-card ${p.oferta_relampago || temPromo ? "oferta-card" : ""}">
          <div class="produto-img-wrap">
            ${
              p.imagem_url
                ? `<img src="${esc(p.imagem_url)}" alt="Ilustração do produto ${esc(p.nome_comercial)}" loading="lazy">`
                : `<span aria-hidden="true">${icon("pill", "ico-lg")}</span>`
            }
            <div class="produto-badge-overlay">
              ${
                p.oferta_relampago || temPromo
                  ? `<span class="tag-oferta">OFERTA ${descontoPct > 0 ? `-${descontoPct}%` : "RELÂMPAGO"}</span>`
                  : `<span class="tag-categoria">${esc(p.categoria)}</span>`
              }
            </div>
          </div>
          <span class="produto-lab">${esc(p.laboratorio || "Farmácias Associadas")}</span>
          <h3 class="produto-nome">${esc(p.nome_comercial)}</h3>
          <p class="produto-desc">${esc(p.descricao_ia_seo || "Item disponível para reserva imediata e retirada rápida no balcão da farmácia.")}</p>
          <div class="produto-preco-box">
            ${temPromo ? `<span class="preco-antigo">De ${brl(p.preco_venda)} por:</span>` : ""}
            <span class="preco-atual">${brl(precoEfetivo)}</span>
            <span class="cashback-tag">Volta ${brl(valorCb)} (${pctCashback}% Cashback • Validade 90d)</span>
          </div>
          <button type="button" class="btn-senior btn-senior-teal" data-add-prod="${p.id}">
            ${icon("bag", "ico")} Colocar na Sacola
          </button>
        </article>`;
    })
    .join("");

  grid.querySelectorAll("[data-add-prod]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = Number(btn.getAttribute("data-add-prod"));
      const prod = estado.produtos.find((x) => x.id === id);
      if (!prod) return;
      const item = estado.carrinho.get(id) || { produto: prod, quantidade: 0 };
      item.quantidade += 1;
      estado.carrinho.set(id, item);
      atualizarResumoCarrinho();
      toast(`"${prod.nome_comercial}" adicionado à sua sacola!`);
    });
  });
}

function atualizarResumoCarrinho() {
  let qtdTotal = 0;
  let subtotal = 0;
  for (const { produto, quantidade } of estado.carrinho.values()) {
    qtdTotal += quantidade;
    subtotal += (produto.preco_promocional ?? produto.preco_venda) * quantidade;
  }
  const btnSacola = document.getElementById("btn-abrir-sacola");
  if (btnSacola) {
    btnSacola.textContent = `Minha Sacola (${qtdTotal}) • ${brl(subtotal)}`;
  }
}

function abrirModalSacola() {
  if (estado.carrinho.size === 0) {
    return toast("Sua sacola ainda está vazia. Toque em 'Colocar na Sacola' em qualquer produto!", "erro");
  }
  const modal = document.getElementById("modal-sacola");
  const lista = document.getElementById("sacola-itens-lista");
  let subtotal = 0;
  const html = [];

  for (const [id, { produto, quantidade }] of estado.carrinho.entries()) {
    const preco = produto.preco_promocional ?? produto.preco_venda;
    subtotal += preco * quantidade;
    html.push(`
      <div class="sacola-item-row">
        <div>
          <strong>${quantidade}x ${esc(produto.nome_comercial)}</strong>
          <br><span>${brl(preco)} cada • Total: <strong>${brl(preco * quantidade)}</strong></span>
        </div>
        <button type="button" class="btn-senior btn-senior-sm btn-senior-outline" data-rem-prod="${id}">Remover</button>
      </div>`);
  }

  const cashback = subtotal * ((estado.farmacia?.cashback_pct || 5) / 100);
  lista.innerHTML =
    html.join("") +
    `<div class="sacola-resumo-box mt-10">
       <div>Produtos: ${brl(subtotal)} • Retirada Rápida na Loja: <strong>Grátis (Sem Fila)</strong></div>
       <div class="text-teal-strong">Total a Pagar na Retirada: ${brl(subtotal)}</div>
       <div class="text-orange-strong">Você acumula +${brl(cashback)} de Cashback (válido por 90 dias, até 30% do próximo pedido)!</div>
     </div>`;

  lista.querySelectorAll("[data-rem-prod]").forEach((btn) => {
    btn.addEventListener("click", () => {
      estado.carrinho.delete(Number(btn.getAttribute("data-rem-prod")));
      atualizarResumoCarrinho();
      if (estado.carrinho.size === 0) modal.classList.add("hidden");
      else abrirModalSacola();
    });
  });

  modal.classList.remove("hidden");
  ativarFocusTrap(modal);
}

function exibirReciboPedido(r) {
  const modal = document.getElementById("modal-recibo-pedido");
  const box = document.getElementById("recibo-conteudo");
  box.innerHTML = `
    <div class="sacola-resumo-box">
      <div class="text-teal-strong">Código da Reserva: <strong>${esc(r.codigo_pedido)}</strong></div>
      <div>Total: <strong>${brl(r.total)}</strong> (Retirada no balcão da farmácia — sem taxa)</div>
      <div class="text-orange-strong">Cashback previsto após retirada: <strong>${brl(r.cashback_previsto)}</strong></div>
      ${
        r.chave_pix
          ? `<div class="aviso-simulado-box mt-10">
               <strong>Chave PIX CNPJ (Simulada p/ Demonstração):</strong> ${esc(r.chave_pix)}
               <br><span>${esc(r.aviso_pix_simulado || "")}</span>
             </div>`
          : ""
      }
    </div>
    <p>A sua reserva já entrou na fila de separação da farmácia (estoque reservado via FEFO para você retirar sem fila).</p>
  `;
  modal.classList.remove("hidden");
  ativarFocusTrap(modal);
}

function lerArquivoBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Falha ao ler arquivo da receita."));
    reader.readAsDataURL(file);
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  aplicarNivelFonte(estado.nivelFonte);
  inicializarCookieBanner();
  carregarCatalogo();

  try {
    const cfg = await apiFetch("/api/v1/public/config");
    const linkDemo = document.getElementById("link-demo-recompra-vitrine");
    if (linkDemo) {
      if (cfg.demo && cfg.token_demo_recompra) {
        linkDemo.href = `/recompra.html?t=${encodeURIComponent(cfg.token_demo_recompra)}`;
      } else {
        linkDemo.classList.add("hidden");
      }
    }
  } catch { /* modo produção silencioso */ }

  document.getElementById("btn-font-toggle")?.addEventListener("click", () => {
    aplicarNivelFonte(estado.nivelFonte + 1);
  });

  document.getElementById("btn-contrast-toggle")?.addEventListener("click", alternarAltoContraste);

  document.getElementById("input-busca")?.addEventListener("input", (e) => {
    estado.busca = e.target.value;
    renderizarProdutos();
  });

  document.querySelectorAll("[data-cat-pill]").forEach((btn) => {
    btn.addEventListener("click", () => {
      estado.categoriaFiltro = btn.getAttribute("data-cat-pill");
      document.querySelectorAll("[data-cat-pill]").forEach((b) => b.classList.toggle("active", b === btn));
      renderizarProdutos();
    });
  });

  document.getElementById("btn-abrir-sacola")?.addEventListener("click", abrirModalSacola);
  document.getElementById("btn-fechar-sacola")?.addEventListener("click", () => {
    document.getElementById("modal-sacola").classList.add("hidden");
  });

  document.getElementById("btn-fechar-recibo")?.addEventListener("click", () => {
    document.getElementById("modal-recibo-pedido").classList.add("hidden");
  });

  document.getElementById("btn-abrir-receita")?.addEventListener("click", () => {
    const m = document.getElementById("modal-receita");
    m.classList.remove("hidden");
    ativarFocusTrap(m);
  });
  document.getElementById("btn-fechar-receita")?.addEventListener("click", () => {
    document.getElementById("modal-receita").classList.add("hidden");
  });

  document.getElementById("btn-abrir-termos-legais")?.addEventListener("click", () => {
    const m = document.getElementById("modal-termos-legais");
    m?.classList.remove("hidden");
    ativarFocusTrap(m);
  });
  document.getElementById("btn-fechar-termos-legais")?.addEventListener("click", () => {
    document.getElementById("modal-termos-legais")?.classList.add("hidden");
  });
  document.getElementById("btn-entendi-termos")?.addEventListener("click", () => {
    document.getElementById("modal-termos-legais")?.classList.add("hidden");
  });

  document.getElementById("btn-preencher-receita-demo")?.addEventListener("click", () => {
    document.getElementById("rec-nome").value = "Sr. Roberto Cavalcanti";
    document.getElementById("rec-whats").value = "41991234567";
    document.getElementById("rec-texto").value = "1) Losartana 50mg - 1 caixa\n2) Metformina XR 500mg - 2 caixas\n3) Rosuvastatina 10mg - 1 caixa";
    document.getElementById("rec-lgpd").checked = true;
  });

  document.getElementById("form-checkout-vitrine")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const itens = [...estado.carrinho.values()].map((i) => ({
      produto_id: i.produto.id,
      quantidade: i.quantidade,
    }));
    try {
      const r = await apiFetch("/api/v1/public/pedidos", {
        method: "POST",
        headers: { "Idempotency-Key": `vit-${Date.now()}` },
        body: {
          cliente_nome: document.getElementById("ped-nome").value,
          whatsapp: document.getElementById("ped-whats").value,
          forma_pagamento: document.getElementById("ped-pag").value,
          aceite_termos: document.getElementById("ped-termos").checked,
          itens,
        },
      });
      estado.carrinho.clear();
      atualizarResumoCarrinho();
      document.getElementById("modal-sacola").classList.add("hidden");
      exibirReciboPedido(r);
    } catch (err) {
      toast(err.message, "erro");
    }
  });

  document.getElementById("form-enviar-receita")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const fileInput = document.getElementById("rec-imagem");
      const file = fileInput?.files?.[0] || null;
      const imagemBase64 = file ? await lerArquivoBase64(file) : undefined;
      const textoVal = document.getElementById("rec-texto").value.trim();

      const r = await apiFetch("/api/v1/public/receitas", {
        method: "POST",
        body: {
          cliente_nome: document.getElementById("rec-nome").value,
          whatsapp: document.getElementById("rec-whats").value,
          texto: textoVal || undefined,
          imagem_base64: imagemBase64,
          medico_proibiu_substituicao: document.getElementById("rec-nao-substituir")?.checked || false,
          consentimento_lgpd: document.getElementById("rec-lgpd").checked,
        },
      });
      document.getElementById("modal-receita").classList.add("hidden");
      e.target.reset();
      toast(`${r.protocolo}: ${r.mensagem}`);
    } catch (err) {
      toast(err.message, "erro");
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      ["modal-sacola", "modal-recibo-pedido", "modal-receita", "modal-termos-legais"].forEach((id) => {
        document.getElementById(id)?.classList.add("hidden");
      });
    }
  });
});
