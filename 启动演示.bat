@echo off
REM UTF-8 BOM above helps cmd parse Chinese lines on double-click.
chcp 65001 >nul 2>&1
setlocal EnableExtensions
cd /d "%~dp0backend" || (
  echo [ERROR] Cannot cd to backend folder.
  echo Path: %~dp0backend
  pause
  exit /b 1
)

echo ========================================
echo   XueXun Demo - Qwen2 local API
echo   (port auto-selected from 5055..5070)
echo ========================================
echo.

set "PYEXE="
where python >nul 2>&1 && set "PYEXE=python"
if not defined PYEXE where py >nul 2>&1 && set "PYEXE=py -3"
if not defined PYEXE (
  echo [ERROR] Python not found. Install Python 3 from python.org and tick "Add to PATH".
  pause
  exit /b 1
)

echo Using: %PYEXE%
echo Installing dependencies ^(quiet^)...
%PYEXE% -m pip install -r requirements.txt -q
if errorlevel 1 (
  echo [ERROR] pip install failed. Check network or Python install.
  pause
  exit /b 1
)

echo Selecting a free port (will auto-clean any leftover demo python.exe)...
set "PORT="
for /f "usebackq delims=" %%P in (`%PYEXE% _pick_port.py`) do set "PORT=%%P"
if not defined PORT (
  echo [ERROR] No free port in 5055..5070. Close the program holding those ports and retry.
  pause
  exit /b 1
)

echo.
echo ========================================
echo   Server URL: http://127.0.0.1:%PORT%/
echo ========================================
start "" "http://127.0.0.1:%PORT%/"

echo Starting server - keep this window open...
%PYEXE% -m uvicorn app:app --host 127.0.0.1 --port %PORT%
echo.
echo Server stopped.
pause
