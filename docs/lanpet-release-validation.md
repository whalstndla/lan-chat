# Lanpet v0.13.0 출시 검증 기록

검증일: 2026-09-08 (Asia/Seoul). 사용자 확정 사항을 반영한 최초 출시 후보다. 이 기록은 실제 실행한 검사와 남은 배포 단계를 구분한다.

## 확정 범위

- 독자 펫 이름은 **Lanpet**이다.
- 로컬 시간 평일 09:00–18:00만 육성·교류를 진행한다. 퇴근 후와 주말에는 상태가 동결된다.
- 개인 육성, 선택형 성장, 방문, 3턴 협동 놀이, 기념품, 5턴 친선 배틀을 포함한다.
- 공개는 기본 꺼짐이다. 활동별 허용과 피어별 차단을 제공한다.
- 배틀 승패가 성장·재산의 격차로 이어지지 않으며, OS 알림·소리·Dock 배지는 추가하지 않는다.
- 기존 채팅 wire v2를 유지한다. 펫 교류에는 양쪽 v0.13.0 이상과 `lanpet-v1` 지원이 필요하다.

## 실행 결과

| 검사 | 관찰한 결과 | 증거·범위 |
| --- | --- | --- |
| GitHub CI 최종 기능 코드 | 통과: 111 suites / 945 tests 및 Vite build | [PR #83 CI](https://github.com/whalstndla/lan-chat/actions/runs/34187522663), `357d762` 기준. Journal 최종 수정 포함. Ubuntu / Node 22, 기본 `npm test` 정상 종료 |
| 전체 테스트 및 렌더러 빌드 | 통과: 111 suites / 944 tests, Vite build 성공 | `npm run release:check`; 시간 누적·삭제 세대·보관기간·일시 중지·낮잠·종료된 DB 타이머 회귀 포함 |
| 마지막 Journal 표시 수정 | 통과: renderer 7 suites / 66 tests 및 Vite build | 내부 이벤트명과 동일 교류의 중복 표시를 정리한 뒤 해당 renderer 전체와 실제 Electron 검사를 재실행. 앞 행의 전체 실행과 중복되는 검사 수를 합산하지 않음 |
| 새 도메인의 종료 처리 | Lanpet 대상 검사에서 `--detectOpenHandles` 포함 정상 종료 확인 | 전체 회귀 실행은 기존 미종료 핸들 경고 때문에 `--forceExit` 사용 |
| Electron 네이티브 모듈 | Electron ABI 재빌드 성공 | `npm run prerelease` |
| 실제 앱 및 두 피어 교류 | 통과: 실제 앱 검사 19개 | 별도 임시 계정 2개, 실제 Electron renderer/preload/IPC/암호화 DB/WebSocket. 방문·협동·배틀·선물, 낮잠, 차단·설정, 중복 요청, 독립 구독, 키보드 검사 |
| 렌더링 | 통과: 1200px·700px 및 200% 확대 | CSS viewport 350px에서 Home/Friends/Journal/Settings 가로 넘침 없음. 부모 작업에서 배틀과 확대 화면 캡처 직접 확인 |
| 실제 서로 다른 두 PC의 LAN 발견 | 미실행 | 한 Mac의 loopback 검증으로 mDNS/UDP 발견 품질을 대체하지 않음 |
| 최종 설계 HTML | 통과: 실제 브라우저 1280px 화면 확인 | 15 sections / 23 tables, 깨진 내부 목차 링크 0, 가로 넘침 없음. MD 본문과 HTML 변환 결과 일치 |
| macOS 서명 및 패키징 | 통과: Developer ID 서명, arm64 DMG·ZIP 생성 | `codesign --verify --deep --strict` 종료 코드 0. 공증 성공과는 별개 |
| Apple 공증 및 Gatekeeper | 미통과: 자격 증명 준비 필요 | `lan-chat-notary` Keychain 프로필 없음. builder는 공증을 건너뜀. `spctl`은 Unnotarized Developer ID로 거절, `stapler validate`는 티켓 없음 |
| 업데이트 파일 무결성 | 통과: 버전·파일 크기·SHA-512·legacy metadata 일치 | `node scripts/verify-update-artifacts.cjs`; `LAN-Chat-0.13.0-arm64.zip` 115,957,046 bytes, DMG 121,447,388 bytes. 공증 후 다시 생성·검사해야 함 |
| GitHub 공개 배포 | 미게시 | 공증·Gatekeeper·무결성 검사를 통과한 후보만 공개 |

## 재현 절차

```bash
npm ci
npm run release:check
npm run prerelease
node scripts/test-lanpet-electron.cjs
```

실제 앱 검증 도구는 임시 사용자 데이터만 사용한다. 회사 피어에게 QA 프로필을 광고하지 않도록 테스트 프로세스의 mDNS/UDP 광고만 비활성화하고, 실제 WebSocket 통신을 loopback으로 연결한다. OS 시계를 바꾸지 않고 프로세스 내부 시계로 근무시간·시간 경계를 검증한다. 결과 JSON과 화면 캡처는 `Docs/lanpet-qa/`에 저장된다.

## macOS 출시 절차

공증 자격 증명은 로컬에서 `xcrun notarytool store-credentials "lan-chat-notary"`로 준비한다. 암호·토큰을 문서나 채팅에 입력하지 않는다. 준비된 프로필이 있으면 다음 절차로 검증된 산출물을 만든다.

```bash
APPLE_KEYCHAIN_PROFILE=lan-chat-notary npm run release:package
npm run release:verify
```

`mac.notarize: true`만으로 공증 성공이 보장되지는 않는다. 설치된 electron-builder는 자격 증명이 없으면 공증을 건너뛸 수 있으므로 `codesign`, `spctl`, `stapler`, 업데이트 메타데이터 검사를 별도로 통과해야 한다. 앱 서명 성공을 Apple 공증이나 공개 출시 완료로 보고하지 않는다.

## 보존 범위

원래 checkout의 진행 중 변경은 그대로 두고, `feature/lanpet` 격리 worktree에서 구현·검증한다. 기존 앱의 전체 외부 통신 정책 변경이나 인증·DB 키 관리 교체는 포함하지 않는다. 펫은 기존 암호화 DB에 별도 도메인 표와 원장을 추가하고, 기존 피어 신뢰 정보를 검증한 뒤 펫 전용 암호화 문맥을 사용한다.

## 검증 중 발견한 문제와 판단 근거

| 관찰 | 확인한 원인·조치 | 배제한 가설 |
| --- | --- | --- |
| 30초마다 상태 조회 시 성장 시간이 누락됨 | 평가마다 정수 분으로 버린 뒤 cursor를 전진했다. 소수 업무분을 영속하고 30초 × 120회가 한 번의 60분 평가와 같음을 검사했다. | UI 표시만의 문제와 시간대 오차가 아니라 engine 산술 경계였다. |
| 삭제 후 새 펫의 교류가 막힐 수 있음 | 이전 generation의 활성 세션·예약까지 합산했다. 현재 generation만 계산하고 삭제 세션을 최소 기록으로 바꿨다. | 새 펫의 에너지 부족이나 상대 오프라인이 아니라 이전 세대의 잠금이었다. |
| 최초 실제 Electron 등록 중 프로세스 종료 | macOS crash report의 `CODESIGNING / Invalid Page`와 native addon `dlopen` 경로를 확인했다. 재빌드 산출물을 새 inode로 복사하고 개발 서명한 뒤 실제 Electron에서 SQLite 쿼리와 등록이 성공했다. | 일반 ABI 불일치의 JavaScript 오류와 달랐고, 등록 입력 검증 오류로 프로세스 전체가 종료된 것이 아니었다. OS 보안 설정은 바꾸지 않았다. |
| 전체 회귀 중 `DATABASE_CLOSED`로 프로세스 종료 | 보관기간 정리 타이머가 닫힌 DB 검사보다 먼저 접근했다. 기존 채팅 테스트에서 발견했으며 세션 유효성 검사를 정리 작업 앞에 두도록 수정했다. | 표시된 히스토리 dedup 테스트 이름이 원인이 아니었다. 네이티브 모듈 재빌드 오류도 아니며, 타이머의 닫힌 DB 접근 stack이 직접 증거였다. |
| 기능 일시 중지 후 다시 켜면 지난 시간이 반영됨 | 재개 시 중지 구간을 건너뛰고 남은 낮잠 업무분만 이어 가도록 수정했다. 7일 중지 후 수치 유지와 낮잠 1회 완료를 검사했다. | 상태 표시 지연이나 보상 원장 중복이 아니라 재개 cursor 처리 문제였다. |
| 업데이트 메타데이터의 파일을 찾지 못함 | 로컬 산출물의 공백과 배포 URL의 하이픈 이름이 달랐다. macOS `artifactName`을 명시하고 재패키징한 뒤 두 파일의 크기·SHA-512·legacy 참조 일치를 확인했다. | 파일 생성 실패나 해시 알고리즘 문제가 아니라 파일 이름의 불일치였다. |

개발 도구에서 실패한 Care 버튼 선택은 장식용 하트까지 `textContent`에 포함한 선택자 문제였다. 실제 UI의 접근 가능한 이름 기준으로 검증 도구를 고쳤다. 또한 snapshot 평가 자체가 revision을 증가시키므로 중복 명령 검증은 revision 고정 대신 수치·보상·history의 중복 증가 여부를 판정한다.
