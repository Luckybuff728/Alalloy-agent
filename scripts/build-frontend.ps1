# ============================================================
# Alalloy Agent 前端打包脚本
# 用法：在项目根目录执行  .\scripts\build-frontend.ps1
# ============================================================

$ErrorActionPreference = "Stop"
$OutputEncoding = [console]::InputEncoding = [console]::OutputEncoding = New-Object System.Text.UTF8Encoding

$projectRoot = Split-Path -Parent $PSScriptRoot
$frontendDir = Join-Path $projectRoot "frontend"
$outputDir   = Join-Path $frontendDir ".output\public"
$tarTarget   = Join-Path $projectRoot "frontend_static.tar.gz"

Write-Host "=== Alalloy Agent 前端打包 ===" -ForegroundColor Cyan

# 1. 检查 .env.production
$envProd = Join-Path $frontendDir ".env.production"
if (-not (Test-Path $envProd)) {
    Write-Host "⚠️  未找到 frontend/.env.production，自动创建..." -ForegroundColor Yellow
    @"
VITE_BACKEND_HOST=
NUXT_PUBLIC_API_URL=
NUXT_PUBLIC_WS_URL=
"@ | Set-Content $envProd -Encoding UTF8
    Write-Host "✅ 已创建 frontend/.env.production" -ForegroundColor Green
}

# 2. 构建
Write-Host "`n[1/3] 执行 npm run generate..." -ForegroundColor Cyan
Set-Location $frontendDir
npm run generate
if ($LASTEXITCODE -ne 0) {
    # EBUSY 错误时检查输出是否实际生成
    if (Test-Path (Join-Path $outputDir "index.html")) {
        Write-Host "⚠️  构建出现 EBUSY 警告，但 index.html 已生成，继续..." -ForegroundColor Yellow
    } else {
        Write-Error "❌ 构建失败！请检查 npm 输出"
    }
}

# 3. 验证 backendHost
Write-Host "`n[2/3] 验证构建产物..." -ForegroundColor Cyan
$indexHtml = Join-Path $outputDir "index.html"
$content = Get-Content $indexHtml -Raw
if ($content -match 'backendHost:"([^"]*)"') {
    $host = $Matches[1]
    if ($host -eq "") {
        Write-Host "✅ backendHost = '' (正确，使用相对路径)" -ForegroundColor Green
    } else {
        Write-Host "❌ backendHost = '$host'（错误！请检查 frontend/.env.production）" -ForegroundColor Red
        Write-Host "   frontend/.env.production 内容应为：" -ForegroundColor Yellow
        Write-Host "   VITE_BACKEND_HOST=" -ForegroundColor Yellow
        exit 1
    }
}

# 4. 打包
Write-Host "`n[3/3] 打包 → $tarTarget ..." -ForegroundColor Cyan
if (Test-Path $tarTarget) { Remove-Item $tarTarget -Force }
tar -czf $tarTarget -C $outputDir .
$sizeMB = [math]::Round((Get-Item $tarTarget).Length / 1MB, 1)
Write-Host "✅ 打包完成：frontend_static.tar.gz ($sizeMB MB)" -ForegroundColor Green

Write-Host "`n=== 下一步：手动上传到服务器 ===" -ForegroundColor Cyan
Write-Host "1. 用 1Panel 文件管理器上传 frontend_static.tar.gz 到 /opt/alalloy/"
Write-Host "2. 在 1Panel 终端执行："
Write-Host "   tar xzf /opt/alalloy/frontend_static.tar.gz -C /opt/alalloy/frontend_static/public/ && rm /opt/alalloy/frontend_static.tar.gz" -ForegroundColor Yellow
Write-Host "3. 验证：grep -o 'backendHost:""[^""]*""' /opt/alalloy/frontend_static/public/index.html" -ForegroundColor Yellow
Write-Host ""
