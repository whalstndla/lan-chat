# 💬 LAN Chat

사내 LAN 환경에서 동작하는 P2P 채팅 애플리케이션입니다.
별도 서버 없이 mDNS + UDP 브로드캐스트로 자동 피어 발견 후 WebSocket으로 직접 연결합니다.

![Electron](https://img.shields.io/badge/Electron-40-47848F?logo=electron)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react)
![License](https://img.shields.io/badge/License-MIT-green)

## ✨ 주요 기능

### 🌐 네트워킹
| 기능 | 설명 |
|------|------|
| **자동 피어 발견** | mDNS(Bonjour) + UDP 브로드캐스트로 같은 LAN의 피어를 자동 감지 — IP 설정 불필요 |
| **AP isolation 지원** | mDNS가 차단된 환경에서 UDP 브로드캐스트로 피어 발견 |
| **전체 채팅** | 연결된 모든 피어에게 실시간 브로드캐스트 메시지 전송 |
| **1:1 다이렉트 메시지** | 특정 피어에게 직접 암호화 메시지 전송 |
| **P2P 파일 전송** | 내장 HTTP 서버를 통해 이미지, 영상, 파일 공유. HTTP 실패 시 WebSocket 폴백 |
| **오프라인 메시지 큐** | 상대방 오프라인 시 메시지를 보관 후 접속 시 자동 전달 |

### 🔐 보안
| 기능 | 설명 |
|------|------|
| **E2E 암호화 DM** | ECDH P-256 키 교환 → HKDF → AES-256-GCM — 발신자·수신자만 복호화 가능 |
| **로컬 인증** | 최초 실행 시 아이디 + 비밀번호 설정, pbkdf2(310,000회 반복)로 로컬 저장 |
| **개인키 격리** | 개인키는 본인 PC 밖으로 유출되지 않음 — DB 탈취만으로는 DM 복호화 불가 |
| **DoS 방어** | IP별 연결 수 제한(20), 초당 메시지 수 제한(50), Replay Attack 방어 |

### 🔄 자동 업데이트
| 기능 | 설명 |
|------|------|
| **업데이트 감지** | 앱 실행 시 GitHub Release를 확인해 새 버전을 백그라운드 다운로드 |
| **인앱 업데이트** | 다운로드 완료 후 타이틀바에 "지금 업데이트" 버튼 표시 |
| **원클릭 설치** | 버튼 클릭 시 앱 재시작과 함께 업데이트 자동 적용 |

### 💬 채팅 경험
| 기능 | 설명 |
|------|------|
| **마크다운 지원** | 메시지에 볼드, 이탤릭, 코드, 목록 등 마크다운 문법 사용 가능 |
| **이모지 리액션** | 메시지에 이모지 리액션 추가 (멀티 리액션 지원) |
| **이모지 피커** | 검색 기능이 포함된 내장 이모지 피커 |
| **링크 프리뷰** | 메시지 내 URL을 자동으로 클릭 가능한 링크 + 미리보기 카드로 변환 |
| **이미지·영상 미리보기** | 공유된 미디어 인라인 렌더링, 이미지 확대/축소/드래그 지원 |
| **파일 첨부** | 클릭·드래그앤드롭·클립보드 붙여넣기로 파일 첨부 |
| **채팅 기록** | SQLite에 로컬 저장, 재실행 시 복원 |
| **타이핑 인디케이터** | 상대방이 입력 중일 때 실시간 표시 |
| **읽음 확인** | DM 메시지 읽음 상태 표시 |
| **안읽은 메시지 뱃지** | DM 목록에 안읽은 메시지 수 표시 |
| **커스텀 알림 소리** | 알림 소리 4종 기본 제공 + 커스텀 사운드 업로드 |
| **메시지 검색** | 전체 채팅 및 DM 메시지 전문 검색 (FTS5) |
| **메시지 수정·삭제** | 발송한 메시지 수정 및 삭제 |
| **프로필 이미지** | 사용자별 프로필 이미지 설정 및 온라인/오프라인 상태 표시 |

## 보안 설계

| 항목 | 방식 |
|------|------|
| 앱 접근 | 아이디 + 비밀번호 (pbkdf2 310,000회, 로컬 저장) |
| DM 전송 | ECDH P-256 키 교환 → HKDF-SHA256 → AES-256-GCM (E2E) |
| DB 저장 | DM은 암호문(encryptedPayload)으로 보관 |
| 전체채팅 | 평문 전송 (사내 LAN 환경, v1 범위) |
| 네트워크 | IP별 연결 수 제한, 초당 메시지 제한, Replay Attack 방어 |

## 기술 스택

| 역할 | 기술 |
|------|------|
| 앱 프레임워크 | Electron 40 + React 19 |
| 번들러 | Vite 7 |
| 피어 발견 | bonjour-service (mDNS) + UDP 브로드캐스트 |
| 실시간 통신 | ws (WebSocket) |
| 파일 서빙 | Express |
| 데이터 저장 | better-sqlite3 (SQLite, WAL 모드, FTS5 전문 검색) |
| 상태 관리 | Zustand 5 |
| 리치 에디터 | Tiptap 3 |
| 스타일 | Tailwind CSS (VS Code 다크 테마) |
| 암호화 | Node.js crypto 내장 (ECDH, AES-GCM, HKDF, pbkdf2) |

## 시작하기

### 요구사항

- Node.js 18+
- macOS (arm64 기본 지원) / Windows 10+ / Linux

### 설치 및 실행

```bash
git clone https://github.com/whalstndla/lan-chat.git
cd lan-chat
npm install
npm run dev
```

### 테스트

```bash
npm test
```

### 릴리즈 빌드

```bash
# .env 파일에 GH_TOKEN 설정 필요
npm run release
```

## 사용 방법

1. 앱을 처음 실행하면 **닉네임, 아이디, 비밀번호** 설정 화면이 표시됩니다.
2. 같은 LAN에 있는 다른 PC에서 앱을 실행하면 자동으로 사이드바에 표시됩니다.
3. **전체 채팅** — `# 전체 채팅` 선택 후 메시지 입력
4. **DM** — 사이드바에서 상대방 이름 클릭 → 암호화된 1:1 채팅

## 주의사항

- **mDNS 방화벽**: Windows 첫 실행 시 방화벽 허용 팝업 승인이 필요합니다 (UDP 5353).
- **AP isolation 환경**: mDNS가 차단된 네트워크에서는 UDP 브로드캐스트(DHCP 허용 필요)로 피어를 발견합니다.
- **파일 URL 만료**: 발신자가 앱을 종료하면 전송한 이미지/영상에 접근할 수 없습니다.
- **개인키 백업**: `%APPDATA%/lan-chat/private_key.pem` (Windows) 또는 `~/Library/Application Support/lan-chat/private_key.pem` (macOS)을 백업해두면 PC 포맷 후에도 DM 기록을 복호화할 수 있습니다.

## 아키텍처

```
각 PC 앱
├── mDNS (bonjour-service) ──┐
├── UDP 브로드캐스트          ├─→ 피어 자동 발견
├── peer_cache (SQLite) ─────┘
├── WebSocket 서버 (49152~49161) → 메시지 수신
├── WebSocket 클라이언트 → 피어에 연결 + ECDH 키 교환
├── HTTP 서버 (Express) → 파일 서빙 (AP isolation 시 WS 폴백)
└── SQLite (WAL, FTS5) → 메시지 + 프로필 로컬 저장
```

## 라이선스

MIT
