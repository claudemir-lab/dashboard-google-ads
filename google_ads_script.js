/**
 * ==============================================================================
 * GOOGLE ADS SCRIPT: EXTRAÇÃO PARA O SUPABASE (gads_dashboard)
 * ==============================================================================
 * 
 * Como instalar no Google Ads:
 * 1. Acesse o painel do Google Ads (ads.google.com).
 * 2. No menu superior ou lateral, vá em: "Ferramentas" (ou "Ferramentas e Configurações") > "Ações em massa" > "Scripts".
 * 3. Abra o script "Dashboard Google".
 * 4. Apague todo o conteúdo do editor e cole este código completo atualizado.
 * 5. Clique em "Salvar" e depois em "Executar" (ou "Executar sem visualização").
 * 6. Defina a frequência como Diária (ex: 03:00 da manhã).
 * ==============================================================================
 */

// ======================= CONFIGURAÇÕES =======================
const CONFIG = {
  // URL da API REST do Supabase
  SUPABASE_URL: 'https://bbitajwmcapohixocavn.supabase.co',
  
  // Chave de API do Supabase (anon / public key)
  SUPABASE_KEY: 'sb_publishable_fNQDTEEbDQvMBbK8M4Dqeg_j-5QF2sS',
  
  // Nome da tabela de destino no Supabase
  TABLE_NAME: 'gads_dashboard',
  
  // Quantidade de dias para extrair no histórico (90 dias = 3 meses)
  DAYS_BACK: 90,
  
  // Tamanho do lote para envio ao Supabase (evita estouro de payload HTTP)
  BATCH_SIZE: 200
};

function main() {
  Logger.log('>>> Iniciando sincronização Google Ads -> Supabase...');
  
  if (CONFIG.SUPABASE_URL.includes('[SUA_URL]') || CONFIG.SUPABASE_KEY.includes('[SUA_KEY]')) {
    throw new Error('ATENÇÃO: Configure sua SUPABASE_URL e SUPABASE_KEY no topo do script!');
  }

  // Define intervalo de datas com BETWEEN (suporta qualquer quantidade de dias no GAQL)
  const dateClause = getDateFilterClause(CONFIG.DAYS_BACK);
  Logger.log('Período de consulta: ' + dateClause);

  // Coleta dados
  const records = [];
  const campaignsWithProducts = new Set();

  // 1. Extração de produtos (Campanhas de Shopping / Performance Max com feed de produtos)
  Logger.log('1/2. Buscando métricas por produto (shopping_performance_view)...');
  try {
    const shoppingQuery = `
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
      WHERE ${dateClause}
        AND campaign.status != 'REMOVED'
    `;

    const shoppingReport = AdsApp.search(shoppingQuery);
    let shoppingCount = 0;

    while (shoppingReport.hasNext()) {
      const row = shoppingReport.next();
      const campaignName = row.campaign.name || 'Sem Nome';
      campaignsWithProducts.add(campaignName);

      const investimento = row.metrics.costMicros ? Number((row.metrics.costMicros / 1000000).toFixed(2)) : 0.00;
      const faturamento = row.metrics.conversionsValue ? Number(row.metrics.conversionsValue.toFixed(2)) : 0.00;
      const cliques = row.metrics.clicks || 0;
      const impressoes = row.metrics.impressions || 0;
      const quantidadeVendida = row.metrics.conversions ? Math.round(row.metrics.conversions) : 0;
      const produtoNome = row.segments.productTitle ? row.segments.productTitle.trim() : 'Produto sem título';

      // NOTA: roas e roi NÃO são enviados aqui porque o Postgres do Supabase calcula automaticamente
      // (colunas GENERATED ALWAYS AS ... STORED).
      records.push({
        data: row.segments.date,
        nome_campanha: campaignName,
        produto_nome: produtoNome,
        investimento: investimento,
        faturamento: faturamento,
        cliques: cliques,
        impressoes: impressoes,
        itens_no_carrinho: 0,
        quantidade_vendida: quantidadeVendida
      });
      shoppingCount++;
    }
    Logger.log('Total de registros de produtos capturados: ' + shoppingCount);
  } catch (e) {
    Logger.log('Aviso ao consultar shopping_performance_view: ' + (e.message || e));
  }

  // 2. Extração a nível de Campanha (Para campanhas de Pesquisa, Display, Vídeo ou contas sem feed)
  Logger.log('2/2. Buscando métricas a nível de campanha (campaign)...');
  try {
    const campaignQuery = `
      SELECT
        segments.date,
        campaign.name,
        campaign.advertising_channel_type,
        metrics.cost_micros,
        metrics.conversions_value,
        metrics.clicks,
        metrics.impressions,
        metrics.conversions
      FROM campaign
      WHERE ${dateClause}
        AND campaign.status != 'REMOVED'
    `;

    const campaignReport = AdsApp.search(campaignQuery);
    let campaignCount = 0;

    while (campaignReport.hasNext()) {
      const row = campaignReport.next();
      const campaignName = row.campaign.name || 'Sem Nome';

      // Se a campanha já teve seus custos detalhados por produto, não duplicamos linha de 'Geral'
      if (campaignsWithProducts.has(campaignName)) {
        continue;
      }

      const investimento = row.metrics.costMicros ? Number((row.metrics.costMicros / 1000000).toFixed(2)) : 0.00;
      const faturamento = row.metrics.conversionsValue ? Number(row.metrics.conversionsValue.toFixed(2)) : 0.00;
      const cliques = row.metrics.clicks || 0;
      const impressoes = row.metrics.impressions || 0;
      const quantidadeVendida = row.metrics.conversions ? Math.round(row.metrics.conversions) : 0;

      // NOTA: roas e roi são gerados no Supabase
      records.push({
        data: row.segments.date,
        nome_campanha: campaignName,
        produto_nome: 'Geral / Campanha',
        investimento: investimento,
        faturamento: faturamento,
        cliques: cliques,
        impressoes: impressoes,
        itens_no_carrinho: 0,
        quantidade_vendida: quantidadeVendida
      });
      campaignCount++;
    }
    Logger.log('Registros adicionais de campanhas gerais: ' + campaignCount);
  } catch (e) {
    Logger.log('Erro ao consultar relatório de campanhas: ' + (e.message || e));
  }

  // 3. Envio em lotes para o Supabase com Upsert
  Logger.log('Total consolidado de linhas para envio: ' + records.length);
  if (records.length === 0) {
    Logger.log('Nenhum dado encontrado no período selecionado.');
    return;
  }

  sendToSupabase(records);
  Logger.log('>>> Sincronização concluída com sucesso!');
}

/**
 * Calcula a cláusula BETWEEN para datas compatível com a sintaxe do GAQL
 */
function getDateFilterClause(daysBack) {
  const timeZone = AdsApp.currentAccount().getTimeZone();
  const today = new Date();
  const pastDate = new Date();
  pastDate.setDate(today.getDate() - daysBack);

  const startDate = Utilities.formatDate(pastDate, timeZone, 'yyyy-MM-dd');
  const endDate = Utilities.formatDate(today, timeZone, 'yyyy-MM-dd');

  return `segments.date BETWEEN '${startDate}' AND '${endDate}'`;
}

/**
 * Envia os registros para o Supabase em lotes utilizando a API REST (PostgREST)
 * Usa Prefer: resolution=merge-duplicates para fazer UPSERT na chave única (data, nome_campanha, produto_nome)
 */
function sendToSupabase(records) {
  const endpoint = CONFIG.SUPABASE_URL.replace(/\/+$/, '') + 
    '/rest/v1/' + CONFIG.TABLE_NAME + 
    '?on_conflict=data,nome_campanha,produto_nome';

  const headers = {
    'apikey': CONFIG.SUPABASE_KEY,
    'Authorization': 'Bearer ' + CONFIG.SUPABASE_KEY,
    'Content-Type': 'application/json',
    'Prefer': 'resolution=merge-duplicates'
  };

  const totalBatches = Math.ceil(records.length / CONFIG.BATCH_SIZE);
  Logger.log(`Iniciando envio de ${records.length} registros em ${totalBatches} lote(s)...`);

  for (let i = 0; i < records.length; i += CONFIG.BATCH_SIZE) {
    const batch = records.slice(i, i + CONFIG.BATCH_SIZE);
    const batchNumber = Math.floor(i / CONFIG.BATCH_SIZE) + 1;

    const options = {
      method: 'post',
      headers: headers,
      payload: JSON.stringify(batch),
      muteHttpExceptions: true
    };

    try {
      const response = UrlFetchApp.fetch(endpoint, options);
      const statusCode = response.getResponseCode();

      if (statusCode >= 200 && statusCode < 300) {
        Logger.log(`Lote ${batchNumber}/${totalBatches} enviado com sucesso (${batch.length} registros).`);
      } else {
        Logger.log(`Erro no lote ${batchNumber}/${totalBatches}. Código HTTP: ${statusCode}. Resposta: ${response.getContentText()}`);
      }
    } catch (err) {
      Logger.log(`Exceção ao enviar lote ${batchNumber}: ` + err.message);
    }

    // Pausa suave para respeitar limites de requisições
    Utilities.sleep(150);
  }
}
