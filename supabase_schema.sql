-- ==============================================================================
-- SCHEMA SUPABASE: TABELA gads_dashboard
-- Descrição: Armazena métricas diárias de Google Ads para integração com Lovable
-- ==============================================================================

-- 1. Criação da tabela principal
CREATE TABLE IF NOT EXISTS public.gads_dashboard (
    id BIGSERIAL PRIMARY KEY,
    data DATE NOT NULL,
    nome_campanha VARCHAR(255) NOT NULL,
    produto_nome VARCHAR(255) DEFAULT 'Geral / Campanha',
    investimento NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    faturamento NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    cliques INTEGER NOT NULL DEFAULT 0,
    impressoes INTEGER NOT NULL DEFAULT 0,
    itens_no_carrinho INTEGER NOT NULL DEFAULT 0,
    quantidade_vendida INTEGER NOT NULL DEFAULT 0,
    
    -- Colunas Calculadas Automáticas (Stored Generated Columns)
    -- ROAS: Retorno sobre investimento em anúncios (ex: 4.50 = 4.5x)
    roas NUMERIC(10, 2) GENERATED ALWAYS AS (
        CASE 
            WHEN investimento > 0 THEN ROUND(faturamento / investimento, 2)
            ELSE 0.00 
        END
    ) STORED,

    -- ROI: Retorno percentual sobre o investimento (ex: 350.00 = 350%)
    roi NUMERIC(10, 2) GENERATED ALWAYS AS (
        CASE 
            WHEN investimento > 0 THEN ROUND(((faturamento - investimento) / investimento) * 100, 2)
            ELSE 0.00 
        END
    ) STORED,

    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,

    -- Restrição de unicidade para permitir UPSERT (on conflict do update) sem duplicar registros
    CONSTRAINT uq_gads_data_campanha_produto UNIQUE (data, nome_campanha, produto_nome)
);

-- 2. Índices de alta performance para filtros do Dashboard (Lovable)
CREATE INDEX IF NOT EXISTS idx_gads_data ON public.gads_dashboard (data DESC);
CREATE INDEX IF NOT EXISTS idx_gads_campanha ON public.gads_dashboard (nome_campanha);
CREATE INDEX IF NOT EXISTS idx_gads_produto ON public.gads_dashboard (produto_nome);

-- 3. Trigger para atualizar o campo updated_at automaticamente
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = TIMEZONE('utc'::text, NOW());
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_updated_at_gads ON public.gads_dashboard;
CREATE TRIGGER set_updated_at_gads
    BEFORE UPDATE ON public.gads_dashboard
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at();

-- 4. Habilitar Row Level Security (RLS)
ALTER TABLE public.gads_dashboard ENABLE ROW LEVEL SECURITY;

-- 5. Políticas de Segurança (RLS)
-- Permitir leitura pública (ou apenas autenticada, ideal para o frontend do Lovable)
CREATE POLICY "Permitir leitura para todos ou anon" 
ON public.gads_dashboard 
FOR SELECT 
USING (true);

-- Permitir inserção e atualização via anon ou service_role (usado pelo Script do Google Ads / Python)
CREATE POLICY "Permitir upsert com api key" 
ON public.gads_dashboard 
FOR ALL 
USING (true)
WITH CHECK (true);

-- Comentários descritivos nas colunas
COMMENT ON TABLE public.gads_dashboard IS 'Dados consolidados diários de Google Ads com métricas de campanha e produtos';
COMMENT ON COLUMN public.gads_dashboard.investimento IS 'Valor investido em R$ (cost)';
COMMENT ON COLUMN public.gads_dashboard.faturamento IS 'Valor total de conversão/vendas em R$ (conversions_value)';
COMMENT ON COLUMN public.gads_dashboard.roas IS 'Multiplicador de retorno sobre investimento (Faturamento / Investimento)';
COMMENT ON COLUMN public.gads_dashboard.roi IS 'Retorno percentual sobre investimento ((Faturamento - Investimento) / Investimento * 100)';
