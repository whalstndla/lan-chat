# lan-chat — Claude 작업 가이드

LAN 환경 P2P 채팅 데스크톱 앱 (Electron + React).

## 빠른 사실

| 항목 | 값 |
|---|---|
| 플랫폼 | Electron (데스크톱 앱) |
| UI | React 19 + lucide-react + TipTap (rich text editor) |
| 디스커버리 | bonjour-service (mDNS 로컬 네트워크 자동 발견) |
| 통신 | express (로컬 HTTP 서버) + P2P 채널 |
| 저장소 | better-sqlite3-multiple-ciphers (암호화된 SQLite) |
| 마크다운 | react-markdown + remark-gfm + remark-breaks + rehype-highlight |
| 자동 업데이트 | electron-updater |
| 개발 | `npm run dev` |
| 디버그 | `npm run dev:peer-debug` (P2P 디버깅) |
| 릴리즈 | `npm run prerelease` → `npm run release` |

## 보안 / 프라이버시 정책 (핵심 결정 사항)

### 파일 암호화
- **모든 파일은 자체 암호화 저장** — 디스크에서 직접 접근 시 평문 노출 금지
- KeyChain 사용 안 함 — 파일 자체에 암호화 적용 (`better-sqlite3-multiple-ciphers`로 DB 암호화, 첨부 파일은 별도 암호화)
- 파일 열람은 **반드시 lan-chat 앱 내부에서만** — 외부 도구로는 평문 불가

### 통신 / 프라이버시 모드
- **완전 단절 모드** (확정): 외부 인터넷 차단, LAN 내부 통신만
- **프로필 공개 옵션**: 사용자가 명시적으로 공개 선택 시에만 다른 피어에게 노출
- 채팅 내용은 P2P 직접 전송 — 중앙 서버 보관 없음

### 다운로드 / 첨부 파일
- 다운로드 받은 이미지/파일은 암호화된 저장소에 보관
- 직접 디스크 경로로 접근 시 암호화된 상태 유지

## Claude 작업 시 핵심 규칙

### 작업 시작 전
- Electron 메인 프로세스(main) vs 렌더러 프로세스(renderer) 명확히 구분
- IPC 통신 채널 변경 시 양쪽 모두 영향
- 보안 영향 있는 변경은 사용자에게 명시 확인

### 코드 컨벤션
- 변수/함수명 영문 + camelCase
- 주석 한국어 (전역 룰)
- React 19 패턴 — Server Component는 사용 안 함 (Electron 환경)
- TipTap 확장 추가 시 starter-kit과 중복 확인

### Electron 특이사항
- `nodeIntegration` / `contextIsolation` 설정 변경은 보안 영향 큼 — 사용자 확인
- preload 스크립트로 안전한 IPC만 노출
- 외부 URL 열기는 `shell.openExternal` 사용 (BrowserWindow 직접 X)

### 데이터베이스
- `better-sqlite3-multiple-ciphers` 사용 — 키 관리 / 마이그레이션 신중
- 스키마 변경 시 마이그레이션 스크립트 필수
- 트랜잭션 사용 — 데이터 정합성

### 자동 업데이트
- `electron-updater`로 양쪽(송신/수신) 업데이트 필요한 변경:
  - 프로토콜 변경 → 양쪽 업데이트 안하면 호환 깨짐
  - 단순 UI 변경 → 한 쪽만 업데이트해도 OK
- 변경 시 호환성 영향 명시

## 협업 / 배포

### 커밋 / 푸시
- 한국어 커밋 메시지
- "분기마다 커밋 알아서 진행" 패턴 적용
- 푸시 전 `npm run test` 권장

### 릴리즈
```bash
npm run prerelease  # 빌드 + 검증
npm run release     # 실제 릴리즈
```
- 양쪽 업데이트 필요한 변경이면 릴리즈 노트에 명시
- electron-updater 채널 안정성 확인

## 자주 발생하는 작업 흐름

### "암호화 관련 수정"
1. 영향 범위 식별 (DB / 첨부 파일 / 메모리)
2. 키 관리 흐름 확인
3. 마이그레이션 필요 여부
4. 사용자 확인 후 적용

### "P2P 통신 이슈"
1. `dev:peer-debug` 모드 권장
2. bonjour-service 디스커버리 로그 확인
3. 양쪽 버전 호환성 확인
