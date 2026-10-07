#!/bin/bash
set -euo pipefail

release_project_dir="$(cd "$(dirname "$0")/.." && pwd)"
cd "$release_project_dir"
release_app_path="dist/app/mac-arm64/LAN Chat.app"

# 서명 성공만으로 출시 가능으로 판단하지 않고 Gatekeeper와 공증 티켓을 각각 검사한다.
test -d "$release_app_path"
codesign --verify --deep --strict --verbose=2 "$release_app_path"
spctl --assess --type execute --verbose=2 "$release_app_path"
xcrun stapler validate "$release_app_path"
test -s dist/app/latest-mac.yml

# 업데이트 메타데이터가 실제 배포 파일의 크기와 SHA-512를 가리키는지 검증한다.
node scripts/verify-update-artifacts.cjs
