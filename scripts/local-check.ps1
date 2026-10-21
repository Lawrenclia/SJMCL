<#
.SYNOPSIS
  本地验证 SJMCL（替代 GitHub Actions 自动检查）。

.DESCRIPTION
  自动完成提交前需要本地跑的检查：
    1. rustfmt --check（src-tauri 下所有 .rs）
    2. cargo check（后端）
    3. cargo test --lib（后端单元测试）
    4. tsc --noEmit（前端类型检查）
    5. eslint（前端 lint，--max-warnings=0）

  本机工具链说明：仓库钉的是 nightly，但当前 nightly 无法编译 azalea 依赖，
  因此后端用 stable + RUSTC_BOOTSTRAP 编译，同时保持 RUSTUP_TOOLCHAIN=nightly
  以满足 azalea 的构建脚本检查。

.PARAMETER SkipTests
  跳过 cargo test（只想快速做编译检查时使用）。

.EXAMPLE
  pwsh scripts/local-check.ps1

.EXAMPLE
  pwsh scripts/local-check.ps1 -SkipTests
#>
param(
  [switch]$SkipTests
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$failures = New-Object System.Collections.Generic.List[string]

function Invoke-Check {
  param(
    [string]$Name,
    [scriptblock]$Action
  )
  Write-Host "`n==> $Name" -ForegroundColor Cyan
  $global:LASTEXITCODE = 0
  & $Action
  if ($LASTEXITCODE -ne 0) {
    Write-Host "FAILED: $Name (exit $LASTEXITCODE)" -ForegroundColor Red
    $script:failures.Add($Name)
  } else {
    Write-Host "OK: $Name" -ForegroundColor Green
  }
}

Push-Location $repoRoot
try {
  # ---------------------------------------------------------------- backend
  $rustup = Get-Command rustup -ErrorAction SilentlyContinue
  if (-not $rustup) {
    throw 'rustup not found in PATH; install the Rust toolchains first.'
  }

  $sysroot = (& rustup run stable rustc --print sysroot).Trim()
  $stableBin = Join-Path $sysroot 'bin'
  $cargo = Join-Path $stableBin 'cargo.exe'
  $rustfmt = Join-Path $stableBin 'rustfmt.exe'
  if (-not (Test-Path $cargo)) {
    throw "stable toolchain not installed: $cargo"
  }

  $env:RUSTC = Join-Path $stableBin 'rustc.exe'
  $env:RUSTDOC = Join-Path $stableBin 'rustdoc.exe'
  $env:RUSTC_BOOTSTRAP = '1'
  $env:RUSTUP_TOOLCHAIN = 'nightly'
  Write-Host "Backend toolchain: $stableBin (stable + RUSTC_BOOTSTRAP, RUSTUP_TOOLCHAIN=nightly)"

  Invoke-Check 'rustfmt --check' {
    $files = Get-ChildItem (Join-Path $repoRoot 'src-tauri') -Recurse -File -Filter '*.rs' |
      Where-Object { $_.FullName -notmatch '\\target\\' } |
      Select-Object -ExpandProperty FullName
    & $rustfmt --check --edition 2024 $files
  }

  Invoke-Check 'cargo check' {
    & $cargo check --manifest-path (Join-Path $repoRoot 'src-tauri/Cargo.toml')
  }

  if (-not $SkipTests) {
    Invoke-Check 'cargo test --lib' {
      & $cargo test --lib --manifest-path (Join-Path $repoRoot 'src-tauri/Cargo.toml')
    }
  }

  # --------------------------------------------------------------- frontend
  $nodeModules = Join-Path $repoRoot 'node_modules'
  if (-not (Test-Path $nodeModules)) {
    throw 'node_modules is missing; run `pnpm install` first.'
  }

  Invoke-Check 'tsc --noEmit' {
    & node (Join-Path $repoRoot 'node_modules/typescript/bin/tsc') --noEmit
  }

  Invoke-Check 'eslint' {
    & node (Join-Path $repoRoot 'node_modules/eslint/bin/eslint.js') 'src/**/*.{js,jsx,ts,tsx}' --no-fix --max-warnings=0
  }
} finally {
  Pop-Location
}

if ($failures.Count -gt 0) {
  Write-Host "`nLocal checks failed: $($failures -join ', ')" -ForegroundColor Red
  exit 1
}
Write-Host "`nAll local checks passed." -ForegroundColor Green
