#!/usr/bin/env powershell
# 生产构建：构建前端 → FastAPI 直接 serve 静态文件
# 使用方式：构建后访问 http://localhost:8000

$ErrorActionPreference = "Stop"
$ROOT = Split-Path -Parent $MyInvocation.MyCommand.Definition

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  AI 科普工作台 — 生产构建" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 构建前端
Write-Host "[1/2] 构建前端..." -ForegroundColor Yellow
Push-Location "$ROOT\frontend"
npm run build
Pop-Location

Write-Host ""
Write-Host "[2/2] 启动生产服务..." -ForegroundColor Yellow
Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  访问: http://localhost:8000" -ForegroundColor White
Write-Host "  API 文档: http://localhost:8000/docs" -ForegroundColor White
Write-Host "========================================" -ForegroundColor Green
Write-Host ""

# 启动后端（自动 serve frontend/dist）
Set-Location "$ROOT\backend"
$env:PYTHONPATH = $ROOT + "\backend"
python run.py
