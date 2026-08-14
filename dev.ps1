#!/usr/bin/env powershell
# AI 科普工作台 — 一键启动开发环境
# 同时启动 FastAPI 后端 (8000) 和 Vite 前端 (5173)

$ErrorActionPreference = "Stop"
$ROOT = Split-Path -Parent $MyInvocation.MyCommand.Definition

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  AI 科普工作台 — 开发模式启动" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 启动后端
Write-Host "[1/3] 启动 FastAPI 后端 (http://localhost:8000)..." -ForegroundColor Yellow
$backend = Start-Process -PassThru -NoNewWindow -WorkingDirectory "$ROOT\backend" -FilePath "python" -ArgumentList "run.py", "--reload"

Start-Sleep -Seconds 2

# 启动前端
Write-Host "[2/3] 启动 Vite 前端 (http://localhost:5173)..." -ForegroundColor Yellow
$frontend = Start-Process -PassThru -NoNewWindow -WorkingDirectory "$ROOT\frontend" -FilePath "npm" -ArgumentList "run","dev"

Start-Sleep -Seconds 2

# 启动微信导出服务
Write-Host "[3/3] 启动微信导出服务 (http://localhost:5679)..." -ForegroundColor Yellow
$WXPY = "$env:LOCALAPPDATA\Programs\Python\Python313\python.exe"
if (-not (Test-Path $WXPY)) { $WXPY = "python" }
$wechat = Start-Process -PassThru -NoNewWindow -WorkingDirectory "$ROOT\wechat-export" -FilePath $WXPY -ArgumentList "export_server.py"

Start-Sleep -Seconds 3

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  启动完成！" -ForegroundColor Green
Write-Host "  前端: http://localhost:5173" -ForegroundColor White
Write-Host "  后端: http://localhost:8000" -ForegroundColor White
Write-Host "  微信: http://localhost:5679" -ForegroundColor White
Write-Host "  API 文档: http://localhost:8000/docs" -ForegroundColor White
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "按 Ctrl+C 停止所有服务..." -ForegroundColor Gray

# 等待退出
try {
    Wait-Process -Id $backend.Id, $frontend.Id, $wechat.Id
} catch {
    Stop-Process -Id $backend.Id -ErrorAction SilentlyContinue
    Stop-Process -Id $frontend.Id -ErrorAction SilentlyContinue
    Stop-Process -Id $wechat.Id -ErrorAction SilentlyContinue
}
