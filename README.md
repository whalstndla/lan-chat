# 💬 LAN Chat

사내 LAN 환경에서 동작하는 P2P 채팅 애플리케이션입니다.
별도 서버 없이 mDNS로 자동 피어 발견 후 WebSocket으로 직접 연결합니다.

![Electron](https://img.shields.io/badge/Electron-28-47848F?logo=electron)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react)
![License](https://img.shields.io/badge/License-MIT-green)

## ✨ 주요 기능

### 🌐 네트워킹
| 기능 | 설명 |
|------|------|
| **자동 피어 발견** | mDNS(Bonjour)로 같은 LAN의 피어를 자동 감지 — IP 설정 불필요 |
| **전체 채팅** | 연결된 모든 피어에게 실시간 브로드캐스트 메시지 전송 |
| **1:1 다이렉트 메시지** | 특정 피어에게 직접 암호화 메시지 전송 |
| **P2P 파일 전송** | 내장 HTTP 서버를 통해 이미지, 영상, 파일 공유 |

### 🔐 보안
| 기능 | 설명 |
|------|------|
| **E2E 암호화 DM** | ECDH P-256 키 교환 → HKDF → AES-256-GCM — 발신자·수신자만 복호화 가능 |
| **로컬 인증** | 최초 실행 시 아이디 + 비밀번호 설정, pbkdf2(310,000회 반복)로 로컬 저장 |
| **개인키 격리** | 개인키는 본인 PC 밖으로 유출되지 않음 — DB 탈취만으로는 DM 복호화 불가 |

### 🔄 자동 업데이트
| 기능 | 설명 |
|------|------|
| **업데이트 감지** | 앱 실행 시 GitHub Release를 확인해 새 버전을 백그라운드 다운로드 |
| **인앱 업데이트** | 다운로드 완료 후 타이틀바에 "지금 업데이트" 버튼 표시 |
| **원클릭 설치** | 버튼 클릭 시 앱 재시작과 함께 업데이트 자동 적용 |

### 💬 채팅 경험
| 기능 | 설명 |
|------|------|
| **이모지 피커** | 검색 기능이 포함된 내장 이모지 피커 |
| **링크 감지** | 메시지 내 URL을 자동으로 클릭 가능한 링크로 변환 |
| **이미지·영상 미리보기** | 공유된 미디어 인라인 렌더링 |
| **파일 첨부** | 클릭 한 번으로 모든 파일 형식 첨부 |
| **채팅 기록** | SQLite에 로컬 저장, 재실행 시 복원 |
| **자동 스크롤** | 최신 메시지로 자동 이동 |
| **안읽은 메시지 뱃지** | DM 목록에 안읽은 메시지 수 표시 |

## 보안 설계

| 항목 | 방식 |
|------|------|
| 앱 접근 | 아이디 + 비밀번호 (pbkdf2 310,000회, 로컬 저장) |
| DM 전송 | ECDH P-256 키 교환 → HKDF → AES-256-GCM (E2E) |
| DB 저장 | DM은 암호문(encryptedPayload)으로 보관 |
| 전체채팅 | 평문 전송 (사내 LAN 환경, v1 범위) |

## 기술 스택

| 역할 | 기술 |
|------|------|
| 앱 프레임워크 | Electron 28 + React 18 |
| 번들러 | Vite |
| 피어 발견 | bonjour-service (mDNS) |
| 실시간 통신 | ws (WebSocket) |
| 파일 서빙 | Express |
| 데이터 저장 | better-sqlite3 |
| 상태 관리 | Zustand |
| 스타일 | Tailwind CSS (VS Code 다크 테마) |
| 암호화 | Node.js crypto 내장 (ECDH, AES-GCM, HKDF, pbkdf2) |

## 시작하기

### 요구사항

- Node.js 18+
- macOS / Windows 10+ / Linux (Avahi 필요)

### 설치 및 실행

```bash
git clone https://github.com/your-username/electron-lan-chat.git
cd electron-lan-chat
npm install
npm run dev
```

### 빌드 (배포용)

`.env` 파일에 GitHub 토큰을 설정한 뒤 빌드합니다.

```bash
# 프로젝트 루트에 .env 파일 생성
echo 'GH_TOKEN=ghp_xxxxxxxxxxxx' > .env

npm run build
# dist/app/ 에 설치 파일 생성 (dmg / exe / AppImage)
# GitHub Release에 자동 업로드됨
```

> `.env` 파일은 `.gitignore`에 포함되어 있어 커밋되지 않습니다.

### 테스트

```bash
npm test
```

## 사용 방법

1. 앱을 처음 실행하면 **닉네임, 아이디, 비밀번호** 설정 화면이 표시됩니다.
2. 같은 LAN에 있는 다른 PC에서 앱을 실행하면 자동으로 사이드바 DM 목록에 표시됩니다.
3. **전체 채팅** — `# 전체 채팅` 선택 후 메시지 입력
4. **DM** — 사이드바에서 상대방 이름 클릭 → 암호화된 1:1 채팅

## 주의사항

- **mDNS 방화벽**: Windows 첫 실행 시 방화벽 허용 팝업 승인이 필요합니다 (UDP 5353).
- **파일 URL 만료**: 발신자가 앱을 종료하면 전송한 이미지/영상에 접근할 수 없습니다.
- **개인키 백업**: `%APPDATA%/lan-chat/private_key.pem` (Windows) 또는 `~/Library/Application Support/lan-chat/private_key.pem` (macOS)을 백업해두면 PC 포맷 후에도 DM 기록을 복호화할 수 있습니다.

## 아키텍처

```
각 PC 앱
├── mDNS 브로드캐스트 → 피어 자동 발견
├── WebSocket 서버 (포트 자동) → 메시지 수신
├── WebSocket 클라이언트 → 피어에 연결 + 키 교환
├── HTTP 서버 (Express) → 파일 서빙
└── SQLite → 메시지 + 프로필 로컬 저장
```

## 라이선스

MIT
