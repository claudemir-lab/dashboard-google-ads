/**
 * ============================================================================
 * DIAGNOSTICO DEFINITIVO: QUEDA DE CONVERSOES A PARTIR DE 05/10/2026
 * ----------------------------------------------------------------------------
 * Roda tudo de uma vez e diz no fim QUEM parou e QUANDO.
 *   A) Lista TODAS as acoes de conversao (inclusive REMOVIDAS) + detalhes.
 *   B) Resumo por acao: conv nos ultimos 7 / 8-30 / 31-60 dias + ultimo dia.
 *   C) Conversoes por DIA x ACAO (ultimos 45 dias).
 *   D) Cart data (itens vendidos) por dia.
 *   E) Metas de conversao da conta (tenta; se falhar, ignora).
 *   F) CONCLUSAO automatica.
 *
 * SOMENTE LEITURA. Nao altera nada na conta.
 * Como usar: Google Ads -> Ferramentas -> Acoes em massa -> Scripts ->
 *            novo script -> cole tudo -> Salvar -> Executar -> copie o LOG.
 * ============================================================================
 */

function main() {
  var tz = AdsApp.currentAccount().getTimeZone();
  var hoje = new Date();
  var DIAS = 60;
  var de = fmt(new Date(hoje.getTime() - DIAS * 24 * 3600 * 1000), tz);
  var ate = fmt(hoje, tz);

  Logger.log('================================================================');
  Logger.log('DIAGNOSTICO DEFINITIVO DE CONVERSOES');
  Logger.log('Conta: ' + AdsApp.currentAccount().getName() +
             ' | ID: ' + AdsApp.currentAccount().getCustomerId() + ' | fuso: ' + tz);
  Logger.log('Periodo: ' + de + ' a ' + ate);
  Logger.log('================================================================');

  // ===================== A) TODAS AS ACOES =====================
  Logger.log('');
  Logger.log('--- A) ACOES DE CONVERSAO (inclusive REMOVIDAS) ---');
  var acoes = {};
  try {
    var itA = AdsApp.search(
      'SELECT conversion_action.id, conversion_action.name, conversion_action.status, ' +
      'conversion_action.category, conversion_action.include_in_conversions_metric, ' +
      'conversion_action.counting_type, conversion_action.type, ' +
      'conversion_action.click_through_lookback_window_days ' +
      'FROM conversion_action');
    while (itA.hasNext()) {
      var a = itA.next().conversionAction;
      acoes[String(a.id)] = a.name;
      Logger.log('  [' + a.id + '] ' + pad(a.name, 42) +
                 ' | status=' + a.status +
                 ' | conta=' + a.includeInConversionsMetric +
                 ' | cat=' + a.category +
                 ' | cnt=' + a.countingType +
                 ' | tipo=' + a.type +
                 ' | janela=' + a.clickThroughLookbackWindowDays + 'd');
    }
    Logger.log('  Total: ' + Object.keys(acoes).length);
  } catch (e) {
    Logger.log('  [ERRO] ' + e.message);
  }

  // ===================== C) POR DIA x ACAO =====================
  var porDia = {}; // data -> { acao -> {conv, fat} }
  try {
    var itB = AdsApp.search(
      "SELECT segments.date, conversion_action.name, metrics.conversions, metrics.conversions_value " +
      "FROM conversion_action WHERE segments.date BETWEEN '" + de + "' AND '" + ate + "'");
    while (itB.hasNext()) {
      var r = itB.next();
      var d = r.segments.date, nome = r.conversionAction.name || '?';
      if (!porDia[d]) porDia[d] = {};
      if (!porDia[d][nome]) porDia[d][nome] = { conv: 0, fat: 0 };
      porDia[d][nome].conv += Number(r.metrics.conversions || 0);
      porDia[d][nome].fat += Number(r.metrics.conversionsValue || 0);
    }
  } catch (e) {
    Logger.log('[ERRO] por-dia: ' + e.message);
  }

  // ===================== B) RESUMO POR ACAO =====================
  Logger.log('');
  Logger.log('--- B) RESUMO POR ACAO (por periodo) ---');
  Logger.log('    acao | conv 1-7d | conv 8-30d | conv 31-60d | ultimo dia com conv');
  var datasOrd = Object.keys(porDia).sort();
  var resumo = {}; // acao -> {c7,c30,c60,ultimo}
  datasOrd.forEach(function (d) {
    var idade = dias(de, d); // dias desde o inicio do periodo
    Object.keys(porDia[d]).forEach(function (nome) {
      if (!resumo[nome]) resumo[nome] = { c7: 0, c30: 0, c60: 0, ultimo: null, fat: 0 };
      var v = porDia[d][nome];
      resumo[nome].c60 += v.conv;
      if (idade >= (DIAS - 30)) resumo[nome].c30 += v.conv;
      if (idade >= (DIAS - 7)) resumo[nome].c7 += v.conv;
      if (v.conv > 0 || v.fat > 0) resumo[nome].ultimo = d;
      resumo[nome].fat += v.fat;
    });
  });
  Object.keys(resumo).forEach(function (nome) {
    var x = resumo[nome];
    Logger.log('  ' + pad(nome, 42) + ' | ' + padN(x.c7.toFixed(0), 9) + ' | ' +
               padN(x.c30.toFixed(0), 9) + ' | ' + padN(x.c60.toFixed(0), 10) + ' | ' +
               (x.ultimo || '(nenhum)'));
  });

  // ===================== C) POR DIA (ultimos 21) =====================
  Logger.log('');
  Logger.log('--- C) CONVERSOES POR DIA x ACAO (ultimos 21 dias) ---');
  var corte = fmt(new Date(hoje.getTime() - 21 * 24 * 3600 * 1000), tz);
  datasOrd.forEach(function (d) {
    if (d < corte) return;
    var partes = Object.keys(porDia[d]).filter(function (n) {
      return porDia[d][n].conv > 0 || porDia[d][n].fat > 0;
    }).map(function (n) {
      return n + '=' + porDia[d][n].conv.toFixed(0) + ' (R$ ' + porDia[d][n].fat.toFixed(2) + ')';
    });
    Logger.log('  ' + d + '  ' + (partes.length ? partes.join('  | ') : '(ZERO)'));
  });

  // ===================== D) CART DATA =====================
  Logger.log('');
  Logger.log('--- D) CART DATA (itens vendidos) POR DIA (ultimos 30) ---');
  var corteCart = fmt(new Date(hoje.getTime() - 30 * 24 * 3600 * 1000), tz);
  try {
    var itC = AdsApp.search(
      "SELECT segments.date, metrics.revenue_micros, metrics.units_sold FROM cart_data_sales_view " +
      "WHERE segments.date BETWEEN '" + de + "' AND '" + ate + "'");
    var nC = 0, ultCart = null;
    while (itC.hasNext()) {
      var r3 = itC.next();
      ultCart = r3.segments.date;
      if (r3.segments.date >= corteCart) {
        Logger.log('  ' + r3.segments.date + ' | receita R$ ' +
                   (Number(r3.metrics.revenueMicros || 0) / 1000000).toFixed(2) +
                   ' | unidades ' + Number(r3.metrics.unitsSold || 0));
        nC++;
      }
    }
    if (nC === 0) Logger.log('  (nenhuma linha nos ultimos 30 dias)');
    Logger.log('  >>> Ultimo dia com cart data: ' + (ultCart || '(nenhum)'));
  } catch (e) {
    Logger.log('  [ERRO] ' + e.message);
  }

  // ===================== E) METAS DA CONTA =====================
  Logger.log('');
  Logger.log('--- E) METAS DE CONVERSAO DA CONTA (customer_conversion_goal) ---');
  try {
    var itE = AdsApp.search(
      'SELECT customer_conversion_goal.category, customer_conversion_goal.origin ' +
      'FROM customer_conversion_goal');
    var nE = 0;
    while (itE.hasNext()) {
      var g = itE.next().customerConversionGoal;
      Logger.log('  cat=' + g.category + ' | origem=' + g.origin);
      nE++;
    }
    if (nE === 0) Logger.log('  (nenhuma meta retornada)');
  } catch (e) {
    Logger.log('  [nao disponivel] ' + e.message);
  }

  // ===================== F) CONCLUSAO =====================
  Logger.log('');
  Logger.log('================================================================');
  Logger.log('CONCLUSAO');
  Logger.log('================================================================');
  var mortas = [];
  Object.keys(resumo).forEach(function (nome) {
    if (resumo[nome].c7 === 0 && resumo[nome].c30 > 0) mortas.push(nome + ' (parou em ' + resumo[nome].ultimo + ')');
  });
  if (mortas.length) {
    Logger.log('Acao(oes) que TINHAM conversao e pararam nos ultimos 7-30d:');
    mortas.forEach(function (m) { Logger.log('  -> ' + m); });
  } else {
    Logger.log('Nenhuma acao com queda clara no periodo. Veja a secao C.');
  }
  Logger.log('');
  Logger.log('Fim. Nada foi alterado na conta.');
}

function fmt(d, tz) { return Utilities.formatDate(d, tz, 'yyyy-MM-dd'); }
function dias(de, ate) {
  return Math.round((new Date(ate + 'T00:00:00') - new Date(de + 'T00:00:00')) / 86400000);
}
function pad(s, n) { s = String(s); while (s.length < n) s += ' '; return s; }
function padN(s, n) { s = String(s); while (s.length < n) s = ' ' + s; return s; }
