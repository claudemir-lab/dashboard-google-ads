/**
 * ==============================================================================
 * SHOPIFY -> SUPABASE (ETAPA 2 - vendas reais por dia)
 * ==============================================================================
 * Puxa os pedidos da loja via GraphQL Admin API (2026-10), agrega por dia e
 * faz UPSERT na tabela shopify_daily do Supabase.
 *
 * Nao usa dependencias externas (apenas Node.js 18+).
 *
 * COMO USAR:
 *   1. Rode o SQL de supabase_shopify_schema.sql no Supabase (1x).
 *   2. Crie o arquivo .env nesta pasta com:
 *        SHOPIFY_STORE=sualoja.myshopify.com
 *        SHOPIFY_CLIENT_ID=xxxx             (Client ID do app Dev Dashboard)
 *        SHOPIFY_CLIENT_SECRET=shpss_xxx    (Client secret do app)
 *        SUPABASE_URL=https://xxx.supabase.co
 *        SUPABASE_KEY=sb_publishable_xxx    (ou service_role)
 *        SHOPIFY_TZ=America/Sao_Paulo
 *        DAYS_BACK=90
 *   3. Teste sem gravar:  node shopify_daily_sync.js --dry-run
 *   4. Gravando no Supabase:  node shopify_daily_sync.js
 *
 * TOKEN (fluxo novo Shopify 2026):
 *   O script troca CLIENT_ID + CLIENT_SECRET por um access token automaticamente
 *   (grant_type=client_credentials). O token dura 24h e e renovado a cada execucao.
 *   Credenciais: Dev Dashboard -> seu app -> Settings -> Client ID / Secret.
 *   Escopos necessarios: read_orders (read_products e read_customers opcionais).
 * ============================================================================== */

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Carrega .env simples (chave=valor, sem dependencia externa)
// ---------------------------------------------------------------------------
(function loadEnv() {
  const p = path.join(__dirname, '.env');
  if (!fs.existsSync(p)) return;
  fs.readFileSync(p, 'utf8').split(/\r?\n/).forEach(line => {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  });
})();

const CFG = {
  store: process.env.SHOPIFY_STORE || '',
  clientId: process.env.SHOPIFY_CLIENT_ID || '',
  clientSecret: process.env.SHOPIFY_CLIENT_SECRET || '',
  supabaseUrl: process.env.SUPABASE_URL || 'https://bbitajwmcapohixocavn.supabase.co',
  supabaseKey: process.env.SUPABASE_KEY || 'sb_publishable_fNQDTEEbDQvMBbK8M4Dqeg_j-5QF2sS',
  tz: process.env.SHOPIFY_TZ || 'America/Sao_Paulo',
  daysBack: parseInt(process.env.DAYS_BACK || '90', 10),
  apiVersion: '2026-10'
};

const DRY_RUN = process.argv.includes('--dry-run');

function fail(msg) {
  console.error('ERRO: ' + msg);
  process.exit(1);
}

if (!CFG.store) fail('Defina SHOPIFY_STORE no .env (ex: minhaloja.myshopify.com)');
if (!CFG.clientId || !CFG.clientSecret) {
  fail('Defina SHOPIFY_CLIENT_ID e SHOPIFY_CLIENT_SECRET no .env');
}

// ---------------------------------------------------------------------------
// Token: troca client_id/client_secret por access token (client_credentials).
// O token expira em 24h; renovamos automaticamente a cada execucao.
// ---------------------------------------------------------------------------
async function getAccessToken() {
  const res = await fetch('https://' + CFG.store + '/admin/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: CFG.clientId,
      client_secret: CFG.clientSecret
    })
  });
  const json = await res.json();
  if (!res.ok || !json.access_token) {
    fail('Falha ao obter token Shopify: ' + JSON.stringify(json));
  }
  return json.access_token;
}
if (DRY_RUN === false && !process.env.SUPABASE_KEY && !process.env.SUPABASE_URL) {
  console.log('AVISO: usando Supabase padrao do projeto.');
}

// ---------------------------------------------------------------------------
// Dia local (fuso da loja) a partir de um ISO timestamp
// ---------------------------------------------------------------------------
function diaLocal(iso) {
  // ex: "2026-10-08T14:30:00-03:00" ou "...Z"
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: CFG.tz, year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date(iso));
}

// ---------------------------------------------------------------------------
// GraphQL: pagina todos os pedidos desde N dias atras
// ---------------------------------------------------------------------------
const QUERY = `
query Pedidos($first: Int!, $after: String, $q: String) {
  orders(first: $first, after: $after, sortKey: CREATED_AT, reverse: false, query: $q) {
    edges {
      node {
        id
        createdAt
        cancelledAt
        totalPriceSet { shopMoney { amount currencyCode } }
        customer { createdAt }
        customerJourneySummary {
          ready
          firstVisit { source landingPage utmParameters { source medium campaign } }
          lastVisit  { source landingPage utmParameters { source medium campaign } }
        }
      }
    }
    pageInfo { hasNextPage endCursor }
  }
}`;

async function fetchOrders() {
  const since = new Date(Date.now() - CFG.daysBack * 86400000);
  const sinceStr = diaLocal(since.toISOString());
  const q = 'created_at:>=' + sinceStr;
  const url = 'https://' + CFG.store + '/admin/api/' + CFG.apiVersion + '/graphql.json';

  const token = await getAccessToken();
  const all = [];
  let after = null;
  let page = 0;

  while (true) {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': token
      },
      body: JSON.stringify({ query: QUERY, variables: { first: 50, after, q } })
    });

    if (!res.ok) {
      const txt = await res.text();
      fail('Shopify HTTP ' + res.status + ' -> ' + txt.slice(0, 500));
    }

    const json = await res.json();
    if (json.errors) fail('GraphQL: ' + JSON.stringify(json.errors).slice(0, 500));

    const conn = json.data.orders;
    all.push(...conn.edges.map(e => e.node));
    page++;
    process.stdout.write('\r  pedidos lidos: ' + all.length + ' (pagina ' + page + ')');
    if (!conn.pageInfo.hasNextPage) break;
    after = conn.pageInfo.endCursor;
  }
  process.stdout.write('\n');
  return all;
}

// ---------------------------------------------------------------------------
// Origem do trafego (marketing) a partir do customerJourneySummary.
// Regra: usa a ultima visita; se for direta/sem fonte, cai na primeira.
// ---------------------------------------------------------------------------
function origemTrafego(order) {
  const j = order.customerJourneySummary;
  if (!j || !j.ready) return 'Desconhecido';
  const last = j.lastVisit, first = j.firstVisit;
  const fonte = (last && last.source) || (first && first.source) || '';
  const utm = (last && last.utmParameters && last.utmParameters.source) ||
              (first && first.utmParameters && first.utmParameters.source) || '';
  const blob = (fonte + ' ' + utm).toLowerCase();

  if (blob.includes('google') || blob.includes('gclid')) return 'Google';
  if (blob.includes('instagram')) return 'Instagram';
  if (blob.includes('facebook') || blob.includes('fb')) return 'Facebook';
  if (blob.includes('tiktok')) return 'TikTok';
  if (blob.includes('youtube')) return 'YouTube';
  if (!fonte || fonte.toLowerCase() === 'direct') return 'Direto';
  return 'Outros';
}

function isGoogle(order) {
  return origemTrafego(order) === 'Google';
}

function aggregate(orders) {
  const byDay = {};
  const day = d => (byDay[d] = byDay[d] || {
    pedidos: 0, faturamento: 0, clientes_novos: 0,
    pedidos_canal_google: 0, faturamento_canal_google: 0
  });

  for (const o of orders) {
    if (o.cancelledAt) continue; // ignora cancelados
    const d = diaLocal(o.createdAt);
    const val = Number(o.totalPriceSet?.shopMoney?.amount || 0);
    const linha = day(d);

    linha.pedidos++;
    linha.faturamento += val;

    // Cliente novo = cadastro criado no mesmo dia do pedido
    if (o.customer?.createdAt && diaLocal(o.customer.createdAt) === d) {
      linha.clientes_novos++;
    }

    if (isGoogle(o)) {
      linha.pedidos_canal_google++;
      linha.faturamento_canal_google += val;
    }
  }

  return Object.entries(byDay)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([data, v]) => ({
      data,
      pedidos: v.pedidos,
      faturamento: Math.round(v.faturamento * 100) / 100,
      clientes_novos: v.clientes_novos,
      pedidos_canal_google: v.pedidos_canal_google,
      faturamento_canal_google: Math.round(v.faturamento_canal_google * 100) / 100
    }));
}

// ---------------------------------------------------------------------------
// UPSERT no Supabase (REST)
// ---------------------------------------------------------------------------
async function upsert(rows) {
  const url = CFG.supabaseUrl + '/rest/v1/shopify_daily?on_conflict=data';
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      apikey: CFG.supabaseKey,
      Authorization: 'Bearer ' + CFG.supabaseKey,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal'
    },
    body: JSON.stringify(rows)
  });
  if (!res.ok) fail('Supabase HTTP ' + res.status + ' -> ' + (await res.text()).slice(0, 500));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
(async () => {
  console.log('===============================================================');
  console.log('ETAPA 2 - Shopify -> Supabase | loja: ' + CFG.store);
  console.log('Ultimos ' + CFG.daysBack + ' dias | fuso: ' + CFG.tz +
    (DRY_RUN ? ' | DRY-RUN (nao grava)' : ''));
  console.log('===============================================================');

  const orders = await fetchOrders();
  console.log('Pedidos lidos (total, inclui cancelados): ' + orders.length);

  const rows = aggregate(orders);
  if (rows.length === 0) fail('Nenhum pedido encontrado no periodo.');

  // Tabela resumo
  const tot = rows.reduce((s, r) => ({
    pedidos: s.pedidos + r.pedidos,
    fat: s.fat + r.faturamento,
    novos: s.novos + r.clientes_novos,
    pg: s.pg + r.pedidos_canal_google,
    fg: s.fg + r.faturamento_canal_google
  }), { pedidos: 0, fat: 0, novos: 0, pg: 0, fg: 0 });

  console.log('\nDias agregados: ' + rows.length +
    ' (' + rows[0].data + ' -> ' + rows[rows.length - 1].data + ')');
  console.log('TOTAL: pedidos ' + tot.pedidos +
    ' | faturamento R$ ' + tot.fat.toFixed(2) +
    ' | clientes novos ' + tot.novos +
    ' | canal Google: ' + tot.pg + ' pedidos / R$ ' + tot.fg.toFixed(2));
  if (tot.fat > 0) {
    console.log('Canal Google = ' + (tot.fg / tot.fat * 100).toFixed(1) +
      '% do faturamento');
  }

  console.log('\nUltimos 5 dias:');
  rows.slice(-5).forEach(r => {
    console.log('  ' + r.data +
      ' | pedidos ' + r.pedidos +
      ' | R$ ' + r.faturamento.toFixed(2) +
      ' | novos ' + r.clientes_novos +
      ' | google ' + r.pedidos_canal_google + '/R$' + r.faturamento_canal_google.toFixed(2));
  });

  if (DRY_RUN) {
    console.log('\nDRY-RUN: nada foi gravado no Supabase.');
    return;
  }

  await upsert(rows);
  console.log('\nOK: ' + rows.length + ' dias gravados/atualizados em shopify_daily.');
})().catch(e => fail(e.message));
