param(
  [string]$OutputDirectory = "supabase/bootstrap_chunks"
)

$ErrorActionPreference = "Stop"

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$baselinePath = Join-Path $repositoryRoot "supabase/baseline.sql"
$migrationDirectory = Join-Path $repositoryRoot "supabase/migrations"
$resolvedOutputDirectory = if ([System.IO.Path]::IsPathRooted($OutputDirectory)) {
  $OutputDirectory
} else {
  Join-Path $repositoryRoot $OutputDirectory
}

$utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
$baselineContent = Get-Content -LiteralPath $baselinePath -Raw
$lateMigrationMarker = "-- 0126_google_calendar_appointments"
$lateMigrationOffset = $baselineContent.IndexOf($lateMigrationMarker, [System.StringComparison]::Ordinal)

if ($lateMigrationOffset -lt 0) {
  throw "O marcador de corte da migracao 0126 nao foi encontrado no baseline."
}

$baselineThrough0084 = $baselineContent.Substring(0, $lateMigrationOffset)
$boundaryOne = $baselineThrough0084.IndexOf("-- COMPLEMENTO DO BASELINE", [System.StringComparison]::Ordinal)
$boundaryOne = $baselineThrough0084.LastIndexOf("-- ============================================================================", $boundaryOne, [System.StringComparison]::Ordinal)
$boundaryTwo = $baselineThrough0084.IndexOf("-- Dumps do Supabase zeram o search_path", [System.StringComparison]::Ordinal)
$boundaryTwo = $baselineThrough0084.LastIndexOf("-- ============================================================================", $boundaryTwo, [System.StringComparison]::Ordinal)

if ($boundaryOne -lt 0 -or $boundaryTwo -le $boundaryOne) {
  throw "Nao foi possivel localizar divisoes seguras no baseline."
}

if (Test-Path -LiteralPath $resolvedOutputDirectory) {
  Get-ChildItem -LiteralPath $resolvedOutputDirectory -File -Filter "*.sql" | Remove-Item -Force
} else {
  New-Item -ItemType Directory -Path $resolvedOutputDirectory -Force | Out-Null
}

$chunks = [System.Collections.Generic.List[object]]::new()
$extensionPreamble = @"
-- Atrioz CRM - dependencias para instalacao nova
create schema if not exists extensions;
create extension if not exists "uuid-ossp" with schema extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists citext with schema public;
create extension if not exists pg_trgm with schema public;
create extension if not exists vector with schema public;

"@

$chunks.Add([pscustomobject]@{ Name = "000_baseline_schema.sql"; Content = $extensionPreamble + $baselineThrough0084.Substring(0, $boundaryOne) })
$chunks.Add([pscustomobject]@{ Name = "001_baseline_storage_and_policies.sql"; Content = $baselineThrough0084.Substring($boundaryOne, $boundaryTwo - $boundaryOne) })
$chunks.Add([pscustomobject]@{ Name = "002_baseline_agent_harness_to_0084.sql"; Content = $baselineThrough0084.Substring($boundaryTwo) })

$migrationFiles = Get-ChildItem -LiteralPath $migrationDirectory -File -Filter "*.sql" |
  Where-Object {
    $_.Name -match '_(\d{4})_' -and [int]$Matches[1] -ge 85 -and [int]$Matches[1] -le 135
  } |
  Sort-Object Name

$ordinals = $migrationFiles | ForEach-Object {
  if ($_.Name -match '_(\d{4})_') { [int]$Matches[1] }
}
$missingOrdinals = 85..135 | Where-Object { $_ -notin $ordinals }
if ($missingOrdinals) {
  throw "Migracoes ausentes entre 0085 e 0135: $($missingOrdinals -join ', ')"
}

$index = 3
foreach ($migrationFile in $migrationFiles) {
  $chunks.Add([pscustomobject]@{
    Name = ("{0:D3}_{1}" -f $index, $migrationFile.Name)
    Content = Get-Content -LiteralPath $migrationFile.FullName -Raw
  })
  $index++
}

foreach ($chunk in $chunks) {
  $path = Join-Path $resolvedOutputDirectory $chunk.Name
  [System.IO.File]::WriteAllText($path, $chunk.Content, $utf8WithoutBom)
}

$largest = Get-ChildItem -LiteralPath $resolvedOutputDirectory -File -Filter "*.sql" |
  Sort-Object Length -Descending |
  Select-Object -First 1

Write-Output "Blocos gerados: $($chunks.Count)"
Write-Output "Maior bloco: $($largest.Name) ($($largest.Length) bytes)"
Write-Output "Diretorio: $resolvedOutputDirectory"
