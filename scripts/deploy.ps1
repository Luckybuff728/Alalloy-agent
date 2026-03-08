# ============================================================
# Alalloy Agent 一键部署脚本
# 用法：.\scripts\deploy.ps1 [-Frontend] [-Backend] [-All]
# ============================================================
param(
    [switch]$Frontend,
    [switch]$Backend,
    [switch]$All
)

$OutputEncoding = [console]::InputEncoding = [console]::OutputEncoding = New-Object System.Text.UTF8Encoding

# 配置
$SERVER       = "root@42.121.165.182"
$SSH          = "C:\Windows\System32\OpenSSH\ssh.exe"
$SCP          = "C:\Windows\System32\OpenSSH\scp.exe"
$PROJECT_ROOT = Split-Path -Parent $PSScriptRoot
$FRONTEND_DIR = Join-Path $PROJECT_ROOT "frontend"
$SSH_OPTS     = @("-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=30", "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=5")

function Write-Step([string]$msg)  { Write-Host "`n[>>] $msg" -ForegroundColor Cyan }
function Write-OK([string]$msg)    { Write-Host "  [OK] $msg" -ForegroundColor Green }
function Write-Warn([string]$msg)  { Write-Host "  [!!] $msg" -ForegroundColor Yellow }
function Write-Fail([string]$msg)  { Write-Host "`n[FAIL] $msg" -ForegroundColor Red; exit 1 }

function Invoke-SSH {
    param([string]$Cmd, [switch]$NoFail)
    $out = & $SSH @SSH_OPTS $SERVER $Cmd 2>&1
    if ($LASTEXITCODE -ne 0 -and -not $NoFail) {
        Write-Fail "SSH failed (exit $LASTEXITCODE): $Cmd`n$out"
    }
    return $out
}

function Invoke-SCP {
    param([string]$Local, [string]$Remote)
    & $SCP @SSH_OPTS $Local "${SERVER}:${Remote}" 2>&1 | Out-Null
    return ($LASTEXITCODE -eq 0)
}

# 自动检测变更
if (-not $Frontend -and -not $Backend -and -not $All) {
    $changed = @()
    $changed += git -C $PROJECT_ROOT diff --name-only 2>$null
    $changed += git -C $PROJECT_ROOT diff --name-only HEAD 2>$null
    $changed = $changed | Sort-Object -Unique | Where-Object { $_ -ne "" }

    $hasFE = $changed | Where-Object { $_ -like "frontend/*" }
    $haveBE = $changed | Where-Object { $_ -like "backend/*" -or $_ -eq "requirements.txt" }
    if ($hasFE)  { $Frontend = $true; Write-Warn "Frontend changes detected" }
    if ($haveBE) { $Backend  = $true; Write-Warn "Backend changes detected" }
    if (-not $Frontend -and -not $Backend) {
        Write-Warn "No git changes detected, deploying both"
        $Frontend = $true; $Backend = $true
    }
}
if ($All) { $Frontend = $true; $Backend = $true }

# ============================================================
# Frontend Deploy
# ============================================================
if ($Frontend) {
    Write-Host "`n========= Frontend Deploy =========" -ForegroundColor Magenta

    # 1. Ensure .env.production exists
    Write-Step "Check frontend/.env.production"
    $envProd = Join-Path $FRONTEND_DIR ".env.production"
    if (-not (Test-Path $envProd)) {
        "VITE_BACKEND_HOST=`nNUXT_PUBLIC_API_URL=`nNUXT_PUBLIC_WS_URL=" | Set-Content $envProd -Encoding UTF8
        Write-OK "Created .env.production"
    } else {
        Write-OK ".env.production exists"
    }

    # 2. Build
    Write-Step "npm run generate"
    Set-Location $FRONTEND_DIR
    npm run generate
    $indexLocal = Join-Path $FRONTEND_DIR ".output\public\index.html"
    if (-not (Test-Path $indexLocal)) { Write-Fail "Build failed: index.html not found" }

    # 3. Verify backendHost is empty
    Write-Step "Verify backendHost in built index.html"
    $c = Get-Content $indexLocal -Raw
    if ($c -match 'backendHost:"([^"]*)"') {
        if ($Matches[1] -ne "") {
            Write-Fail "backendHost='$($Matches[1])' - production build must have empty backendHost. Check frontend/.env.production"
        }
        Write-OK "backendHost='' (correct)"
    } else {
        Write-Warn "backendHost not found in index.html, continuing"
    }

    # 4. Upload via tar|ssh pipe (use temp bat to avoid PowerShell binary pipe issues)
    Write-Step "Upload via tar|ssh pipe"
    $publicDir = Join-Path $FRONTEND_DIR ".output\public"
    $remoteCmd = "tar xzf - -C /opt/alalloy/frontend_static/public/"
    $tempBat = [System.IO.Path]::GetTempFileName() -replace "\.tmp$", ".bat"

    # Build bat content using string concatenation (no here-string to avoid indent issues)
    $line1 = "@echo off"
    $line2 = "tar -czf - -C `"$publicDir`" . | `"$SSH`" -o StrictHostKeyChecking=no -o ConnectTimeout=30 -o ServerAliveInterval=15 $SERVER `"$remoteCmd`""
    $line3 = "exit /b %ERRORLEVEL%"
    ($line1, $line2, $line3) -join "`r`n" | Set-Content $tempBat -Encoding ASCII

    Write-Host "  Transferring (please wait)..." -ForegroundColor Gray
    cmd /c $tempBat
    $uploadExit = $LASTEXITCODE
    Remove-Item $tempBat -Force -ErrorAction SilentlyContinue
    if ($uploadExit -ne 0) { Write-Fail "tar|ssh transfer failed, exit: $uploadExit" }
    Write-OK "Transfer complete"

    # 5. Verify on server
    Write-Step "Verify server index.html"
    $raw = Invoke-SSH "grep -o 'backendHost:\"[^\"]*\"' /opt/alalloy/frontend_static/public/index.html"
    if ($raw -match 'backendHost:"([^"]*)"') {
        if ($Matches[1] -eq "") { Write-OK "Server backendHost='' - correct!" }
        else { Write-Fail "Server backendHost='$($Matches[1])' - still old version" }
    } else {
        Write-Warn "Server response: $raw - verify manually"
    }

    Write-Host "`n  Frontend deployed! Do Ctrl+Shift+R in browser." -ForegroundColor Green
}

# ============================================================
# Backend Deploy
# ============================================================
if ($Backend) {
    Write-Host "`n========= Backend Deploy =========" -ForegroundColor Magenta

    # Upload backend files via SCP
    $files = @(
        @{ L = "backend\app\agents\builder.py";                R = "/opt/alalloy/backend/app/agents/builder.py" }
        @{ L = "backend\app\agents\nodes.py";                  R = "/opt/alalloy/backend/app/agents/nodes.py" }
        @{ L = "backend\app\infra\mcp_service.py";             R = "/opt/alalloy/backend/app/infra/mcp_service.py" }
        @{ L = "backend\app\api\websocket\stream.py";          R = "/opt/alalloy/backend/app/api/websocket/stream.py" }
        @{ L = "backend\app\agents\prompts\analysisExpert.md"; R = "/opt/alalloy/backend/app/agents/prompts/analysisExpert.md" }
        @{ L = "backend\app\agents\prompts\reportWriter.md";   R = "/opt/alalloy/backend/app/agents/prompts/reportWriter.md" }
        @{ L = "backend\app\agents\prompts\thinker.md";        R = "/opt/alalloy/backend/app/agents/prompts/thinker.md" }
        @{ L = "backend\app\agents\prompts\dataExpert.md";     R = "/opt/alalloy/backend/app/agents/prompts/dataExpert.md" }
        @{ L = "requirements.txt";                              R = "/opt/alalloy/requirements.txt" }
    )

    Write-Step "Upload backend files via SCP"
    $failed = @()
    foreach ($f in $files) {
        $lp = Join-Path $PROJECT_ROOT $f.L
        if (Test-Path $lp) {
            Write-Host "  $($f.L) ..." -NoNewline
            if (Invoke-SCP $lp $f.R) { Write-Host " OK" -ForegroundColor Green }
            else { Write-Host " FAIL" -ForegroundColor Red; $failed += $f.L }
        }
    }
    if ($failed.Count -gt 0) {
        Write-Warn "Upload failed for: $($failed -join ', ')"
        Write-Warn "Upload these manually via 1Panel if needed"
    }

    # Rebuild backend image
    Write-Step "docker compose build backend"
    Write-Host "  (takes 3-5 min)..." -ForegroundColor Gray
    Invoke-SSH "cd /opt/alalloy && docker compose build backend 2>&1 | tail -8"

    # Restart
    Write-Step "docker compose up -d backend"
    Invoke-SSH "cd /opt/alalloy && docker compose up -d backend 2>&1"

    # Wait for healthy
    Write-Step "Waiting for alalloy-backend to be healthy (max 90s)"
    $healthy = $false
    for ($i = 1; $i -le 18; $i++) {
        Start-Sleep -Seconds 5
        $st = (Invoke-SSH "docker inspect alalloy-backend --format '{{.State.Health.Status}}' 2>/dev/null" -NoFail).Trim()
        Write-Host "  [$($i*5)s] $st" -NoNewline
        if ($st -eq "healthy") { Write-Host " [OK]" -ForegroundColor Green; $healthy = $true; break }
        Write-Host ""
    }
    if (-not $healthy) {
        Write-Warn "Timed out. Check logs:"
        Invoke-SSH "docker logs alalloy-backend --tail 20" -NoFail
    } else {
        $ver = (Invoke-SSH "docker exec alalloy-backend pip show langchain-mcp-adapters 2>/dev/null | grep Version" -NoFail).Trim()
        if ($ver -match "0\.1\.14") { Write-OK "langchain-mcp-adapters==0.1.14 OK" }
        else { Write-Warn "langchain-mcp-adapters version: $ver (expected 0.1.14)" }
    }
}

Write-Host "`n==========================================" -ForegroundColor Green
Write-Host "  Deploy complete!  http://42.121.165.182" -ForegroundColor Green
Write-Host "==========================================`n" -ForegroundColor Green
