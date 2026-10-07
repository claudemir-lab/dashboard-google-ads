/**
 * DIAGNÓSTICO DE CONVERSÕES — Google Ads
 * ----------------------------------------------------------------------------
 * Objetivo: descobrir de onde vem cada valor, para justificar à coordenação:
 *   - quanto vale o "Faturamento (Campanha)" e o que compõe ele
 *   - quanto vale o "Faturamento (Produtos)" (carrinho)
 *   - qual a diferença entre os dois
 *
 * O script APENAS lê e imprime no Log. NÃO altera nada na conta.
 * ----------------------------------------------------------------------------
 * Como usar: cole num script novo no Google Ads -> Salvar -> Executar.
 */

function main() {
  var tz = AdsApp.currentAccount().getTimeZone();
  var hoje = new Date();
  var inicio90 = new Date(hoje.getTime() - 89 * 24 * 3600 * 1000);

  var periodos = [
    { rotulo: 'SETEMBRO/2026', de: '2026-09-01', ate: '2026-09-30' },
    { rotulo: '90 DIAS', de: fmt(inicio90, tz), ate: fmt(hoje, tz) }
  ];

  Logger.log('================================================================');
  Logger.log('DIAGNÓSTICO DE CONVERSÕES — ' + AdsApp.currentAccount().getName());
  Logger.log('Conta: ' + AdsApp.currentAccount().getCustomerId() + ' | fuso: ' + tz);
  Logger.log('Gerado em: ' + fmt(hoje, tz));
  Logger.log('================================================================');

  // -------------------------------------------------------------------
  // 1) Cadastro das ações de conversão (o que existe na conta)
  // -------------------------------------------------------------------
  var acoes = {};
  var q1 =
    "SELECT conversion_action.id, conversion_action.name, conversion_action.category, " +
    "conversion_action.status, conversion_action.counting_type, " +
    "conversion_action.include_in_conversions_metric, " +
    "conversion_action.click_through_lookback_window_days, " +
    "conversion_action.view_through_lookback_window_days, " +
    "conversion_action.value_settings.default_value, " +
    "conversion_action.value_settings.always_use_default_value, " +
    "conversion_action.attribution_model_settings.attribution_model " +
    "FROM conversion_action WHERE conversion_action.status != 'REMOVED'";

  var q1ok = false;
  try {
    each(function (row) {
      var a = row.conversionAction;
      acoes[String(a.id)] = {
        nome: a.name,
        categoria: a.category,
        status: a.status,
        counting: a.countingType,
        contaConversao: a.includeInConversionsMetric,
        janelaClique: a.clickThroughLookbackWindowDays,
        janelaView: a.viewThroughLookbackWindowDays,
        valorPadrao: a.valueSettings && a.valueSettings.defaultValue,
        sempreValorPadrao: a.valueSettings && a.valueSettings.alwaysUseDefaultValue,
        atribuicao: a.attributionModelSettings && a.attributionModelSettings.attributionModel
      };
    }, q1);
    q1ok = true;
  } catch (e) {
    Logger.log('[aviso] Q1 completa falhou (' + e.message + '); tentando versão reduzida...');
    try {
      each(function (row) {
        var a = row.conversionAction;
        acoes[String(a.id)] = {
          nome: a.name,
          categoria: a.category,
          status: a.status,
          counting: a.countingType,
          contaConversao: a.includeInConversionsMetric,
          janelaClique: a.clickThroughLookbackWindowDays,
          atribuicao: a.attributionModelSettings && a.attributionModelSettings.attributionModel
        };
      }, "SELECT conversion_action.id, conversion_action.name, conversion_action.category, " +
         "conversion_action.status, conversion_action.counting_type, " +
         "conversion_action.include_in_conversions_metric, " +
         "conversion_action.click_through_lookback_window_days, " +
         "conversion_action.attribution_model_settings.attribution_model " +
         "FROM conversion_action WHERE conversion_action.status != 'REMOVED'");
      q1ok = true;
    } catch (e2) {
      Logger.log('[ERRO] não consegui listar as ações de conversão: ' + e2.message);
    }
  }

  Logger.log('');
  Logger.log('--- 1) AÇÕES DE CONVERSÃO DA CONTA (' + Object.keys(acoes).length + ') ---');
  var ids = Object.keys(acoes);
  if (ids.length === 0) {
    Logger.log('  (nenhuma encontrada)');
  }
  ids.forEach(function (id) {
    var a = acoes[id];
    Logger.log('  [' + id + '] ' + a.nome +
      ' | cat=' + a.categoria +
      ' | status=' + a.status +
      ' | conta_em_Conversoes=' + a.contaConversao +
      ' | contagem=' + a.counting +
      ' | janela=' + a.janelaClique + 'd' +
      ' | atribuicao=' + (a.atribuicao || '?') +
      (a.valorPadrao != null ? ' | VALOR_PADRAO=' + a.valorPadrao + (a.sempreValorPadrao ? ' (sempre)' : '') : ''));
  });

  // -------------------------------------------------------------------
  // 2) Métricas por ação de conversão, em cada período
  // -------------------------------------------------------------------
  Logger.log('');
  Logger.log('--- 2) MÉTRICAS POR AÇÃO DE CONVERSÃO ---');
  Logger.log('    ("Conversões"/"Faturamento" = conta na métrica CONVERSIONS;');
  Logger.log('     "Todas conv." = inclui eventos que NÃO viram pedido))');

  var resumo = {};
  periodos.forEach(function (p) {
    resumo[p.rotulo] = {
      porAcao: [],
      totalConv: 0,
      totalFat: 0,
      totalTodasConv: 0,
      totalTodasFat: 0,
      receitaCarrinho: 0,
      unidades: 0,
      custo: 0,
      cliques: 0,
      impressoes: 0
    };

    var mq =
      "SELECT conversion_action.id, conversion_action.name, conversion_action.category, " +
      "metrics.conversions, metrics.conversions_value, " +
      "metrics.all_conversions, metrics.all_conversions_value " +
      "FROM conversion_action " +
      "WHERE segments.date BETWEEN '" + p.de + "' AND '" + p.ate + "' " +
      "AND conversion_action.status != 'REMOVED'";

    var linhas = [];
    try {
      each(function (row) {
        linhas.push(row);
      }, mq);
    } catch (e) {
      // fallback: agregado por campanha + segmento de conversão
      Logger.log('  [aviso] Q2 falhou (' + e.message + '); usando fallback por campanha...');
      try {
        each(function (row) {
          linhas.push({
            conversionAction: {
              id: String(row.segments.conversionAction || '').split('/').pop(),
              name: '(segmento ' + String(row.segments.conversionAction || '').split('/').pop() + ')',
              category: ''
            },
            metrics: row.metrics
          });
        }, "SELECT segments.conversion_action, metrics.conversions, metrics.conversions_value, " +
           "metrics.all_conversions, metrics.all_conversions_value " +
           "FROM campaign WHERE segments.date BETWEEN '" + p.de + "' AND '" + p.ate + "' " +
           "AND campaign.status != 'REMOVED'");
      } catch (e2) {
        Logger.log('  [ERRO] fallback também falhou: ' + e2.message);
      }
    }

    linhas.forEach(function (row) {
      var m = row.metrics || {};
      var a = row.conversionAction || {};
      var nome = a.name || acoes[String(a.id)] && acoes[String(a.id)].nome || ('id ' + a.id);
      var conv = num(m.conversions);
      var fat = num(m.conversionsValue);
      var todasConv = num(m.allConversions);
      var todasFat = num(m.allConversionsValue);
      resumo[p.rotulo].totalConv += conv;
      resumo[p.rotulo].totalFat += fat;
      resumo[p.rotulo].totalTodasConv += todasConv;
      resumo[p.rotulo].totalTodasFat += todasFat;
      if (conv > 0 || fat > 0 || todasConv > 0 || todasFat > 0) {
        resumo[p.rotulo].porAcao.push({
          nome: nome,
          cat: a.category || (acoes[String(a.id)] || {}).categoria || '',
          conv: conv,
          fat: fat,
          todasConv: todasConv,
          todasFat: todasFat
        });
      }
    });

    // receita do carrinho (cart data)
    try {
      each(function (row) {
        resumo[p.rotulo].receitaCarrinho += num(row.metrics.revenueMicros) / 1000000;
        resumo[p.rotulo].unidades += num(row.metrics.unitsSold);
      }, "SELECT segments.date, metrics.revenue_micros, metrics.units_sold " +
         "FROM cart_data_sales_view WHERE segments.date BETWEEN '" + p.de + "' AND '" + p.ate + "'");
    } catch (e) {
      Logger.log('  [erro] cart data: ' + e.message);
    }

    // custo / cliques da campanha
    try {
      each(function (row) {
        resumo[p.rotulo].custo += num(row.metrics.costMicros) / 1000000;
        resumo[p.rotulo].cliques += num(row.metrics.clicks);
        resumo[p.rotulo].impressoes += num(row.metrics.impressions);
      }, "SELECT metrics.cost_micros, metrics.clicks, metrics.impressions " +
         "FROM campaign WHERE segments.date BETWEEN '" + p.de + "' AND '" + p.ate + "' " +
         "AND campaign.status != 'REMOVED'");
    } catch (e) {
      Logger.log('  [erro] campanha: ' + e.message);
    }
  });

  periodos.forEach(function (p) {
    var r = resumo[p.rotulo];
    Logger.log('');
    Logger.log('  === ' + p.rotulo + ' (' + p.de + ' a ' + p.ate + ') ===');
    Logger.log('  Custo: R$ ' + r.custo.toFixed(2) + ' | ' + r.impressoes + ' impressões | ' + r.cliques + ' cliques');
    r.porAcao.sort(function (a, b) { return b.fat - a.fat; });
    if (r.porAcao.length === 0) Logger.log('    (nenhuma ação com movimento)');
    r.porAcao.forEach(function (x) {
      Logger.log('    ' + pad(x.nome, 42) + ' | conv=' + padN(x.conv, 6) +
        ' | Faturamento R$ ' + padN(x.fat.toFixed(2), 10) +
        ' | todasConv=' + padN(x.todasConv, 7) +
        ' | todasFat R$ ' + padN(x.todasFat.toFixed(2), 12) +
        (x.cat ? ' | ' + x.cat : ''));
    });
    Logger.log('    ' + pad('[TOTAL Conversões]', 42) + ' | conv=' + padN(r.totalConv, 6) +
      ' | Faturamento R$ ' + padN(r.totalFat.toFixed(2), 10));
    Logger.log('    ' + pad('[TOTAL Todas conv.]', 42) + ' | conv=' + padN(r.totalTodasConv, 6) +
      ' | valor     R$ ' + padN(r.totalTodasFat.toFixed(2), 12));
    Logger.log('    [CARRINHO / cart data] receita R$ ' + r.receitaCarrinho.toFixed(2) +
      ' | unidades ' + r.unidades);
    if (r.totalConv > 0) {
      Logger.log('    >>> valor de conversão POR PEDIDO: R$ ' + (r.totalFat / r.totalConv).toFixed(2));
    }
    if (r.unidades > 0) {
      Logger.log('    >>> receita POR ITEM vendido: R$ ' + (r.receitaCarrinho / r.unidades).toFixed(2));
    }
    if (r.totalConv > 0 && r.unidades > 0) {
      Logger.log('    >>> receita POR PEDIDO (carrinho): R$ ' + (r.receitaCarrinho / r.totalConv).toFixed(2));
    }
    Logger.log('    >>> DIFERENÇA: R$ ' + (r.receitaCarrinho - r.totalFat).toFixed(2) +
      ' (carrinho - valor de conversão)');
    if (r.custo > 0) {
      Logger.log('    >>> ROAS com valor de conversão: ' + (r.totalFat / r.custo).toFixed(2) + 'x' +
        '  |  ROAS com receita do carrinho: ' + (r.receitaCarrinho / r.custo).toFixed(2) + 'x');
    }
  });

  // -------------------------------------------------------------------
  // 3) Conclusão automática
  // -------------------------------------------------------------------
  var set = resumo['SETEMBRO/2026'];
  if (set) {
    Logger.log('');
    Logger.log('================================================================');
    Logger.log('CONCLUSÃO (setembro/2026)');
    Logger.log('================================================================');
    Logger.log('Investimento ............ R$ ' + set.custo.toFixed(2));
    Logger.log('Pedidos (conversões) .... ' + set.totalConv);
    Logger.log('Itens vendidos .......... ' + set.unidades);
    Logger.log('Valor de conversão (Ads)  R$ ' + set.totalFat.toFixed(2) +
      '   <- métrica de atribuição do Google');
    Logger.log('Receita dos itens ....... R$ ' + set.receitaCarrinho.toFixed(2) +
      '   <- preço dos produtos realmente comprados');
    Logger.log('Diferença ............... R$ ' + (set.receitaCarrinho - set.totalFat).toFixed(2));
    Logger.log('');
    Logger.log('Recomendação: usar a RECEITA DOS ITENS (R$ ' + set.receitaCarrinho.toFixed(2) +
      ') como faturamento,');
    Logger.log('e validar contra o total do Shopify do mês.');
    Logger.log('================================================================');
  }

  Logger.log('');
  Logger.log('Fim do diagnóstico (nada foi alterado na conta).');
}

// ----------------------------------------------------------------------------
function each(fn, query) {
  var it = AdsApp.search(query);
  while (it.hasNext()) fn(it.next());
}

function num(v) {
  return v == null || v === '' ? 0 : Number(v);
}

function fmt(d, tz) {
  return Utilities.formatDate(d, tz, 'yyyy-MM-dd');
}

function pad(s, n) {
  s = String(s);
  while (s.length < n) s += ' ';
  return s;
}

function padN(s, n) {
  s = String(s);
  while (s.length < n) s = ' ' + s;
  return s;
}
