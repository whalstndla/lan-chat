# 랜펫 놀이방 v0.14.0 검증 기록

검증일: 2026-09-08. 이 기록은 v0.14.0 후보에 대한 결과이며 이전 `lanpet-release-validation.md`는 v0.13.0의 기록입니다.

| 검증 | 관찰 결과 |
| --- | --- |
| `npm run release:check` | 114개 테스트 묶음, 975개 테스트와 프로덕션 빌드 통과 |
| `npm run prerelease` | Electron 네이티브 모듈 재빌드와 렌더러 빌드 통과 |
| `node scripts/test-lanpet-electron.cjs` | 실제 Electron 두 프로세스에서 27개 검사 통과, 화면 22개 캡처 |
| `npx electron-builder --mac --publish never` | Apple Silicon DMG·ZIP·블록맵·업데이트 메타데이터 생성 |
| `codesign --verify --deep --strict` | 앱과 내장 프레임워크 서명 유효 |
| `node scripts/verify-update-artifacts.cjs` | v0.14.0 ZIP·DMG의 메타데이터 크기와 SHA-512 일치 |

실제 렌더러에서 먹이 구매·급식, 벽지 구매·적용, 복권, 두 미니게임의 다섯 라운드와 보상 지급, 친구 경주와 기존 교류를 실행했습니다. 채팅 하단 놀이방에는 실제 상대 펫이 나타났고 네이티브 창의 확장·복원을 확인했습니다. 좁은 창, 200% 확대, 키보드 포커스와 닫기도 검사했습니다.

저장소 테스트에서는 암호화 DB를 닫았다 다시 연 뒤 시드·코인·방 상태가 유지되고 파일에 시드 평문이 없는 것을 확인했습니다. 보상 중복 요청, 재입양을 통한 한도 초기화, 시간 역행, 잘못된 게임 입력과 이전 버전의 경주 초대를 검사했습니다.

[상세 실행 결과](lanpet-qa/electron-report.json) · [기능 설계](lanpet-world-design.md) · [릴리스 노트](lanpet-world-release-notes.md)

검증 범위: 한 Mac의 격리된 두 Electron 프로세스와 루프백 소켓을 사용했습니다. 업무시간 검사를 위해 프로세스 내부 시계만 조정했습니다. 물리 PC 두 대의 mDNS 발견과 설치된 구버전의 실제 자동 업데이트는 실행하지 않았습니다. Apple 공증은 기존 사용자 승인에 따라 생략했으며 Developer ID 서명 검증과 구분합니다.
