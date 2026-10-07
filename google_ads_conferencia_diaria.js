/**
 * CONFERÊNCIA DIÁRIA — Valor de conversão x Receita do carrinho
 * ----------------------------------------------------------------------------
 * Objetivo: descobrir de QUEM vem a diferença de ~45% entre
 *   - "Faturamento (Campanha)"  = metrics.conversions_value  (R$ 93,15/pedido)
 *   - "Faturamento (Produtos)"  = metrics.revenue_micros     (R$ 168,20/pedido)
 *
 * Sai uma tabela por DIA: vemos se a diferença é fixa (%) ou se há dias em
 * que um conta e o outro não (janela de conversão / atribuição).
 *
 * Somente leitura. Nada é alterado na conta.
 * ----------------------------------------------------------------------------
 * Como usar: cole num script novo no Google Ads -> Salvar -> Executar.
 */

var CONFIG = {
  de: '2026-09-01',
  ate: '2026-09-30',

  // Deixe '' para ver todos os produtos.
  // Preencha para rastrear um item específico.
  produto: ''
};

function main() {
  var tz = AdsApp.currentAccount().getTimeZone();
  Logger.log('===============================================================');
  Logger.log('CONFERÊNCIA DIÁRIA — ' + AdsApp.currentAccount().getName());
  Logger.log('Período: ' + CONFIG.de + ' a ' + CONFIG.ate + ' | fuso ' + tz);
  Logger.log('===============================================================');

  // ---------------------------------------------------------------------
  // 1) Métricas de campanha por dia
  // ---------------------------------------------------------------------
  var porDia = {};
  function dia(d) {
    if (!porDia[d]) porDia[d] = { conv: 0, valor: 0, cart: 0, itens: 0, custo: 0, clique: 0 };
    return porDia[d];
  }

  try {
    each(function (row) {
      var d = String(row.segments.date);
      dia(d).conv += num(row.metrics.conversions);
      dia(d).valor += num(row.metrics.conversionsValue);
      dia(d).custo += num(row.metrics.costMicros) / 1000000;
      dia(d).clique += num(row.metrics.clicks);
    }, "SELECT segments.date, metrics.conversions, metrics.conversions_value, " +
       "metrics.cost_micros, metrics.clicks FROM campaign " +
       "WHERE segments.date BETWEEN '" + CONFIG.de + "' AND '" + CONFIG.ate + "' " +
       "AND campaign.status != 'REMOVED'");
  } catch (e) {
    Logger.log('[ERRO] métricas de campanha: ' + e.message);
    return;
  }

  // ---------------------------------------------------------------------
  // 2) Receita do carrinho por dia
  // ---------------------------------------------------------------------
  var cartPorDia = {};
  try {
    each(function (row) {
      var d = String(row.segments.date);
      if (!cartPorDia[d]) cartPorDia[d] = { cart: 0, itens: 0 };
      cartPorDia[d].cart += num(row.metrics.revenueMicros) / 1000000;
      cartPorProdutos(row, d);
    }, "SELECT segments.date, segments.productSoldTitle, " +
       "metrics.revenue_micros, metrics.units_sold FROM cart_data_sales_view " +
       "WHERE segments.date BETWEEN '" + CONFIG.de + "' AND '" + CONFIG.ate + "'");
  } catch (e) {
    Logger.log('[ERRO] cart data: ' + e.message);
  }

  var cartProd = {};
  function cartPorProdutos(row, d) {
    var t = row.segments.productSoldTitle || '(sem título)';
    if (!cartProd[t]) cartProd[t] = { cart: 0, itens: 0, dias: [] };
    cartProd[t].cart += num(row.metrics.revenueMicros) / 1000000;
    cartProd[t].itens += num(row.metrics.unitsSold);
    cartProd[t].dias.push(d + ' x' + num(row.metrics.unitsSold));
    cartPorDia[d].itens += num(row.metrics.unitsSold);
  }

  // ---------------------------------------------------------------------
  // 3) Tabela diária
  // ---------------------------------------------------------------------
  var datas = Object.keys(porDia).concat(Object.keys(cartPorDia))
    .filter(function (v, i, a) { return a.indexOf(v) === i; })
    .sort();

  Logger.log('');
  Logger.log('DATA       | CONV | VALOR CONV | RECEITA CART | ITENS | % (conv/cart)');
  Logger.log('-----------|------|------------|--------------|-------|--------------');

  var tConv = 0, tValor = 0, tCart = 0, tItens = 0, tCusto = 0;
  var diasSoCart = 0, diasSoConv = 0, diasZero = 0;

  datas.forEach(function (d) {
    var p = porDia[d] || { conv: 0, valor: 0, custo: 0 };
    var c = cartPorDia[d] || { cart: 0, itens: 0 };
    tConv += p.conv; tValor += p.valor; tCart += c.cart;
    tItens += c.itens; tCusto += (p.custo || 0);

    if (c.cart > 0 && p.valor <= 0) diasSoCart++;
    if (p.valor > 0 && c.cart <= 0) diasSoConv++;
    if (c.cart <= 0 && p.valor <= 0) diasZero++;

    var pct = c.cart > 0 ? ((p.valor / c.cart) * 100).toFixed(0) + '%' : '-';
    Logger.log(
      d + ' | ' + padN(p.conv.toFixed(2), 4) +
      ' | ' + padN(p.valor.toFixed(2), 10) +
      ' | ' + padN(c.cart.toFixed(2), 12) +
      ' | ' + padN(String(c.itens), 5) +
      ' | ' + padN(pct, 13)
    );
  });

  Logger.log('-----------|------|------------|--------------|-------|--------------');
  Logger.log('TOTAL      | ' + padN(tConv.toFixed(2), 4) +
    ' | ' + padN(tValor.toFixed(2), 10) +
    ' | ' + padN(tCart.toFixed(2), 12) +
    ' | ' + padN(String(tItens), 5) +
    ' | ' + padN(tCart > 0 ? ((tValor / tCart) * 100).toFixed(0) + '%' : '-', 13));

  // ---------------------------------------------------------------------
  // 4) Análise
  // ---------------------------------------------------------------------
  Logger.log('');
  Logger.log('--- ANÁLISE ---');
  Logger.log('Dias com receita E valor de conversão : ' + datas.length);
  Logger.log('Dias só com receita (conv = 0) ....... : ' + diasSoCart + '   <- janela de conversão / atribuição');
  Logger.log('Dias só com valor de conversão ....... : ' + diasSoConv);
  Logger.log('Dias sem nada ........................ : ' + diasZero);
  Logger.log('');
  Logger.log('Custo do período ..................... : R$ ' + tCusto.toFixed(2));
  Logger.log('Valor de conversão (coluna Conv.) .... : R$ ' + tValor.toFixed(2));
  Logger.log('Receita do carrinho .................. : R$ ' + tCart.toFixed(2));
  Logger.log('Diferença ............................ : R$ ' + (tCart - tValor).toFixed(2));
  if (tCart > 0) Logger.log('Razão conv/cart ........................ : ' + ((tValor / tCart) * 100).toFixed(1) + '%');
  if (tConv > 0) Logger.log('Valor de conversão POR PEDIDO ......... : R$ ' + (tValor / tConv).toFixed(2));
  if (tItens > 0) Logger.log('Receita POR ITEM ...................... : R$ ' + (tCart / tItens).toFixed(2));
  if (tConv > 0) Logger.log('Itens POR PEDIDO (cart) ............... : ' + (tItens / tConv).toFixed(2));
  if (tCusto > 0) {
    Logger.log('ROAS pela coluna Conversões ........... : ' + (tValor / tCusto).toFixed(2) + 'x');
    Logger.log('ROAS pela receita do carrinho ......... : ' + (tCart / tCusto).toFixed(2) + 'x');
  }

  Logger.log('');
  Logger.log('--- POR PRODUTO (receita do carrinho) ---');
  var nomes = Object.keys(cartProd).sort(function (a, b) { return cartProd[b].cart - cartProd[a].cart; });
  if (nomes.length === 0) Logger.log('  (nenhum)');
  nomes.forEach(function (n) {
    if (CONFIG.produto && n.indexOf(CONFIG.produto) === -1) return;
    var x = cartProd[n];
    Logger.log('  R$ ' + padN(x.cart.toFixed(2), 10) + ' | ' + padN(String(x.itens), 3) + ' un | ' + n);
    Logger.log('      dias: ' + x.dias.join(', '));
  });

  if (CONFIG.produto) {
    Logger.log('');
    Logger.log('--- PRODUTO ESPERCÍFICO: ' + CONFIG.produto + ' ---');
    try {
      var achou = 0;
      each(function (row) {
        achou++;
        Logger.log('  price_micros ....... R$ ' + (num(row.productView.priceMicros) / 1000000).toFixed(2));
        Logger.log('  cost_micros ........ R$ ' + (num(row.productView.costMicros) / 1000000).toFixed(2));
      }, "SELECT product_view.id, product_view.title, product_view.price_micros, " +
         "product_view.cost_micros FROM product_view " +
         "WHERE segments.date BETWEEN '" + CONFIG.de + "' AND '" + CONFIG.ate + "' " +
         "AND product_view.title = '" + esc(CONFIG.produto) + "'");
      if (achou === 0) Logger.log('  (produto não encontrado em product_view com esse título exato)');
    } catch (e) {
      Logger.log('  [aviso] product_view indisponível: ' + e.message);
    }
  }

  Logger.log('');
  Logger.log('Fim da conferência (nada foi alterado na conta).');
}

// ----------------------------------------------------------------------------
function each(fn, query) {
  var it = AdsApp.search(query);
  while (it.hasNext()) fn(it.next());
}
function num(v) { return v == null || v === '' ? 0 : Number(v); }
function esc(s) { return String(s).replace(/'/g, "\\'"); }
function padN(s, n) {
  s = String(s);
  while (s.length < n) s = ' ' + s;
  return s;
}
