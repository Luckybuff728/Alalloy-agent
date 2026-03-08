# ============================================================
# Alalloy Agent 一键部署脚本  (PowerShell 5 compatible)
# SSH alias: alalloy-aliyun  (configured in ~/.ssh/config)
#
# 用法:
#   .\scripts\deploy.ps1 -Frontend   # 仅前端
#   .\scripts\deploy.ps1 -Backend    # 仅后端
#   .\scripts\deploy.ps1 -All        # 全部
#   .\scripts\deploy.ps1             # 自动检测 git 变更
# ============================================================
param(
    [switch]$Frontend,
    [switch]$Backend,
    [switch]$All
)

$OutputEncoding = [console]::InputEncoding = [console]::OutputEncoding = `
    New-Object System.Text.UTF8Encoding

$SSH          = "C:\Windows\System32\OpenSSH\ssh.exe"
$SCP          = "C:\Windows\System32\OpenSSH\scp.exe"
$SSH_HOST     = "alalloy-aliyun"           # ~/.ssh/config alias
$PROJECT_ROOT = Split-Path -Parent $PSScriptRoot
$FRONTEND_DIR = Join-Path $PROJECT_ROOT "frontend"

function Log-Step { param($m) Write-Host "`n>> $m" -ForegroundColor Cyan }
function Log-OK   { param($m) Write-Host "   [OK] $m" -ForegroundColor Green }
function Log-Warn { param($m) Write-Host "   [!!] $m" -ForegroundColor Yellow }
function Log-Fail { param($m) Write-Host "`n[FAIL] $m" -ForegroundColor Red; exit 1 }

function Run-SSH {
    param([string]$Cmd, [switch]$IgnoreError)
    $out = & $SSH $SSH_HOST $Cmd 2>&1
    if (($LASTEXITCODE -ne 0) -and (-not $IgnoreError)) {
        Log-Fail "SSH command failed (exit $LASTEXITCODE):`n  $Cmd`n  $out"
    }
    return $out
}

function Run-SCP {
    param([string]$Local, [string]$Remote)
    & $SCP $Local "${SSH_HOST}:${Remote}" 2>&1 | Out-Null
    return ($LASTEXITCODE -eq 0)
}

# ---------- Auto-detect changed files ----------
if (-not $Frontend -and -not $Backend -and -not $All) {
    $changed  = @(git -C $PROJECT_ROOT diff --name-only 2>$null)
    $changed += @(git -C $PROJECT_ROOT diff --name-only HEAD 2>$null)
    $changed  = $changed | Sort-Object -Unique | Where-Object { $_ -ne "" }

    if ($changed | Where-Object { $_ -like "frontend/*" }) {
        $Frontend = $true; Log-Warn "Frontend changes detected"
    }
    if ($changed | Where-Object { $_ -like "backend/*" -or $_ -eq "requirements.txt" }) {
        $Backend = $true; Log-Warn "Backend changes detected"
    }
    if (-not $Frontend -and -not $Backend) {
        Log-Warn "No git changes found — deploying both by default"
        $Frontend = $true; $Backend = $true
    }
}
if ($All) { $Frontend = $true; $Backend = $true }

# ==============================================================
# FRONTEND
# ==============================================================
if ($Frontend) {
    Write-Host "`n====== Frontend Deploy ======" -ForegroundColor Magenta

    # 1. Ensure .env.production
    Log-Step "Check frontend/.env.production"
    $envProd = Join-Path $FRONTEND_DIR ".env.production"
    if (-not (Test-Path $envProd)) {
        "VITE_BACKEND_HOST=`nNUXT_PUBLIC_API_URL=`nNUXT_PUBLIC_WS_URL=" `
            | Set-Content $envProd -Encoding UTF8
        Log-OK "Created .env.production"
    } else { Log-OK ".env.production exists" }

    # 2. Build
    Log-Step "npm run generate"
    Set-Location $FRONTEND_DIR
    npm run generate
    $idx = Join-Path $FRONTEND_DIR ".output\public\index.html"
    if (-not (Test-Path $idx)) { Log-Fail "Build failed — index.html not found" }

    # 3. Verify backendHost is empty in built output
    Log-Step "Verify backendHost in built index.html"
    $html = Get-Content $idx -Raw
    if ($html -match 'backendHost:"([^"]*)"') {
        if ($Matches[1] -ne "") {
            Log-Fail "backendHost='$($Matches[1])' — must be empty. Check frontend/.env.production"
        }
        Log-OK "backendHost='' (correct)"
    }

    # 4. Upload via tar|ssh pipe (use .bat to avoid PS5 binary pipe issues)
    Log-Step "Upload via tar|ssh pipe"
    $pub     = Join-Path $FRONTEND_DIR ".output\public"
    $bat     = [System.IO.Path]::GetTempFileName() -replace "\.tmp$", ".bat"
    $sshExe  = $SSH.Replace("\", "\\")
    $pubEsc  = $pub.Replace("\", "\\")
    $lines   = @(
        "@echo off",
        ("tar -czf - -C """ + $pub + """ . | """ + $SSH + """ " + $SSH_HOST + " ""tar xzf - -C /opt/alalloy/frontend_static/public/"""),
        "exit /b %ERRORLEVEL%"
    )
    [System.IO.File]::WriteAllLines($bat, $lines, [System.Text.Encoding]::ASCII)
    Write-Host "   Transferring, please wait..." -ForegroundColor Gray
    cmd /c $bat
    $rc = $LASTEXITCODE
    Remove-Item $bat -Force -ErrorAction SilentlyContinue
    if ($rc -ne 0) { Log-Fail "tar|ssh transfer failed (exit $rc)" }
    Log-OK "Transfer complete"

    # 5. Verify on server (check "localhost" does NOT appear)
    Log-Step "Verify server index.html"
    $cnt = Run-SSH "grep -c localhost /opt/alalloy/frontend_static/public/index.html" -IgnoreError
    $cnt = ($cnt -join "").Trim()
    if ($cnt -eq "0") { Log-OK "Server index.html has no localhost — correct!" }
    elseif ($cnt -match "^\d+$") { Log-Fail "Server index.html still contains localhost ($cnt occurrences)" }
    else { Log-Warn "Could not verify server file: $cnt" }

    Write-Host "`n   Frontend deployed! Press Ctrl+Shift+R in browser." -ForegroundColor Green
}

# ==============================================================
# BACKEND
# ==============================================================
if ($Backend) {
    Write-Host "`n====== Backend Deploy ======" -ForegroundColor Magenta

    # 1. Upload changed source files via SCP
    $files = @(
        @{ L="backend\app\agents\builder.py";                R="/opt/alalloy/backend/app/agents/builder.py" }
        @{ L="backend\app\agents\nodes.py";                  R="/opt/alalloy/backend/app/agents/nodes.py" }
        @{ L="backend\app\infra\mcp_service.py";             R="/opt/alalloy/backend/app/infra/mcp_service.py" }
        @{ L="backend\app\api\websocket\stream.py";          R="/opt/alalloy/backend/app/api/websocket/stream.py" }
        @{ L="backend\app\agents\prompts\analysisExpert.md"; R="/opt/alalloy/backend/app/agents/prompts/analysisExpert.md" }
        @{ L="backend\app\agents\prompts\reportWriter.md";   R="/opt/alalloy/backend/app/agents/prompts/reportWriter.md" }
        @{ L="backend\app\agents\prompts\thinker.md";        R="/opt/alalloy/backend/app/agents/prompts/thinker.md" }
        @{ L="backend\app\agents\prompts\dataExpert.md";     R="/opt/alalloy/backend/app/agents/prompts/dataExpert.md" }
        @{ L="requirements.txt";                              R="/opt/alalloy/requirements.txt" }
    )

    Log-Step "Upload backend files via SCP"
    $failed = @()
    foreach ($f in $files) {
        $lp = Join-Path $PROJECT_ROOT $f.L
        if (Test-Path $lp) {
            Write-Host "   $($f.L) " -NoNewline
            if (Run-SCP $lp $f.R) { Write-Host "[OK]" -ForegroundColor Green }
            else { Write-Host "[FAIL]" -ForegroundColor Red; $failed += $f.L }
        }
    }
    if ($failed.Count -gt 0) {
        Log-Warn "SCP failed for: $($failed -join ', ') — upload these manually via 1Panel"
    }

    # 2. Rebuild backend Docker image
    Log-Step "docker compose build backend  (takes 2-5 min)"
    $buildOut = Run-SSH "cd /opt/alalloy; docker compose build backend 2>&1 | tail -6"
    Write-Host ($buildOut | Out-String).Trim()

    # 3. Restart container
    Log-Step "docker compose up -d backend"
    $upOut = Run-SSH "cd /opt/alalloy; docker compose up -d backend 2>&1"
    Write-Host ($upOut | Out-String).Trim()

    # 4. Wait for healthy
    Log-Step "Waiting for alalloy-backend healthy (max 90s)"
    $healthy = $false
    for ($i = 1; $i -le 18; $i++) {
        Start-Sleep -Seconds 5
        $st = (Run-SSH "docker inspect alalloy-backend --format '{{.State.Health.Status}}' 2>/dev/null" -IgnoreError).Trim()
        Write-Host "   [$($i*5)s] $st" -NoNewline
        if ($st -eq "healthy") { Write-Host " [OK]" -ForegroundColor Green; $healthy = $true; break }
        Write-Host ""
    }
    if (-not $healthy) {
        Log-Warn "Timed out. Check: docker logs alalloy-backend --tail 30"
    } else {
        $ver = (Run-SSH "docker exec alalloy-backend pip show langchain-mcp-adapters 2>/dev/null | grep Version" -IgnoreError).Trim()
        if ($ver -match "0\.1\.14") { Log-OK "langchain-mcp-adapters==0.1.14 confirmed" }
        else { Log-Warn "langchain-mcp-adapters version: $ver  (expected 0.1.14)" }
    }
}

Write-Host "`n============================================" -ForegroundColor Green
Write-Host "  Deploy complete!  http://42.121.165.182  " -ForegroundColor Green
Write-Host "============================================`n" -ForegroundColor Green
