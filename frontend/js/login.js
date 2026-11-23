// Login Split-Screen + Acesso Rápido 1-Clique por Cargo (Somente em DEMO_MODE)
import { apiFetch, carregarTemaInicial, toast } from "./auth.js";

carregarTemaInicial();

async function inicializarLogin() {
  const form = document.getElementById("form-login");
  const demoBox = document.getElementById("demo-quick-box");

  try {
    const cfg = await apiFetch("/api/v1/public/config");
    if (cfg.demo && demoBox) {
      demoBox.classList.remove("hidden");
    }
  } catch { /* modo produção silencioso */ }

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = document.getElementById("email").value.trim();
    const senha = document.getElementById("senha").value;
    const btn = document.getElementById("btn-entrar");
    btn.disabled = true;
    btn.textContent = "Autenticando com segurança...";
    try {
      await apiFetch("/api/v1/auth/login", { method: "POST", body: { email, senha } });
      window.location.href = "/painel.html";
    } catch (err) {
      toast(err.message, "erro");
      btn.disabled = false;
      btn.textContent = "Entrar no Painel FarmaLink Pro ➔";
    }
  });

  document.querySelectorAll("[data-demo-cargo]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const cargo = btn.getAttribute("data-demo-cargo");
      btn.disabled = true;
      try {
        await apiFetch("/api/v1/auth/demo-login", { method: "POST", body: { cargo } });
        window.location.href = "/painel.html";
      } catch (err) {
        toast(err.message, "erro");
        btn.disabled = false;
      }
    });
  });
}

document.addEventListener("DOMContentLoaded", inicializarLogin);
