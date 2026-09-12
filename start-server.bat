@echo off
REM Double-click launcher for Windows. Installs dependencies on first run, then starts the server.
cd /d "%~dp0"
chcp 65001 >nul

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   [X] Node.js가 설치되어 있지 않습니다.
  echo       https://nodejs.org 에서 LTS 버전을 설치한 뒤 다시 실행하세요.
  echo.
  pause
  exit /b 1
)

if not exist node_modules (
  echo.
  echo   최초 실행입니다. 필요한 파일을 받는 중... ^(1~2분^)
  echo.
  call npm install
  if errorlevel 1 (
    echo   [X] 설치 실패
    pause
    exit /b 1
  )
)

cls
node server.js

echo.
echo   [!] 서버가 종료되었습니다. 모든 자막 화면이 멈춥니다.
pause
