#!/bin/bash
# Double-click launcher for macOS. Installs dependencies on first run, then starts the server.
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "  ❌ Node.js가 설치되어 있지 않습니다."
  echo "     https://nodejs.org 에서 LTS 버전을 설치한 뒤 다시 실행하세요."
  echo ""
  read -r -p "  Enter를 누르면 닫힙니다..."
  exit 1
fi

if [ ! -d node_modules ]; then
  echo ""
  echo "  최초 실행입니다. 필요한 파일을 받는 중... (1~2분)"
  echo ""
  npm install || { echo "  ❌ 설치 실패"; read -r -p "  Enter를 누르면 닫힙니다..."; exit 1; }
fi

clear
node server.js

echo ""
echo "  ⚠️  서버가 종료되었습니다. 모든 자막 화면이 멈춥니다."
read -r -p "  Enter를 누르면 닫힙니다..."
