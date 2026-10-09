const url = 'https://bbitajwmcapohixocavn.supabase.co/rest/v1/gads_dashboard?select=*';
const KEY = 'sb_publishable_fNQDTEEbDQvMBbK8M4Dqeg_j-5QF2sS';

fetch(url, { headers: { apikey: KEY, Authorization: 'Bearer ' + KEY } })
  .then(r => r.json())
  .then(rows => {
    const isCamp = r => r.produto_nome === 'Geral / Campanha';
    const camp = rows.filter(isCamp);
    const prod = rows.filter(r => !isCamp(r));
    const sum = (a, f) => a.reduce((s, x) => s + Number(f(x) || 0), 0);

    const inv = sum(camp, r => r.investimento);
    const conv = sum(camp, r => r.quantidade_vendida);
    const carrinho = sum(camp, r => r.itens_no_carrinho);
    const cliques = sum(camp, r => r.cliques);
    const impressoes = sum(camp, r => r.impressoes);
    const fat = sum(camp, r => r.faturamento);
    const unidProd = sum(prod, r => r.quantidade_vendida);

    console.log('=== TOTAL (90+ dias) ===');
    console.log('Investimento: R$ ' + inv.toFixed(2));
    console.log('Conversoes (vendas Ads): ' + conv);
    console.log('Itens no carrinho: ' + carrinho);
    console.log('Unidades vendidas (produto rows): ' + unidProd);
    console.log('');
    console.log('CAC = investimento / conversoes: R$ ' + (inv / conv).toFixed(2));
    console.log('Custo por item de carrinho: R$ ' + (inv / carrinho).toFixed(2));
    console.log('CPC: R$ ' + (inv / cliques).toFixed(2));
    console.log('CPM: R$ ' + (inv / impressoes * 1000).toFixed(2));
    console.log('LTV proxy (faturamento/conversao): R$ ' + (fat / conv).toFixed(2));
    console.log('');

    console.log('=== POR CAMPANHA ===');
    const byC = {};
    camp.forEach(r => {
      const n = r.nome_campanha;
      byC[n] = byC[n] || { inv: 0, conv: 0, carrinho: 0, fat: 0 };
      byC[n].inv += Number(r.investimento || 0);
      byC[n].conv += Number(r.quantidade_vendida || 0);
      byC[n].carrinho += Number(r.itens_no_carrinho || 0);
      byC[n].fat += Number(r.faturamento || 0);
    });
    Object.entries(byC)
      .sort((a, b) => b[1].inv - a[1].inv)
      .forEach(([n, v]) => {
        console.log(n);
        console.log('   inv R$' + v.inv.toFixed(2) + ' | conv ' + v.conv +
          ' | carrinho ' + v.carrinho +
          ' | CAC ' + (v.conv > 0 ? 'R$ ' + (v.inv / v.conv).toFixed(2) : 'n/d (0 conversao)'));
      });
  })
  .catch(e => { console.error('ERRO:', e.message); process.exit(1); });
