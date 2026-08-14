# ICE 工作台 - 一键启动脚本（含优雅清理）
# 用法: 右键 -> 用 PowerShell 运行, 或终端执行 .\start.ps1

$ErrorActionPreference = "SilentlyContinue"
$ROOT = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host ""
Write-Host "  ==============================" -ForegroundColor Cyan
Write-Host "    ICE · AI 创作引擎 启动器" -ForegroundColor Cyan
Write-Host "  ==============================" -ForegroundColor Cyan
Write-Host ""

# ========== 1. 清理旧进程 ==========
Write-Host "  [1/5] 清理旧进程..." -ForegroundColor Yellow

foreach ($port in @(5173, 5174, 8000, 5679)) {
    $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    foreach ($conn in $conns) {
        $procId = $conn.OwningProcess
        $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
        if ($proc) {
            Write-Host "        端口 ${port}: $($proc.ProcessName) (PID $procId) -> 杀" -ForegroundColor DarkYellow
            Stop-Process -Id $procId -Force
        }
    }
}

Start-Sleep -Seconds 2
Write-Host "  [OK] 旧进程已清理" -ForegroundColor Green

# ========== 2. 启动后端 ==========
Write-Host "  [2/5] 启动后端 FastAPI (:8000)..." -ForegroundColor Yellow

Start-Process -FilePath "python" `
    -ArgumentList "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8000" `
    -WorkingDirectory "$ROOT\backend" `
    -WindowStyle Hidden

Start-Sleep -Seconds 3
$backOK = (Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue) -ne $null
if ($backOK) {
    Write-Host "  [OK] 后端就绪: http://localhost:8000" -ForegroundColor Green
} else {
    Write-Host "  [FAIL] 后端启动失败！" -ForegroundColor Red
}

# ========== 3. 启动前端 ==========
Write-Host "  [3/5] 启动前端 Vite (:5173)..." -ForegroundColor Yellow

# 直接用 node.exe 跑 vite.js，绕开 npm.ps1 导致的弹窗问题
$NODE = (Get-Command node -ErrorAction SilentlyContinue).Source
$VITE_JS = "$ROOT\frontend\node_modules\vite\bin\vite.js"

if ($NODE -and (Test-Path $VITE_JS)) {
    Start-Process -FilePath $NODE `
        -ArgumentList $VITE_JS `
        -WorkingDirectory "$ROOT\frontend" `
        -WindowStyle Hidden
} else {
    Start-Process -FilePath "npm" `
        -ArgumentList "run", "dev" `
        -WorkingDirectory "$ROOT\frontend" `
        -WindowStyle Hidden
}

Start-Sleep -Seconds 4
$frontPort = 5173
$frontOK = (Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue) -ne $null
if (-not $frontOK) {
    $frontOK = (Get-NetTCPConnection -LocalPort 5174 -State Listen -ErrorAction SilentlyContinue) -ne $null
    if ($frontOK) { $frontPort = 5174 }
}

if ($frontOK) {
    Write-Host "  [OK] 前端就绪: http://localhost:$frontPort" -ForegroundColor Green
} else {
    Write-Host "  [FAIL] 前端启动失败！" -ForegroundColor Red
}

# ========== 4. 启动微信导出服务 ==========
Write-Host "  [4/5] 启动微信导出服务 (:5679)..." -ForegroundColor Yellow

$WXPY = "$env:LOCALAPPDATA\Programs\Python\Python313\python.exe"
if (-not (Test-Path $WXPY)) { $WXPY = "python" }

Start-Process -FilePath $WXPY `
    -ArgumentList "export_server.py" `
    -WorkingDirectory "$ROOT\wechat-export" `
    -WindowStyle Hidden

Start-Sleep -Seconds 3
$wxOK = (Get-NetTCPConnection -LocalPort 5679 -State Listen -ErrorAction SilentlyContinue) -ne $null
if ($wxOK) {
    Write-Host "  [OK] 微信导出就绪: http://localhost:5679" -ForegroundColor Green
} else {
    Write-Host "  [SKIP] 微信导出启动失败（非致命）" -ForegroundColor DarkYellow
}

# ========== 5. 打开浏览器 ==========
Write-Host "  [5/5] 打开浏览器..." -ForegroundColor Yellow
Start-Process "http://localhost:$frontPort"

Write-Host ""
Write-Host "  ==============================" -ForegroundColor Cyan
Write-Host "  启动完成！访问: http://localhost:$frontPort" -ForegroundColor Green
Write-Host "  ==============================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  提示:" -ForegroundColor DarkGray
Write-Host "    - 改代码会自动热更新(HMR)，浏览器刷新即可" -ForegroundColor DarkGray
Write-Host "    - 再次运行此脚本会自动清理旧进程" -ForegroundColor DarkGray
Write-Host ""
