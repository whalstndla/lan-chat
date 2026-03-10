# 💬 LAN Chat

사내 LAN 환경에서 동작하는 P2P 채팅 애플리케이션입니다.
별도 서버 없이 mDNS로 자동 피어 발견 후 WebSocket으로 직접 연결합니다.

![Electron](https://img.shields.io/badge/Electron-28-47848F?logo=electron)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react)
![License](https://img.shields.io/badge/License-MIT-green)

## ✨ Features

### 🌐 Networking
| Feature | Description |
|---------|-------------|
| **Zero-config peer discovery** | mDNS(Bonjour) automatically finds peers on the same LAN — no IP setup required |
| **Global chat** | Broadcast messages to all connected peers in real time |
| **1:1 Direct Messages** | Send private messages directly to a specific peer |
| **P2P file transfer** | Share images, videos, and files via embedded HTTP server |

### 🔐 Security
| Feature | Description |
|---------|-------------|
| **E2E encrypted DMs** | ECDH P-256 key exchange → HKDF → AES-256-GCM — only sender & receiver can read |
| **Local authentication** | Username + password on first launch, stored locally with pbkdf2 (310,000 iterations) |
| **Private key isolation** | Private key never leaves your PC; DB theft cannot decrypt stored DMs |

### 💬 Chat Experience
| Feature | Description |
|---------|-------------|
| **Emoji picker** | Built-in emoji picker with search |
| **Link detection** | URLs in messages are automatically converted to clickable links |
| **Image & video preview** | Inline rendering of shared media |
| **File attachment** | Attach any file type with one click |
| **Chat history** | Messages persisted in local SQLite, restored on relaunch |
| **Auto-scroll** | Automatically scrolls to the latest message |

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

```bash
npm run build
# dist/app/ 에 설치 파일 생성 (dmg / exe / AppImage)
```

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
