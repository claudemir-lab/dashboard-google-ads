# ==============================================================================
# SCRIPT DE IMPORTAÇÃO AUTOMÁTICA: CSV DO GOOGLE ADS -> SUPABASE
# ==============================================================================
param(
    [string]$CsvPath = ""
)

$SUPABASE_URL = "https://bbitajwmcapohixocavn.supabase.co"
$SUPABASE_KEY = "sb_publishable_fNQDTEEbDQvMBbK8M4Dqeg_j-5QF2sS"
$TABLE_NAME = "gads_dashboard"

# Se nenhum arquivo foi especificado, procura qualquer .csv nesta pasta
if (-not $CsvPath) {
    $csvFiles = Get-ChildItem -Path $PSScriptRoot -Filter "*.csv" | Sort-Object LastWriteTime -Descending
    if ($csvFiles.Count -gt 0) {
        $CsvPath = $csvFiles[0].FullName
        Write-Host "Encontrado arquivo CSV: $($csvFiles[0].Name)" -ForegroundColor Cyan
    } else {
        Write-Host "Nenhum arquivo .csv encontrado nesta pasta." -ForegroundColor Yellow
        Write-Host "Baixe o CSV do Google Ads, coloque nesta pasta e execute este script novamente."
        exit
    }
}

Write-Host "Lendo arquivo: $CsvPath..." -ForegroundColor Green

# O Google Ads coloca 1 a 3 linhas de cabecalho inicial descritivo no CSV.
# Vamos detectar onde comeca o cabecalho real das colunas.
$lines = Get-Content -Path $CsvPath -Encoding UTF8

$headerLineIndex = -1
for ($i = 0; $i -lt [Math]::Min(10, $lines.Count); $i++) {
    $line = $lines[$i]
    if ($line -match "Campanha|Campaign|Dia|Date|Day") {
        $headerLineIndex = $i
        break
    }
}

if ($headerLineIndex -eq -1) {
    Write-Host "Erro: Nao foi possivel identificar o cabecalho de colunas do Google Ads no CSV." -ForegroundColor Red
    exit 1
}

# Linhas validas a partir do cabecalho
$validLines = $lines[$headerLineIndex..($lines.Count - 1)] | Where-Object { 
    $_ -notmatch "Total:|^--|^,,|Relatrio gerado" -and $_.Trim() -ne ""
}

$csvData = $validLines | ConvertFrom-Csv

Write-Host "Total de linhas no relatorio: $($csvData.Count)" -ForegroundColor Cyan

function Clean-Number($val) {
    if (-not $val) { return 0.0 }
    $s = "$val".Replace("R$", "").Replace(" ", "").Trim()
    # Se usar formato brasileiro (1.234,56)
    if ($s -match "\,\d{1,2}$") {
        $s = $s.Replace(".", "").Replace(",", ".")
    }
    $res = 0.0
    [double]::TryParse($s, [System.Globalization.NumberStyles]::Any, [System.Globalization.CultureInfo]::InvariantCulture, [ref]$res) | Out-Null
    return [Math]::Round($res, 2)
}

function Format-Date($val) {
    if (-not $val) { return (Get-Date -Format "yyyy-MM-dd") }
    $s = "$val".Trim()
    if ($s -match "^\d{4}-\d{2}-\d{2}$") { return $s }
    if ($s -match "^(\d{1,2})/(\d{1,2})/(\d{4})$") {
        return "$($Matches[3])-$($Matches[2].PadLeft(2,'0'))-$($Matches[1].PadLeft(2,'0'))"
    }
    return $s
}

$records = @()

foreach ($row in $csvData) {
    $props = $row.PSObject.Properties

    $campanhaProp = $props | Where-Object { $_.Name -match "Campanha|Campaign" } | Select-Object -First 1
    $dataProp = $props | Where-Object { $_.Name -match "Dia|Date|Data|Day" } | Select-Object -First 1
    $custoProp = $props | Where-Object { $_.Name -match "Custo|Cost|Investimento" } | Select-Object -First 1
    $faturamentoProp = $props | Where-Object { $_.Name -match "Valor de conv|Conversion value|Valor total|Receita" } | Select-Object -First 1
    $cliquesProp = $props | Where-Object { $_.Name -match "Cliques|Clicks" } | Select-Object -First 1
    $impressoesProp = $props | Where-Object { $_.Name -match "Impr|Impressions|Impresses" } | Select-Object -First 1
    $convProp = $props | Where-Object { $_.Name -match "Converses|Conversions|Vendas" } | Select-Object -First 1
    $prodProp = $props | Where-Object { $_.Name -match "Produto|Product|Ttulo" } | Select-Object -First 1

    if (-not $campanhaProp) {
        # Relatorio de Produtos (listagens gratuitas / feed) -> sem coluna de Campanha
        if ($prodProp -and $faturamentoProp) {
            $produto = if ($prodProp.Value) { $prodProp.Value.Trim() } else { "" }
            if (-not $produto -or $produto -match "Total:") { continue }
            $receita = Clean-Number $faturamentoProp.Value
            $dataVal = if ($dataProp) { Format-Date $dataProp.Value } else { (Get-Date -Format "yyyy-MM-dd") }
            $unid = if ($convProp) { [int](Clean-Number $convProp.Value) } else { 0 }
            $records += @{
                data = $dataVal
                nome_campanha = "Produtos / Listagens"
                produto_nome = $produto
                investimento = 0.0
                faturamento = $receita
                cliques = 0
                impressoes = 0
                itens_no_carrinho = 0
                quantidade_vendida = $unid
            }
        }
        continue
    }
    $campName = $campanhaProp.Value
    if (-not $campName -or $campName -match "Total:") { continue }

    $dataVal = if ($dataProp) { Format-Date $dataProp.Value } else { (Get-Date -Format "yyyy-MM-dd") }
    $investimento = if ($custoProp) { Clean-Number $custoProp.Value } else { 0.0 }
    $faturamento = if ($faturamentoProp) { Clean-Number $faturamentoProp.Value } else { 0.0 }
    $cliques = if ($cliquesProp) { [int](Clean-Number $cliquesProp.Value) } else { 0 }
    $impressoes = if ($impressoesProp) { [int](Clean-Number $impressoesProp.Value) } else { 0 }
    $vendas = if ($convProp) { [int](Clean-Number $convProp.Value) } else { 0 }
    $produto = if ($prodProp -and $prodProp.Value) { $prodProp.Value.Trim() } else { "Geral / Campanha" }

    $roas = if ($investimento -gt 0) { [Math]::Round(($faturamento / $investimento), 2) } else { 0.0 }
    $roi = if ($investimento -gt 0) { [Math]::Round(((($faturamento - $investimento) / $investimento) * 100), 2) } else { 0.0 }

    $records += @{
        data = $dataVal
        nome_campanha = $campName
        produto_nome = $produto
        investimento = $investimento
        faturamento = $faturamento
        cliques = $cliques
        impressoes = $impressoes
        itens_no_carrinho = 0
        quantidade_vendida = $vendas
    }
}

Write-Host "Total de registros estruturados para envio: $($records.Count)" -ForegroundColor Green

if ($records.Count -eq 0) {
    Write-Host "Nenhum registro valido para enviar." -ForegroundColor Yellow
    exit
}

# Envio em lotes para o Supabase
$endpoint = "$SUPABASE_URL/rest/v1/$TABLE_NAME`?on_conflict=data,nome_campanha,produto_nome"
$headers = @{
    "apikey" = $SUPABASE_KEY
    "Authorization" = "Bearer $SUPABASE_KEY"
    "Content-Type" = "application/json"
    "Prefer" = "resolution=merge-duplicates"
}

$batchSize = 200
$totalBatches = [Math]::Ceiling($records.Count / $batchSize)

Write-Host "Enviando para o Supabase em $totalBatches lote(s)..." -ForegroundColor Cyan

for ($b = 0; $b -lt $records.Count; $b += $batchSize) {
    $batchCount = [Math]::Min($batchSize, $records.Count - $b)
    $batch = $records[$b..($b + $batchCount - 1)]
    $batchNumber = [Math]::Floor($b / $batchSize) + 1

    $jsonBody = $batch | ConvertTo-Json -Depth 5

    try {
        $res = Invoke-RestMethod -Uri $endpoint -Method Post -Headers $headers -Body ([System.Text.Encoding]::UTF8.GetBytes($jsonBody))
        Write-Host "  [OK] Lote $batchNumber/$totalBatches enviado ($batchCount linhas)." -ForegroundColor Green
    } catch {
        Write-Host "  [ERRO] Falha no lote $batchNumber`: $($_.Exception.Message)" -ForegroundColor Red
    }
}

Write-Host "`n>>> SUCESSO! Todos os dados foram importados para o Supabase!" -ForegroundColor Green
Write-Host "Abra agora https://claudemir-lab.github.io/dashboard-google-ads/ para conferir seu painel!" -ForegroundColor Cyan
