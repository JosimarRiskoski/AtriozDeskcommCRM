param(
  [string]$OutputPath = "supabase/bootstrap_0135.sql"
)

$ErrorActionPreference = "Stop"

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$baselinePath = Join-Path $repositoryRoot "supabase/baseline.sql"
$migrationDirectory = Join-Path $repositoryRoot "supabase/migrations"
$migrationFiles = Get-ChildItem -LiteralPath $migrationDirectory -File -Filter "*.sql" |
  Where-Object {
    if ($_.Name -match '_(\d{4})_') {
      $ordinal = [int]$Matches[1]
      return $ordinal -ge 85 -and $ordinal -le 135
    }
    return $false
  } |
  Sort-Object Name

$resolvedOutputPath = if ([System.IO.Path]::IsPathRooted($OutputPath)) {
  $OutputPath
} else {
  Join-Path $repositoryRoot $OutputPath
}

if (-not (Test-Path -LiteralPath $baselinePath)) {
  throw "Baseline nao encontrado: $baselinePath"
}

$ordinals = $migrationFiles | ForEach-Object {
  if ($_.Name -match '_(\d{4})_') { [int]$Matches[1] }
}
$missingOrdinals = 85..135 | Where-Object { $_ -notin $ordinals }

if ($missingOrdinals) {
  throw "Migracoes ausentes entre 0085 e 0135: $($missingOrdinals -join ', ')"
}

$outputDirectory = Split-Path -Parent $resolvedOutputPath
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null

$utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
$builder = New-Object System.Text.StringBuilder

[void]$builder.AppendLine("-- Atrioz CRM - bootstrap completo ate 0135")
[void]$builder.AppendLine("-- Gerado por scripts/build-supabase-bootstrap.ps1")
[void]$builder.AppendLine("-- Aplicar somente em um projeto Supabase vazio.")
[void]$builder.AppendLine()
[void]$builder.AppendLine("-- Dependencias presumidas pelo baseline historico. Os schemas abaixo seguem")
[void]$builder.AppendLine("-- exatamente os nomes qualificados usados pelas tabelas, indices e funcoes.")
[void]$builder.AppendLine("create schema if not exists extensions;")
[void]$builder.AppendLine('create extension if not exists "uuid-ossp" with schema extensions;')
[void]$builder.AppendLine("create extension if not exists pgcrypto with schema extensions;")
[void]$builder.AppendLine("create extension if not exists citext with schema public;")
[void]$builder.AppendLine("create extension if not exists pg_trgm with schema public;")
[void]$builder.AppendLine("create extension if not exists vector with schema public;")
[void]$builder.AppendLine()
$baselineContent = Get-Content -LiteralPath $baselinePath -Raw
$lateMigrationMarker = "-- 0126_google_calendar_appointments"
$lateMigrationOffset = $baselineContent.IndexOf($lateMigrationMarker, [System.StringComparison]::Ordinal)

if ($lateMigrationOffset -lt 0) {
  throw "O marcador de corte da migracao 0126 nao foi encontrado no baseline."
}

# O baseline historico contem a base consolidada ate 0084, pula 0085-0125 e
# volta a incluir 0126-0128. Cortamos esse trecho tardio e reconstruimos toda a
# sequencia 0085-0135 a partir dos arquivos canonicos de migrations.
$baselineThrough0084 = $baselineContent.Substring(0, $lateMigrationOffset).TrimEnd()
[void]$builder.AppendLine($baselineThrough0084)

foreach ($migrationFile in $migrationFiles) {
  $relativeMigrationPath = "supabase/migrations/$($migrationFile.Name)"
  [void]$builder.AppendLine()
  [void]$builder.AppendLine("-- ============================================================================")
  [void]$builder.AppendLine("-- Continuacao: $relativeMigrationPath")
  [void]$builder.AppendLine("-- ============================================================================")
  [void]$builder.AppendLine((Get-Content -LiteralPath $migrationFile.FullName -Raw))
}

[System.IO.File]::WriteAllText($resolvedOutputPath, $builder.ToString(), $utf8WithoutBom)

$content = Get-Content -LiteralPath $resolvedOutputPath -Raw
$expectedMarkers = 85..135 | ForEach-Object { $_.ToString("0000") }
$missingMarkers = $expectedMarkers | Where-Object { $content -notmatch [regex]::Escape($_) }

if ($missingMarkers) {
  throw "Bootstrap gerado sem os marcadores esperados: $($missingMarkers -join ', ')"
}

$result = Get-Item -LiteralPath $resolvedOutputPath
Write-Output "Bootstrap gerado: $($result.FullName)"
Write-Output "Tamanho: $($result.Length) bytes"
