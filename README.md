# 🏥 FarmaLink Pro v3.2 — Plataforma de Recorrência, Delivery Próprio e Apoio Farmacêutico

> **Sistema Web Multi-Tenant para Farmácias Independentes e Redes Associadas (Método ENDS + Layout Glass Side Bar)**  
> Documentação Técnica de Arquivos, Rotas, LGPD/RIPD e Deploy: consulte [`README_ARQUIVOS_E_FUNCOES.md`](./README_ARQUIVOS_E_FUNCOES.md).

---

## ⚡ Início Rápido (3 Comandos para Rodar)

Pré-requisito: **Node.js `>= 22.13.0`** (recomendado `22.14.0+`, onde `node:sqlite` roda nativamente sem flags experimentais).

### No Linux / macOS / Git Bash:
```bash
cd backend
npm test && npm run reset-db
npm start
```

### No Windows (PowerShell):
```powershell
cd backend
npm test; npm run reset-db
npm start
```

Após iniciar, acesse no navegador:
- **Showroom & Calculadora de ROI (Premissas Editáveis):** `http://localhost:3000/index.html`
- **Painel Operacional & Executivo (Glass Side Bar):** `http://localhost:3000/painel.html`
- **Vitrine Digital Sênior 60+ (A / A+ / A++ e Alto Contraste):** `http://localhost:3000/vitrine.html`
- **Tela de Recompra Autenticada (Desafio de 4 Dígitos):** `http://localhost:3000/recompra.html` *(em `DEMO_MODE=true`, carrega o token de demonstração via `/api/v1/public/config`)*
- **Login Corporativo Split-Screen:** `http://localhost:3000/login.html`

---

## ⚠️ O Que é Simulado / Demo Hoje vs. Ambiente de Produção

Para evitar que uma demonstração comercial seja confundida com integrações externas já homologadas em produção, a tabela abaixo discrimina o comportamento do sistema no modo de apresentação (`DEMO_MODE=true`) versus operação produtiva (`NODE_ENV=production` e `DEMO_MODE=false`):

| Subsistema | Comportamento na Demo Local (`DEMO_MODE=true`) | Requisito para Produção Real (`DEMO_MODE=false`) |
| :--- | :--- | :--- |
| **Pagamento PIX** | Exibe chave PIX CNPJ ilustrativa e aviso explícito de ambiente simulado no recibo. | Integração com PSP homologado (ex.: Asaas, Efí, Mercado Pago) com QR Code dinâmico e baixa via webhook assinado. |
| **Copiloto de IA (Receitas e Catálogo)** | Opera com motor determinístico local de sinônimos DCB caso `GEMINI_API_KEY` não esteja preenchida. **Nunca envia fotos de receitas para IA externa.** | Chave corporativa `GEMINI_API_KEY` (plano pago sem treinamento de dados) processando exclusivamente texto clínico sanitizado. |
| **Disparo de WhatsApp** | Opera no **Modo 1-Clique Assistido** (abre o Simulador de Smartphone na tela e gera link `wa.me` para envio manual pelo operador). | Para disparo automático em segundo plano via `META_CLOUD_API`, exige conta WhatsApp Business API Oficial da Meta e templates pré-aprovados. |
| **Estoque & ERP / NFC-e** | Estoque controlado localmente por lotes (saída FEFO) com importador de XML de NF-e e endpoint `/api/v1/integracoes/erp-sync`. | Agente/conector sincronizando estoque e emissão fiscal (NFC-e/SAT) com o ERP de frente de loja da farmácia (ex.: Trier, Linx/Big, FarmaSoft). |
| **Identidade Visual & Marcas** | Utiliza paleta demonstrativa inspirada em redes associadas e nomes genéricos/fictícios de produtos. | Exige autorização formal da rede/farmácia contratante e cadastro do catálogo real com fotos próprias licenciadas. |

---

## 🎯 1. O Que o Site Faz? (Visão Comercial e Regulatória)

O **FarmaLink Pro v3.1** organiza a operação digital da farmácia em **6 áreas funcionais**, desenhadas para respeitar a **RDC 44/2009 da ANVISA**, a **Lei 13.021/2014** (assistência farmacêutica), a **Lei 9.787/1999** (medicamentos genéricos), a **LGPD (Lei 13.709/2018, Arts. 11 e 18)** e o **Código de Defesa do Consumidor (Decreto 7.962/2013)**:

### 1.1. Dashboard Executivo com Métricas Contábeis Separadas
Em vez de somar conceitos contábeis distintos em um único número, o painel separa claramente:
1. **Faturamento Bruto de Recompras (Módulo A):** Receita bruta proveniente de tratamentos contínuos confirmados após o lembrete.
2. **Comissão de Marketplace Terceiro Evitada (Estimada — Módulo B):** Custo estimado poupado ao vender pelo canal próprio (calculado sobre uma taxa de referência configurável pelo Diretor, ex.: 18% a 22%).
3. **Custo de Estoque Recuperado (Módulo D):** Valor de custo contábil de lotes escoados antes da data de vencimento via saída FEFO e campanhas de queima.
4. **Lucro Bruto de Receitas Convertidas (Módulo C) & Passivo de Cashback:** Margem bruta (`Venda - Custo`) dos orçamentos efetivamente convertidos em venda e saldo total de cashback em aberto nas carteiras dos clientes.

### 1.2. Módulo A — Uso Contínuo com Sigilo LGPD e Validação Farmacêutica
- **Cadastro Rápido no Balcão:** Registra paciente, WhatsApp, medicamento, duração da caixa (`30`, `60` ou `90 dias`), antecedência configurável do alerta (`2 a 15 dias`, antecipando automaticamente caso caia em domingo) e validade da receita.
- **Consentimentos Separados:** Registra separadamente o consentimento de acompanhamento de saúde (`lgpd_consentimento_saude_em`) e o opt-in de lembretes (`lgpd_optin_comunicacao_em`).
- **Mensagem de WhatsApp 100% Neutra:** Para evitar exposição de dados sensíveis de saúde na tela bloqueada do celular, a mensagem enviada no WhatsApp **não menciona o nome do medicamento**.
- **Desafio dos 4 Últimos Dígitos + Token de Uso Único (SHA-256):** Ao abrir o link `/recompra.html?t=...`, o paciente confirma os **4 últimos dígitos do seu WhatsApp** antes que o nome do medicamento e o saldo de cashback sejam exibidos.
- **Trava da Lei 13.021/2014 e RDC 44/2009 para Tarjados:** Se o medicamento do tratamento contínuo exige receita médica (`exige_receita = 1`), a solicitação de reposição em 1 clique **não fecha venda direta**: ela entra na esteira com o status `AGUARDANDO_VALIDACAO_RT`, exigindo conferência e liberação do(a) **Farmacêutico(a) RT** antes da separação.

### 1.3. Módulo B — Vitrine Digital Sênior 60+, Cashback Auditável e Pós-Venda Ético
- **Acessibilidade Sênior 60+:** Escala tipográfica em `rem` com **3 níveis** (`18px padrão`, `21px A+` e `24px A++`), **Modo Alto Contraste**, botões táteis ≥ `52px`, *focus trap* nos modais, suporte a `prefers-reduced-motion` e botão fixo **"📞 Falar com Atendente"** no topo.
- **Trava Regulatória ANVISA (RDC 44/2009):** A Vitrine exibe e permite checkout direto apenas de produtos isentos de prescrição. Qualquer tentativa de enviar um `produto_id` tarjado para `/api/v1/public/pedidos` é rejeitada pelo servidor com **`HTTP 422 Unprocessable Entity`**.
- **Governança de Cashback em Centavos Inteiros (`INTEGER`):**
  - Calculado e armazenado em centavos inteiros para eliminar erros de arredondamento de ponto flutuante;
  - Validade de 90 dias, teto de resgate de 30% do subtotal elegível do pedido e aplicável a itens não-tarjados;
  - Caso um pedido `CONCLUIDO` seja posteriormente marcado como `DEVOLVIDO` (direito de arrependimento CDC Art. 49), o sistema **estorna automaticamente** o cashback gerado e recompõe o lote no estoque.
- **Pós-Venda em Conformidade com Políticas de Avaliação:** Ao concluir a entrega, o convite enviado ao cliente utiliza linguagem neutra (*"Avalie sua experiência de atendimento"*), sem induzir nota específica ("5 estrelas") e sem condicionar o cashback à avaliação.

### 1.4. Módulo C — Copiloto de Triagem de Receitas Médicas (Intercambialidade Ética)
- **Proteção de Imagem Sensível (Zero Envio de Foto para IA Externa):** Quando o paciente envia uma foto de receita (`JPG`, `PNG` ou `WEBP`), o backend valida os *magic bytes*, **remove metadados EXIF/GPS**, **criptografa o arquivo em repouso com AES-256-GCM** fora da pasta pública (com expiração física em 7 dias) e registra auditoria a cada visualização pelo(a) Farmacêutico(a) RT. A imagem jamais é enviada para APIs externas.
- **Sanitização de Texto e Priorização da Economia do Paciente (Lei 9.787/1999):**
  - O filtro `anonimizarTextoReceita()` remove padrões de CPF, CRM, telefone e linhas de identificação antes da extração de princípios ativos.
  - Se a receita tiver a marcação **"Médico proibiu substituição"** (`medico_proibiu_substituicao = true`), o sistema bloqueia a troca por genérico e mantém exclusivamente o medicamento de referência.
  - Quando a intercambialidade é permitida, o sistema seleciona o **genérico intercambiável de MENOR PREÇO para o paciente**, exibindo a margem bruta apenas internamente para a farmácia.

### 1.5. Módulo D — Radar Anti-Vencimento (30/60/90 Dias) com Fonte Única FEFO
- **Fonte Única de Estoque (`lotes_estoque` ➔ `produtos.estoque_total`):** O estoque disponível de cada produto é sempre a soma dos seus lotes válidos (não vencidos). Toda venda na Vitrine ou no Balcão consome automaticamente dos lotes com vencimento mais próximo (**FEFO — First-Expired, First-Out**).
- **Bloqueio de Lotes Vencidos:** Lotes cuja data de validade já passou recebem o status `⛔ VENCIDO (VENDA BLOQUEADA)` e qualquer tentativa de baixa retorna `HTTP 422`.
- **Importador XML de NF-e Idempotente:** Processa múltiplos blocos `<rastro>` por item da nota fiscal, bloqueia entidades externas (Anti-XXE) e grava a chave de acesso (`chNFe`) em `execucoes_idempotentes` para impedir que a mesma nota seja importada duas vezes (`HTTP 409`).

### 1.6. Módulo E — POPs Internos ANVISA (Append-Only), Direitos LGPD Art. 18 e Conector ERP
- **Checklists Internos com Trigger Append-Only e Hash SHA-256:** Registra medições de temperatura da geladeira (`2°C a 8°C`), ambiente, umidade, limpeza da sala de injetáveis e conferência física interna do armário de controlados (que não substitui a escrituração oficial no SNGPC da ANVISA). Triggers nativos do SQLite bloqueiam `UPDATE` e `DELETE` nos registros assinados.
- **Direitos do Titular LGPD (Art. 18):** Painel e endpoints para exportar todos os dados de um titular em JSON estruturado (**Portabilidade**), executar a **Anonimização** definitiva e processar opt-out imediato via webhook quando o cliente responde `"SAIR"` no WhatsApp.

---

## 🔑 2. Credenciais de Demonstração (`DEMO_MODE=true`)

Senha única do ambiente de demonstração: **`Associadas@2026`** *(desabilitada em produção; o servidor recusa iniciar caso `NODE_ENV=production` e `DEMO_MODE=true`)*.

| Perfil | E-mail | Unidade / Plano | Escopo de Acesso (RBAC) |
| :--- | :--- | :--- | :--- |
| **👑 Diretor** | `dono@associadas.demo` | Unidade Centro (`PRO_IA`) | Acesso total, configurações financeiras, trilha de auditoria, LGPD Art. 18 e Self-Heal. |
| **⚕️ Farmacêutico(a) RT** | `farmaceutica@associadas.demo` | Unidade Centro (`PRO_IA`) | Validação de recompras de tarjados, aprovação de receitas IA, conferência de controlados e lotes. |
| **🛒 Balconista** | `balconista@associadas.demo` | Unidade Centro (`PRO_IA`) | Cadastro rápido de uso contínuo, separação de pedidos livres e venda de lotes no balcão. |
| **🏢 Diretor Loja 2** | `dono.batel@associadas.demo` | Unidade Batel (`ESSENCIAL`) | Demonstra o isolamento Multi-Tenant e o bloqueio `HTTP 402` nos módulos exclusivos do plano Pro IA. |

---

## 📄 Licença
Propriedade intelectual de **Tricode Engenharia de Software**. Uso demonstrativo e comercial regido por contrato de licenciamento SaaS e Acordo de Processamento de Dados (DPA / LGPD) entre Controladora (Farmácia) e Operadora (Tricode).
