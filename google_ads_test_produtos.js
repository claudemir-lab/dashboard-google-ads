/**
 * ==============================================================================
 * TESTE: listar PRODUTOS VENDIDOS (cart data) da conta do Google Ads
 * ==============================================================================
 * 
 * ESTE SCRIPT É SÓ DE DIAGNÓSTICO - ele NÃO envia nada para o Supabase.
 * Ele apenas mostra na tela se conseguimos capturar automaticamente os
 * produtos vendidos (ex.: R$ 2.859,42 que aparece no relatório de Produtos).
 *
 * Como rodar:
 * 1. Acesse ads.google.com > Ferramentas e Configurações > Ações em massa > Scripts.
 * 2. Clique em "+" para criar um NOVO script (não mexa no "Dashboard Google").
 * 3. Cole TODO o conteúdo abaixo.
 * 4. Clique em "Salvar" e depois em "Executar".
 * 5. Abra o "Registro de log" (botão de registro de log) e ME ENVIE o texto.
 * ==============================================================================
 */

function main() {
  Logger.log('>>> Diagnóstico: produtos vendidos via cart data...');
  Logger.log('Conta: ' + AdsApp.currentAccount().getName() + ' (' + AdsApp.currentAccount().getCustomerId() + ')');

  const dates = getDates(90);
  Logger.log('Período: ' + dates.startDate + ' até ' + dates.endDate);

  // TENTATIVA 1: cart_data_sales_view (itens do carrinho vendidos)
  // É o relatório que gera a coluna "Receita" por produto.
  const tentativas = [
    {
      nome: 'cart_data_sales_view',
      query: `SELECT
        segments.date,
        campaign.name,
        campaign.advertising_channel_type,
        segments.product_sold_title,
        segments.product_sold_item_id,
        metrics.units_sold,
        metrics.revenue_micros,
        metrics.conversions,
        metrics.conversions_value
      FROM cart_data_sales_view
      WHERE segments.date BETWEEN '${dates.startDate}' AND '${dates.endDate}'
      ORDER BY metrics.revenue_micros DESC`
    },
    {
      nome: 'shopping_performance_view (cart data)',
      query: `SELECT
        segments.date,
        campaign.name,
        segments.product_title,
        metrics.units_sold,
        metrics.revenue_micros,
        metrics.conversions,
        metrics.conversions_value
      FROM shopping_performance_view
      WHERE segments.date BETWEEN '${dates.startDate}' AND '${dates.endDate}'
        AND metrics.revenue_micros > 0
      ORDER BY metrics.revenue_micros DESC`
    }
  ];

  for (const t of tentativas) {
    Logger.log('--------------------------------------------------');
    Logger.log('TENTATIVA: ' + t.nome);
    try {
      const report = AdsApp.search(t.query);
      let linhas = 0;
      let receitaTotal = 0;
      let unidadesTotal = 0;
      const detalhes = [];

      while (report.hasNext()) {
        const row = report.next();
        const receita = row.metrics.revenueMicros ? Number(row.metrics.revenueMicros) / 1000000 : 0;
        const unidades = row.metrics.unitsSold || 0;
        receitaTotal += receita;
        unidadesTotal += Number(unidades);
        linhas++;

        if (detalhes.length < 25 && receita > 0) {
          detalhes.push(
            (row.segments.date || '?') +
            ' | ' + (row.campaign.name || '?') +
            ' [' + (row.campaign.advertisingChannelType || '?') + ']' +
            ' | ' + (row.segments.productSoldTitle || row.segments.productTitle || '(sem título)') +
            ' | unid: ' + unidades +
            ' | R$ ' + receita.toFixed(2)
          );
        }
      }

      Logger.log('Linhas encontradas: ' + linhas);
      Logger.log('Unidades vendidas: ' + unidadesTotal);
      Logger.log('RECEITA TOTAL: R$ ' + receitaTotal.toFixed(2));
      if (linhas === 0) {
        Logger.log('>> Nenhuma linha. Relatório indisponível nesta conta.');
      } else {
        Logger.log('Primeiras linhas (até 25):');
        for (const d of detalhes) Logger.log('  ' + d);
      }
    } catch (e) {
      Logger.log('ERRO nesta tentativa: ' + (e.message || e));
    }
  }

  // TENTATIVA 2: só pra confirmar que shopping_performance_view segue vazio
  Logger.log('--------------------------------------------------');
  Logger.log('TENTATIVA: shopping_performance_view (sem cart data)');
  try {
    const r = AdsApp.search(`SELECT segments.date, campaign.name, segments.product_title, metrics.clicks
      FROM shopping_performance_view
      WHERE segments.date BETWEEN '${dates.startDate}' AND '${dates.endDate}'`);
    let n = 0;
    while (r.hasNext()) { r.next(); n++; }
    Logger.log('Linhas: ' + n);
  } catch (e) {
    Logger.log('ERRO: ' + (e.message || e));
  }

  Logger.log('>>> Diagnóstico concluído.');
}

function getDates(daysBack) {
  const timeZone = AdsApp.currentAccount().getTimeZone();
  const format = 'yyyy-MM-dd';
  const today = new Date();
  const past = new Date();
  past.setDate(today.getDate() - daysBack);
  return {
    startDate: Utilities.formatDate(past, timeZone, format),
    endDate: Utilities.formatDate(today, timeZone, format)
  };
}
