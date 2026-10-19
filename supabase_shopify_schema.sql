-- ==============================================================================
-- SCHEMA SUPABASE: TABELA shopify_daily (ETAPA 2 - Shopify x Google Ads)
-- Descrição: Métricas diárias reais da loja Shopify para cruzar com o
--            investimento do Google Ads (tabela gads_dashboard).
-- Como usar: cole no SQL Editor do Supabase e clique em Run.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.shopify_daily (
    data DATE PRIMARY KEY,
    pedidos INTEGER NOT NULL DEFAULT 0,
    faturamento NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    clientes_novos INTEGER NOT NULL DEFAULT 0,
    pedidos_canal_google INTEGER NOT NULL DEFAULT 0,
    faturamento_canal_google NUMERIC(12, 2) NOT NULL DEFAULT 0.00,

    -- Ticket médio calculado automaticamente
    ticket_medio NUMERIC(12, 2) GENERATED ALWAYS AS (
        CASE
            WHEN pedidos > 0 THEN ROUND(faturamento / pedidos, 2)
            ELSE 0.00
        END
    ) STORED,

    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- Índice para filtros por data no dashboard
CREATE INDEX IF NOT EXISTS idx_shopify_daily_data ON public.shopify_daily (data DESC);

-- Trigger de updated_at (reutiliza a função da etapa 1)
DROP TRIGGER IF EXISTS set_updated_at_shopify ON public.shopify_daily;
CREATE TRIGGER set_updated_at_shopify
    BEFORE UPDATE ON public.shopify_daily
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at();

-- RLS (mesmo padrão da etapa 1: leitura pública + upsert via API key)
ALTER TABLE public.shopify_daily ENABLE ROW LEVEL SECURITY;

CREATE POLICY "shopify_daily leitura publica"
ON public.shopify_daily FOR SELECT USING (true);

CREATE POLICY "shopify_daily upsert via api key"
ON public.shopify_daily FOR ALL USING (true) WITH CHECK (true);

COMMENT ON TABLE public.shopify_daily IS 'Vendas reais da Shopify por dia (Etapa 2) para cruzar com Google Ads';
COMMENT ON COLUMN public.shopify_daily.pedidos IS 'Total de pedidos nao cancelados no dia';
COMMENT ON COLUMN public.shopify_daily.faturamento IS 'Soma dos pedidos (totalPrice) no dia - caixa real';
COMMENT ON COLUMN public.shopify_daily.clientes_novos IS 'Pedidos de clientes cujo cadastro foi criado no mesmo dia (primeira compra)';
COMMENT ON COLUMN public.shopify_daily.pedidos_canal_google IS 'Pedidos atribuidos ao canal Google & YouTube (Order.attribution)';
COMMENT ON COLUMN public.shopify_daily.faturamento_canal_google IS 'Faturamento dos pedidos vindos do canal Google';
