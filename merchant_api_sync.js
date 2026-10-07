/**
 * ==============================================================================
 * MERCHANT CENTER API -> SUPABASE (listagem gratuita / produtos vendidos)
 * ==============================================================================
 *
 * Autenticacao: Service Account (arquivo JSON baixado do Google Cloud).
 * Nao precisa de dependencias externas (usa apenas o Node.js).
 *
 * Como usar (local):
 *   1. Baixe a chave JSON da service account e salve como "merchant-key.json"
 *      nesta pasta.
 *   2. (UMA UNICA VEZ) registre o projeto GCP no Merchant Center:
 *        node merchant_api_sync.js register
 *      Depois espere 5 minutos e rode o passo 3.
 *   3. Rode:  node merchant_api_sync.js
 *
 * Variaveis de ambiente (opcionais):
 *   MERCHANT_ID       -> ID do Merchant Center (obrigatorio)
 *   MERCHANT_KEY_FILE -> caminho da chave JSON (default: ./merchant-key.json)
 *   DAYS_BACK         -> quantos dias buscar (default: 90)
 *   DEVELOPER_EMAIL   -> email de contato tecnico no passo "register"
 *                        (opcional; se vazio, apenas vincula o projeto)
 * ==============================================================================
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CONFIG = {
  MERCHANT_ID: (process.env.MERCHANT_ID || '').replace(/[^0-9]/g, ''),
  KEY_FILE: process.env.MERCHANT_KEY_FILE || path.join(__dirname, 'merchant-key.json'),
  SUPABASE_URL: (process.env.SUPABASE_URL || 'https://bbitajwmcapohixocavn.supabase.co').replace(/\/+$/, ''),
  SUPABASE_KEY: process.env.SUPABASE_KEY || 'sb_publishable_fNQDTEEbDQvMBbK8M4Dqeg_j-5QF2sS',
  TABLE_NAME: 'gads_dashboard',
  DAYS_BACK: parseInt(process.env.DAYS_BACK || '90', 10),
  SCOPE: 'https://www.googleapis.com/auth/content',
  BATCH_SIZE: 200
};

function b64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

async function getAccessToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: sa.client_email,
    scope: CONFIG.SCOPE,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  };
  const signingInput = b64url(JSON.stringify(header)) + '.' + b64url(JSON.stringify(claim));
  const signature = crypto.sign('RSA-SHA256', Buffer.from(signingInput), sa.private_key);
  const jwt = signingInput + '.' + b64url(signature);

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt
    })
  });
  const text = await res.text();
  if (!res.ok) throw new Error('Falha ao obter token: ' + text);
  return JSON.parse(text).access_token;
}

async function merchantSearch(token, query) {
  const url = `https://merchantapi.googleapis.com/reports/v1/accounts/${CONFIG.MERCHANT_ID}/reports:search`;
  const results = [];
  let pageToken = null;
  do {
    const body = { query, pageSize: 1000 };
    if (pageToken) body.pageToken = pageToken;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Merchant API HTTP ${res.status}: ${text}`);
    const data = JSON.parse(text);
    if (data.results) results.push(...data.results);
    pageToken = data.nextPageToken;
  } while (pageToken);
  return results;
}

function fmtDate(d) {
  if (!d) return null;
  const m = String(d.month).padStart(2, '0');
  const dd = String(d.day).padStart(2, '0');
  return `${d.year}-${m}-${dd}`;
}

function priceToNumber(p) {
  if (!p || !p.amountMicros) return 0;
  return Number(p.amountMicros) / 1e6;
}

// Vincula o projeto GCP a conta do Merchant Center (unica chamada permitida
// antes do cadastro). Fazer UMA UNICA VEZ por projeto.
async function registerGcp(token) {
  const url = `https://merchantapi.googleapis.com/accounts/v1/accounts/${CONFIG.MERCHANT_ID}/developerRegistration:registerGcp`;
  const body = {};
  const devEmail = (process.env.DEVELOPER_EMAIL || '').trim();
  if (devEmail) body.developerEmail = devEmail;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  if (!res.ok) {
    console.error('[ERRO] HTTP ' + res.status + ': ' + text);
    console.error('\nPossiveis causas:');
    console.error('  - Service account sem acesso ADMIN no Merchant Center');
    console.error('    (Configuracoes -> Pessoas e acesso -> service account -> Admin)');
    console.error('  - Site nao verificado na conta do Merchant Center');
    console.error('  - Conta de teste (registro exige conta de producao)');
    process.exit(1);
  }
  console.log('[OK] Projeto GCP vinculado com sucesso:');
  console.log('  ' + text);
  if (devEmail) {
    console.log('\n[*] Se "' + devEmail + '" nao for usuario do Merchant Center,');
    console.log('    um convite foi enviado - o usuario PRECISA aceitar.');
  }
  console.log('\n[*] Aguarde 5 minutos e rode:  node merchant_api_sync.js');
}

async function sendToSupabase(records) {
  if (records.length === 0) {
    console.log('[!] Nenhum registro para enviar.');
    return;
  }
  const endpoint = `${CONFIG.SUPABASE_URL}/rest/v1/${CONFIG.TABLE_NAME}?on_conflict=data,nome_campanha,produto_nome`;
  const headers = {
    'apikey': CONFIG.SUPABASE_KEY,
    'Authorization': 'Bearer ' + CONFIG.SUPABASE_KEY,
    'Content-Type': 'application/json',
    'Prefer': 'resolution=merge-duplicates'
  };
  const batchSize = 200;
  const totalBatches = Math.ceil(records.length / batchSize);
  console.log(`[*] Enviando ${records.length} registros em ${totalBatches} lote(s)...`);
  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);
    const num = Math.floor(i / batchSize) + 1;
    const res = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(batch) });
    const text = await res.text();
    if (res.ok) {
      console.log(`  [OK] Lote ${num}/${totalBatches} (${batch.length} registros).`);
    } else {
      console.log(`  [ERRO] Lote ${num}/${totalBatches}: HTTP ${res.status} ${text}`);
    }
  }
}

async function main() {
  console.log('>>> Iniciando sincronizacao Merchant Center -> Supabase...');

  if (!CONFIG.MERCHANT_ID) {
    console.error('[ERRO] Defina MERCHANT_ID (ex.: node merchant_api_sync.js com a variavel MERCHANT_ID).');
    process.exit(1);
  }
  if (!fs.existsSync(CONFIG.KEY_FILE)) {
    console.error(`[ERRO] Arquivo da chave nao encontrado: ${CONFIG.KEY_FILE}`);
    process.exit(1);
  }

  const sa = JSON.parse(fs.readFileSync(CONFIG.KEY_FILE, 'utf8'));
  console.log(`[*] Service account: ${sa.client_email}`);
  console.log(`[*] Merchant ID: ${CONFIG.MERCHANT_ID}`);

  const token = await getAccessToken(sa);
  console.log('[*] Token obtido com sucesso.');

  if (process.argv[2] === 'register') {
    console.log('[*] Registrando projeto GCP no Merchant Center...');
    await registerGcp(token);
    return;
  }

  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - CONFIG.DAYS_BACK);
  const fmt = d => d.toISOString().slice(0, 10);
  const dateFilter = `date BETWEEN '${fmt(start)}' AND '${fmt(end)}'`;

  const query = `
    SELECT
      date,
      title,
      marketing_method,
      clicks,
      impressions,
      conversions,
      conversion_value
    FROM product_performance_view
    WHERE ${dateFilter}
  `;
  console.log('[*] Consultando product_performance_view...');
  const results = await merchantSearch(token, query);
  console.log(`[*] Linhas retornadas: ${results.length}`);

  const agg = {};
  const byMethod = {};
  for (const item of results) {
    const pv = item.productPerformanceView;
    if (!pv) continue;
    const method = (pv.marketingMethod || '?').toString().toUpperCase();
    byMethod[method] = byMethod[method] || { conversions: 0, value: 0, clicks: 0 };
    byMethod[method].conversions += Number(pv.conversions || 0);
    byMethod[method].value += priceToNumber(pv.conversionValue);
    byMethod[method].clicks += Number(pv.clicks || 0);

    // Listagem gratuita = trafego organico. Ignora linhas de ADS (que nao tem receita).
    if (method === 'ADS') continue;

    const date = fmtDate(pv.date);
    const title = (pv.title || '').trim() || '(sem titulo)';
    const key = date + '|' + title;
    if (!agg[key]) agg[key] = { data: date, title, conversions: 0, value: 0, clicks: 0, impressions: 0 };
    agg[key].conversions += Number(pv.conversions || 0);
    agg[key].value += priceToNumber(pv.conversionValue);
    agg[key].clicks += Number(pv.clicks || 0);
    agg[key].impressions += Number(pv.impressions || 0);
  }

  console.log('[*] Resumo por origem de trafego:');
  for (const m of Object.keys(byMethod)) {
    console.log(`    ${m}: conversoes ${byMethod[m].conversions} | receita R$ ${byMethod[m].value.toFixed(2)} | cliques ${byMethod[m].clicks}`);
  }

  const records = [];
  let totalRevenue = 0;
  for (const key of Object.keys(agg)) {
    const a = agg[key];
    if (a.conversions <= 0 && a.value <= 0) continue;
    totalRevenue += a.value;
    records.push({
      data: a.data,
      nome_campanha: 'Listagens Gratuitas',
      produto_nome: a.title,
      investimento: 0,
      faturamento: Number(a.value.toFixed(2)),
      cliques: a.clicks,
      impressoes: a.impressions,
      itens_no_carrinho: 0,
      quantidade_vendida: Math.round(a.conversions)
    });
  }

  console.log(`[*] Produtos vendidos consolidados: ${records.length} linhas | Receita total R$ ${totalRevenue.toFixed(2)}`);

  await sendToSupabase(records);
  console.log('>>> Sincronizacao concluida.');
}

main().catch(e => {
  console.error('[FATAL] ' + (e && e.message ? e.message : e));
  process.exit(1);
});