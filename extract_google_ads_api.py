"""
==============================================================================
SCRIPT PYTHON: EXTRAÇÃO GOOGLE ADS API -> SUPABASE
==============================================================================
Requisitos:
    pip install -r requirements.txt

Configuração:
    Preencha as variáveis de ambiente no arquivo .env (veja .env.example)
==============================================================================
"""

import os
import sys
from datetime import datetime, timedelta
from typing import List, Dict, Any
from dotenv import load_dotenv
import requests

load_dotenv()

# Configurações do Supabase
SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY = os.getenv("SUPABASE_KEY", "")
TABLE_NAME = os.getenv("SUPABASE_TABLE", "gads_dashboard")

# Configurações do Google Ads API
GOOGLE_ADS_CUSTOMER_ID = os.getenv("GOOGLE_ADS_CUSTOMER_ID", "").replace("-", "")

def validate_environment():
    missing = []
    if not SUPABASE_URL or "sua_url" in SUPABASE_URL.lower():
        missing.append("SUPABASE_URL")
    if not SUPABASE_KEY or "sua_key" in SUPABASE_KEY.lower():
        missing.append("SUPABASE_KEY")
    if not GOOGLE_ADS_CUSTOMER_ID:
        missing.append("GOOGLE_ADS_CUSTOMER_ID")
    
    if missing:
        print(f"[ERRO] Variáveis obrigatórias não configuradas no .env: {', '.join(missing)}")
        print("Configure o arquivo .env antes de executar.")
        sys.exit(1)

def get_google_ads_client():
    """
    Inicializa o cliente do Google Ads.
    Pode carregar de google-ads.yaml ou diretamente das variáveis de ambiente.
    """
    try:
        from google.ads.googleads.client import GoogleAdsClient
        
        credentials = {
            "developer_token": os.getenv("GOOGLE_ADS_DEVELOPER_TOKEN"),
            "client_id": os.getenv("GOOGLE_ADS_CLIENT_ID"),
            "client_secret": os.getenv("GOOGLE_ADS_CLIENT_SECRET"),
            "refresh_token": os.getenv("GOOGLE_ADS_REFRESH_TOKEN"),
            "use_proto_plus": True
        }
        
        # Se houver arquivo google-ads.yaml, usa-o. Caso contrário, usa dict
        if os.path.exists("google-ads.yaml"):
            return GoogleAdsClient.load_from_storage("google-ads.yaml")
        return GoogleAdsClient.load_from_dict(credentials)
    except Exception as e:
        print(f"[ERRO] Falha ao inicializar o Google Ads Client: {e}")
        print("Dica: Certifique-se de preencher as credenciais da API ou use o script 'google_ads_script.js' direto no painel do Google Ads!")
        sys.exit(1)

def extract_gads_data(client, customer_id: str, days_back: int = 90) -> List[Dict[str, Any]]:
    """
    Executa consultas GAQL para obter dados dos últimos 90 dias.
    Extrai tanto produtos (Shopping/PMax) quanto campanhas gerais.
    """
    ga_service = client.get_service("GoogleAdsService")
    records = []
    campaigns_with_products = set()

    # 1. Consulta por Produtos (Shopping / Performance Max)
    print(f"[*] Consultando produtos dos últimos {days_back} dias...")
    start_date = (datetime.now() - timedelta(days=days_back)).strftime("%Y-%m-%d")
    end_date = datetime.now().strftime("%Y-%m-%d")
    date_filter = f"segments.date BETWEEN '{start_date}' AND '{end_date}'"

    # 1. Consulta por produto (Shopping / PMax)
    print(f"[*] Consultando produtos de Shopping / PMax ({start_date} até {end_date})...")
    shopping_query = f"""
        SELECT
            segments.date,
            campaign.name,
            segments.product_title,
            metrics.cost_micros,
            metrics.conversions_value,
            metrics.clicks,
            metrics.impressions,
            metrics.conversions
        FROM shopping_performance_view
        WHERE {date_filter}
            AND campaign.status != 'REMOVED'
    """
    
    try:
        response = ga_service.search_stream(customer_id=customer_id, query=shopping_query)
        for batch in response:
            for row in batch.results:
                camp_name = row.campaign.name
                campaigns_with_products.add(camp_name)
                
                cost = round(row.metrics.cost_micros / 1_000_000, 2)
                revenue = round(row.metrics.conversions_value, 2)
                clicks = int(row.metrics.clicks)
                impressions = int(row.metrics.impressions)
                qty_sold = int(round(row.metrics.conversions))
                product_title = row.segments.product_title.strip() if row.segments.product_title else "Produto sem título"
                
                roas = round(revenue / cost, 2) if cost > 0 else 0.0
                roi = round(((revenue - cost) / cost) * 100, 2) if cost > 0 else 0.0

                records.append({
                    "data": row.segments.date,
                    "nome_campanha": camp_name,
                    "produto_nome": product_title,
                    "investimento": cost,
                    "faturamento": revenue,
                    "cliques": clicks,
                    "impressoes": impressions,
                    "itens_no_carrinho": 0,
                    "quantidade_vendida": qty_sold
                })
        print(f"[OK] {len(records)} linhas de produtos extraídas.")
    except Exception as e:
        print(f"[AVISO] shopping_performance_view não retornou dados ou deu erro: {e}")

    # 2. Consulta a nível de campanha (para campanhas de Pesquisa/Display/Vídeo sem feed)
    print(f"[*] Consultando campanhas gerais ({start_date} até {end_date})...")
    campaign_query = f"""
        SELECT
            segments.date,
            campaign.name,
            metrics.cost_micros,
            metrics.conversions_value,
            metrics.clicks,
            metrics.impressions,
            metrics.conversions
        FROM campaign
        WHERE {date_filter}
            AND campaign.status != 'REMOVED'
    """
    try:
        response = ga_service.search_stream(customer_id=customer_id, query=campaign_query)
        camp_count = 0
        for batch in response:
            for row in batch.results:
                camp_name = row.campaign.name
                # Evita duplicar custo se a campanha já teve linhas de produto
                if camp_name in campaigns_with_products:
                    continue

                cost = round(row.metrics.cost_micros / 1_000_000, 2)
                revenue = round(row.metrics.conversions_value, 2)
                clicks = int(row.metrics.clicks)
                impressions = int(row.metrics.impressions)
                qty_sold = int(round(row.metrics.conversions))
                
                roas = round(revenue / cost, 2) if cost > 0 else 0.0
                roi = round(((revenue - cost) / cost) * 100, 2) if cost > 0 else 0.0

                records.append({
                    "data": row.segments.date,
                    "nome_campanha": camp_name,
                    "produto_nome": "Geral / Campanha",
                    "investimento": cost,
                    "faturamento": revenue,
                    "cliques": clicks,
                    "impressoes": impressions,
                    "itens_no_carrinho": 0,
                    "quantidade_vendida": qty_sold
                })
                camp_count += 1
        print(f"[OK] {camp_count} linhas adicionais de campanhas consolidadas.")
    except Exception as e:
        print(f"[ERRO] Erro ao consultar relatório de campanha: {e}")

    return records

def send_to_supabase(records: List[Dict[str, Any]], batch_size: int = 200):
    """
    Envia registros para a tabela do Supabase com Upsert (resolution=merge-duplicates)
    """
    if not records:
        print("[!] Nenhum registro para enviar.")
        return

    endpoint = f"{SUPABASE_URL}/rest/v1/{TABLE_NAME}?on_conflict=data,nome_campanha,produto_nome"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates"
    }

    total = len(records)
    print(f"[*] Enviando {total} registros para o Supabase em lotes de {batch_size}...")

    for i in range(0, total, batch_size):
        batch = records[i:i + batch_size]
        batch_num = (i // batch_size) + 1
        total_batches = (total + batch_size - 1) // batch_size
        
        response = requests.post(endpoint, headers=headers, json=batch, timeout=30)
        if response.status_code in [200, 201]:
            print(f"  [OK] Lote {batch_num}/{total_batches} enviado com sucesso ({len(batch)} registros).")
        else:
            print(f"  [ERRO] Lote {batch_num}/{total_batches} falhou: HTTP {response.status_code} - {response.text}")

def main():
    validate_environment()
    client = get_google_ads_client()
    records = extract_gads_data(client, GOOGLE_ADS_CUSTOMER_ID, days_back=90)
    send_to_supabase(records)
    print("\n[CONCLUÍDO] Sincronização finalizada!")

if __name__ == "__main__":
    main()
