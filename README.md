# 📊 Automação Google Ads -> Supabase -> Dashboard

> **STATUS ATUAL DO PROJETO (2026-10-07):**
> - ✅ **Banco Supabase:** tabela `gads_dashboard` com ROAS/ROI automáticos, 89 dias de dados (08/07→06/10), integridade verificada.
> - ✅ **Google Ads Script:** `google_ads_script.js` autorizado e executado na conta `ecommerce@neurosaber.com.br`.
> - ✅ **Dashboard standalone:** [dashboard.html](./dashboard.html) lê o Supabase direto via REST (sem Lovable).
> - ⏳ **Pendente:** confirmar **Frequência Diária 03:00** em Ferramentas → Scripts no Google Ads (a execução de 07/10 não ocorreu).

---

## 📌 Guia Rápido de 1 Minuto para o Gestor de TI

Para finalizar a automação sem travar na chave de acesso (passkey), o responsável pela conta `ecommerce@neurosaber.com.br` só precisa fazer **uma** destas duas opções:

### Opção A: Adicionar o e-mail do Claudemir como Administrador
1. No **Google Ads** > **Ferramentas** > **Acesso e segurança**.
2. Adicionar o e-mail pessoal/direto do Claudemir como **Administrador**.
3. O Claudemir conseguirá autorizar e agendar o script pelo computador dele.

### Opção B: O próprio Gestor de TI rodar o script uma única vez
1. No **Google Ads** > **Ferramentas** > **Ações em massa** > **Scripts**.
2. Criar um novo script, colar o código do arquivo [google_ads_script.js](file:///c:/Users/Claudemir%20Batista/.gemini/antigravity-ide/scratch/Dashboard%20Google/google_ads_script.js) (já está com a URL e chave do Supabase configuradas).
3. Clicar em **Autorizar**, aprovar no seu celular e clicar em **Executar**.
4. Definir a frequência do script como **Diária (03:00)**.
*(Uma vez agendado na nuvem do Google, ele rodará todos os dias sozinho sem precisar de ninguém logado).*

---

## 📁 Estrutura dos Arquivos

| Arquivo | Descrição |
| :--- | :--- |
| [supabase_schema.sql](file:///c:/Users/Claudemir%20Batista/.gemini/antigravity-ide/scratch/Dashboard%20Google/supabase_schema.sql) | Script SQL para criar a tabela `gads_dashboard`, colunas calculadas (`roas`, `roi`), índices e RLS. |
| [google_ads_script.js](file:///c:/Users/Claudemir%20Batista/.gemini/antigravity-ide/scratch/Dashboard%20Google/google_ads_script.js) | **(Recomendado)** Google Ads Script nativo em JavaScript. Roda direto na nuvem do Google sem servidor. |
| [extract_google_ads_api.py](file:///c:/Users/Claudemir%20Batista/.gemini/antigravity-ide/scratch/Dashboard%20Google/extract_google_ads_api.py) | Script alternativo em Python utilizando a biblioteca oficial `google-ads`. |
| [.env.example](file:///c:/Users/Claudemir%20Batista/.gemini/antigravity-ide/scratch/Dashboard%20Google/.env.example) | Exemplo de variáveis de ambiente para o script Python. |
| [requirements.txt](file:///c:/Users/Claudemir%20Batista/.gemini/antigravity-ide/scratch/Dashboard%20Google/requirements.txt) | Dependências Python. |

---

## 🚀 Passo a Passo de Implementação

### 1️⃣ Criar a Tabela no Supabase
1. Acesse o painel do seu projeto no [Supabase](https://supabase.com).
2. Abra o menu **SQL Editor** na barra lateral.
3. Copie todo o conteúdo do arquivo [supabase_schema.sql](file:///c:/Users/Claudemir%20Batista/.gemini/antigravity-ide/scratch/Dashboard%20Google/supabase_schema.sql).
4. Cole no editor e clique em **Run**.
5. A tabela `gads_dashboard` será criada com:
   - Restrição única em `(data, nome_campanha, produto_nome)` para suportar **Upsert** automático (atualiza registros sem duplicar).
   - Colunas calculadas automáticas (`roas = faturamento / investimento` e `roi = (faturamento - investimento) / investimento * 100`).
   - Índices para consultas rápidas por data e campanha.

---

### 2️⃣ Instalar o Google Ads Script (Método Recomendado)
Este método é o mais simples, gratuito e não necessita de servidores ou aprovação burocrática de Developer Token do Google Ads.

1. Acesse sua conta no **Google Ads** ([ads.google.com](https://ads.google.com)).
2. Clique em **Ferramentas e Configurações** (ou ícone de chave inglesa/menu Ferramentas) > **Ações em massa** > **Scripts**.
3. Clique no botão azul **"+"** para criar um novo script.
4. Nomeie o script como: `Sync Supabase Dashboard`.
5. Substitua todo o conteúdo pelo código de [google_ads_script.js](file:///c:/Users/Claudemir%20Batista/.gemini/antigravity-ide/scratch/Dashboard%20Google/google_ads_script.js).
6. Altere no topo do script as suas credenciais:
   ```javascript
   SUPABASE_URL: 'https://[SEU_PROJETO].supabase.co',
   SUPABASE_KEY: '[SUA_KEY]', // anon key ou service_role key
   ```
7. Clique em **Autorizar** para conceder permissão.
8. Clique em **Visualizar** ou **Executar** para fazer a primeira carga dos últimos 90 dias.
9. Na listagem de Scripts do Google Ads, defina uma **Frequência** diária (ex: todos os dias às 03:00) para manter o Supabase sempre atualizado.

---

### 3️⃣ (Opcional) Execução via Python (API Externa)
Se você preferir rodar em um servidor, Docker ou GitHub Actions:

```bash
pip install -r requirements.txt
cp .env.example .env
# Edite o .env com suas credenciais
python extract_google_ads_api.py
```

---

### 4️⃣ Criação do Dashboard no Lovable

No **Lovable**, conecte o seu projeto ao **Supabase** e utilize o seguinte prompt ajustado:

```text
Crie um dashboard exclusivo de performance do Google Ads conectado à tabela gads_dashboard do Supabase.

Filtro de Período no topo:
- Botões rápidos: Hoje, Últimos 3 dias, 7 dias, 14 dias e 30 dias.

KPI Cards Principais:
- Valor Investido: Soma do gasto (R$) no período selecionado.
- Faturamento: Soma do valor de conversão (R$) no período selecionado.
- ROAS: Exibir em multiplicador formatado (ex: 4.2x), calculado pela soma(faturamento) / soma(investimento).
- ROI: Exibir em porcentagem formatada (ex: 320%), calculado por ((soma(faturamento) - soma(investimento)) / soma(investimento)) * 100.
- Itens no Carrinho / Vendas de Produtos: Total acumulado de produtos vendidos e itens de carrinho.

Tabelas e Gráficos:
- Relatório de Produtos (G-Ads): Tabela listando os produtos vendidos na campanha, ordenados por faturamento ou quantidade vendida, exibindo colunas: Produto, Campanha, Quantidade Vendida, Investimento, Faturamento e ROAS individual.
- Evolução Diária: Gráfico de linhas com eixo temporal comparando Valor Investido vs Faturamento ao longo do histórico dos 3 meses.

Estilo e Design:
- Design limpo, executivo e moderno com modo escuro (Dark Mode) ativado por padrão.
- Formatação de moedas em Real brasileiro (R$).
```

---

## 📈 Estrutura dos Dados

| Campo | Tipo | Descrição |
| :--- | :--- | :--- |
| `data` | DATE | Data da métrica (dia) |
| `nome_campanha` | VARCHAR | Nome da campanha no Google Ads |
| `produto_nome` | VARCHAR | Nome do produto (Shopping/PMax) ou 'Geral / Campanha' |
| `investimento` | NUMERIC | Custo investido em R$ |
| `faturamento` | NUMERIC | Valor de conversão gerado em R$ |
| `cliques` | INTEGER | Quantidade de cliques |
| `impressoes` | INTEGER | Quantidade de impressões |
| `itens_no_carrinho` | INTEGER | Itens adicionados ao carrinho |
| `quantidade_vendida`| INTEGER | Conversões / produtos vendidos |
| `roas` | NUMERIC | Calculado automaticamente (`faturamento / investimento`) |
| `roi` | NUMERIC | Calculado automaticamente (`(faturamento - investimento) / investimento * 100`) |
