# LAN Chat Top 9 고도화 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** LAN Chat 앱에 9개 핵심 고도화 기능을 추가하여 안정성, 보안, UX를 대폭 향상시킨다.

**Architecture:** 각 기능은 독립적으로 구현 가능하며, Electron main process (IPC + 메시지 핸들러) → preload (IPC bridge) → React renderer (Zustand store + 컴포넌트) 파이프라인을 따른다. 백엔드 변경은 `electron/` 하위, 프론트엔드 변경은 `src/` 하위에서 이루어진다.

**Tech Stack:** Electron 40, React 19, Zustand, better-sqlite3, ws, Tiptap, Tailwind CSS

---

## 파일 구조 맵

### 수정 대상 파일
| 파일 | 변경 내용 |
|------|----------|
| `electron/peer/wsServer.js` | Heartbeat, Replay Attack 방어, 새 메시지 타입 |
| `electron/peer/wsClient.js` | 자동 재연결, Heartbeat |
| `electron/crypto/encryption.js` | HKDF 솔트/컨텍스트 강화 |
| `electron/storage/database.js` | 마이그레이션 (reactions, edited_at, cached_file_path, status, FTS5) |
| `electron/storage/queries.js` | 리액션/수정/검색/캐시/상태 쿼리 |
| `electron/main.js` | 새 IPC 핸들러, handleIncomingMessage 확장 |
| `electron/preload.js` | 새 IPC 브릿지 메서드 |
| `src/components/Message.jsx` | 리액션 UI, 수정 버튼, 읽지 않은 구분선 |
| `src/components/MessageInput.jsx` | 수정 모드, 드래그앤드롭 |
| `src/components/ChatWindow.jsx` | 검색 UI, 읽지 않은 구분선, 드래그앤드롭 오버레이 |
| `src/store/useChatStore.js` | 리액션/수정/검색 상태 |
| `src/store/usePeerStore.js` | 상태 메시지 필드 |
| `src/store/useUserStore.js` | 내 상태 메시지 |

### 신규 테스트 파일
| 파일 | 테스트 내용 |
|------|----------|
| `tests/peer/heartbeat.test.js` | Heartbeat ping-pong + 자동 재연결 |
| `tests/peer/replayAttack.test.js` | 중복 메시지 ID 차단 |
| `tests/crypto/hkdf.test.js` | 솔트/컨텍스트 분리 검증 |
| `tests/storage/reactions.test.js` | 리액션 CRUD |
| `tests/storage/editMessage.test.js` | 메시지 수정 |
| `tests/storage/search.test.js` | FTS5 검색 |
| `tests/storage/fileCache.test.js` | 파일 캐시 |
| `tests/storage/status.test.js` | 상태 메시지 |

---

## Task 1: Heartbeat/Ping-Pong + 자동 재연결

**Files:**
- Modify: `electron/peer/wsServer.js`
- Modify: `electron/peer/wsClient.js`
- Create: `tests/peer/heartbeat.test.js`

- [ ] **Step 1: Heartbeat 테스트 작성**

```javascript
// tests/peer/heartbeat.test.js
const { startWsServer, stopWsServer } = require('../../electron/peer/wsServer')
const WebSocket = require('ws')

describe('Heartbeat', () => {
  let serverInfo

  afterEach((done) => {
    if (serverInfo) {
      stopWsServer(serverInfo)
      setTimeout(done, 100)
    } else {
      done()
    }
  })

  it('서버가 ping을 보내고 클라이언트가 pong으로 응답함', (done) => {
    serverInfo = startWsServer({
      onMessage: () => {},
      heartbeatInterval: 500, // 테스트용 짧은 간격
    })

    const client = new WebSocket(`ws://localhost:${serverInfo.port}`)
    client.on('ping', () => {
      // ws 라이브러리가 자동으로 pong 응답
      client.close()
      done()
    })
  })

  it('pong 미응답 클라이언트를 종료함', (done) => {
    serverInfo = startWsServer({
      onMessage: () => {},
      heartbeatInterval: 300,
      heartbeatTimeout: 200,
    })

    const client = new WebSocket(`ws://localhost:${serverInfo.port}`)
    // pong 자동 응답을 비활성화
    client.on('open', () => {
      client.pong = () => {} // pong 응답 차단
    })
    client.on('close', () => {
      done()
    })
  })
})
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

Run: `npm test -- tests/peer/heartbeat.test.js`
Expected: FAIL — `heartbeatInterval` 옵션이 아직 미구현

- [ ] **Step 3: wsServer.js에 Heartbeat 구현**

`electron/peer/wsServer.js` 수정:

```javascript
// electron/peer/wsServer.js
const { WebSocketServer } = require('ws')

// 허용되는 메시지 타입 화이트리스트
const ALLOWED_MESSAGE_TYPES = [
  'key-exchange', 'typing', 'delete-message', 'nickname-changed',
  'read-receipt', 'message', 'dm',
  'reaction', 'edit-message', 'search-request',
  'status-changed', 'file-cache-request',
]

// IP별 연결 수 추적 (DoS 방지)
const connectionCountByIP = new Map()
const MAX_CONNECTIONS_PER_IP = 5
const MAX_MESSAGES_PER_SECOND = 20
const DEFAULT_HEARTBEAT_INTERVAL = 30000
const DEFAULT_HEARTBEAT_TIMEOUT = 10000

function startWsServer({ onMessage, heartbeatInterval, heartbeatTimeout }) {
  const hbInterval = heartbeatInterval || DEFAULT_HEARTBEAT_INTERVAL
  const hbTimeout = heartbeatTimeout || DEFAULT_HEARTBEAT_TIMEOUT
  // 최대 페이로드 10MB 제한 — 대용량 메시지로 인한 메모리 소진 방지
  const server = new WebSocketServer({ port: 0, maxPayload: 10 * 1024 * 1024 })

  server.on('connection', (socket, req) => {
    // IP별 연결 수 제한
    const clientIP = req.socket.remoteAddress || 'unknown'
    const currentCount = connectionCountByIP.get(clientIP) || 0
    if (currentCount >= MAX_CONNECTIONS_PER_IP) {
      socket.close(1008, 'Too many connections')
      return
    }
    connectionCountByIP.set(clientIP, currentCount + 1)

    // Heartbeat 상태
    socket.isAlive = true
    socket.on('pong', () => { socket.isAlive = true })

    socket.on('close', () => {
      const count = connectionCountByIP.get(clientIP) || 1
      if (count <= 1) connectionCountByIP.delete(clientIP)
      else connectionCountByIP.set(clientIP, count - 1)
    })

    // 메시지 빈도 제한 (초당 MAX_MESSAGES_PER_SECOND개)
    let messageCount = 0
    let lastResetTime = Date.now()

    // maxPayload 초과 등 소켓 에러를 개별 처리 — 없으면 uncaughtException으로 번짐
    socket.on('error', () => {})

    socket.on('message', (data) => {
      // 메시지 빈도 체크
      const now = Date.now()
      if (now - lastResetTime >= 1000) { messageCount = 0; lastResetTime = now }
      messageCount++
      if (messageCount > MAX_MESSAGES_PER_SECOND) return // 초과 시 무시

      try {
        const message = JSON.parse(data.toString())
        // 알 수 없는 메시지 타입은 무시 (fallthrough 방지)
        if (!ALLOWED_MESSAGE_TYPES.includes(message.type)) return
        const reply = (response) => {
          if (socket.readyState === socket.OPEN) {
            socket.send(JSON.stringify(response))
          }
        }
        onMessage(message, reply)
      } catch {
        // 잘못된 JSON 무시
      }
    })
  })

  // Heartbeat 인터벌 — 죽은 연결 탐지 및 종료
  const heartbeatTimer = setInterval(() => {
    server.clients.forEach((socket) => {
      if (!socket.isAlive) {
        socket.terminate()
        return
      }
      socket.isAlive = false
      socket.ping()
    })
  }, hbInterval)

  // 타임아웃 체크 — hbInterval + hbTimeout 후에도 pong 없으면 종료
  // (ping 전송 시 isAlive=false, hbInterval 후 다음 체크에서 terminate)

  server.on('close', () => {
    clearInterval(heartbeatTimer)
  })

  const port = server.address().port
  return { server, port }
}

function stopWsServer({ server }) {
  server.close()
}

// 서버에 연결된 모든 클라이언트 소켓 즉시 종료 (새로고침/재로그인 시 좀비 소켓 정리용)
// terminate()는 graceful close 없이 즉시 TCP 연결을 끊어 상대방 close 이벤트를 빠르게 발생시킴
function closeAllServerClients({ server }) {
  server.clients.forEach((socket) => socket.terminate())
}

module.exports = { startWsServer, stopWsServer, closeAllServerClients }
```

- [ ] **Step 4: 테스트 실행 — Heartbeat 통과 확인**

Run: `npm test -- tests/peer/heartbeat.test.js`
Expected: PASS

- [ ] **Step 5: 자동 재연결 테스트 작성**

`tests/peer/heartbeat.test.js`에 추가:

```javascript
describe('자동 재연결', () => {
  let serverInfo

  afterEach((done) => {
    const { disconnectAll } = require('../../electron/peer/wsClient')
    disconnectAll()
    if (serverInfo) {
      stopWsServer(serverInfo)
      setTimeout(done, 100)
    } else {
      done()
    }
  })

  it('연결 끊김 후 자동 재연결을 시도함', (done) => {
    const { connectToPeer, getConnections } = require('../../electron/peer/wsClient')

    serverInfo = startWsServer({ onMessage: () => {} })

    let reconnectCount = 0
    connectToPeer({
      peerId: 'peer-reconnect',
      host: 'localhost',
      wsPort: serverInfo.port,
      autoReconnect: true,
      reconnectBaseDelay: 100,
      onReconnect: () => {
        reconnectCount++
        if (reconnectCount >= 1) {
          expect(getConnections()).toContain('peer-reconnect')
          done()
        }
      },
    }).then(() => {
      // 서버 측에서 클라이언트 강제 종료
      serverInfo.server.clients.forEach(s => s.terminate())
    })
  }, 10000)
})
```

- [ ] **Step 6: 테스트 실행 — 실패 확인**

Run: `npm test -- tests/peer/heartbeat.test.js`
Expected: FAIL — `autoReconnect` 옵션 미구현

- [ ] **Step 7: wsClient.js에 자동 재연결 구현**

`electron/peer/wsClient.js` 수정:

```javascript
// electron/peer/wsClient.js
const WebSocket = require('ws')

// 피어 ID → WebSocket 소켓 매핑
const connectionMap = new Map()
// 피어 ID → 재연결 타이머
const reconnectTimers = new Map()
// 피어 ID → 연결 옵션 (재연결용)
const connectionOptions = new Map()

const DEFAULT_RECONNECT_BASE_DELAY = 1000
const MAX_RECONNECT_DELAY = 30000
const MAX_RECONNECT_ATTEMPTS = 10

function connectToPeer({ peerId, host, wsPort, onMessage, onClose, force, autoReconnect, reconnectBaseDelay, onReconnect }) {
  // 재연결 타이머 취소 (새 연결 시도 시)
  clearReconnectTimer(peerId)

  return new Promise((resolve, reject) => {
    const existingSocket = connectionMap.get(peerId)
    if (existingSocket) {
      if (existingSocket.readyState === WebSocket.OPEN && !force) {
        // 정상 연결 중이면 재연결 불필요 (force 시 강제 교체)
        resolve()
        return
      }
      // 기존 소켓 정리 — connectionMap에서 먼저 제거하여 비동기 close가 새 매핑을 건드리지 않도록 함
      connectionMap.delete(peerId)
      existingSocket.close()
    }

    // 연결 옵션 저장 (재연결용)
    if (autoReconnect) {
      connectionOptions.set(peerId, { peerId, host, wsPort, onMessage, onClose, autoReconnect, reconnectBaseDelay, onReconnect })
    }

    const socket = new WebSocket(`ws://${host}:${wsPort}`)
    // 연결 성공 여부 플래그 — 연결 실패 시 onClose가 오발되지 않도록 방지
    let connected = false

    socket.on('open', () => {
      connected = true
      connectionMap.set(peerId, socket)
      // 재연결 시도 횟수 초기화
      const opts = connectionOptions.get(peerId)
      if (opts) opts._attempts = 0
      resolve()
    })

    // 서버가 클라이언트 소켓으로 reply 보낼 때 처리 (key-exchange reply 등)
    socket.on('message', (data) => {
      if (onMessage) {
        try {
          const message = JSON.parse(data.toString())
          onMessage(message, () => {}) // 클라이언트는 reply 불필요
        } catch { /* 잘못된 JSON 무시 */ }
      }
    })

    // onClose: 연결 성공 후 소켓 종료 시에만 호출 (강제 종료 감지용)
    // identity 체크: force 교체된 old 소켓의 close가 새 매핑 삭제 및 false peer-left 방지
    socket.on('close', () => {
      const isCurrent = connectionMap.get(peerId) === socket
      if (isCurrent) {
        connectionMap.delete(peerId)
      }

      // 자동 재연결 시도
      if (isCurrent && connected && autoReconnect) {
        scheduleReconnect(peerId)
      }

      // 교체된(replaced) 소켓은 onClose를 호출하지 않음 — 의도된 교체이므로 peer-left 불필요
      if (isCurrent && connected && onClose) onClose()
    })

    socket.on('error', reject)
  })
}

function scheduleReconnect(peerId) {
  const opts = connectionOptions.get(peerId)
  if (!opts) return

  opts._attempts = (opts._attempts || 0) + 1
  if (opts._attempts > MAX_RECONNECT_ATTEMPTS) {
    connectionOptions.delete(peerId)
    return
  }

  const baseDelay = opts.reconnectBaseDelay || DEFAULT_RECONNECT_BASE_DELAY
  // 지수 백오프: 1s → 2s → 4s → ... → max 30s
  const delay = Math.min(baseDelay * Math.pow(2, opts._attempts - 1), MAX_RECONNECT_DELAY)

  const timer = setTimeout(() => {
    reconnectTimers.delete(peerId)
    connectToPeer({
      ...opts,
      force: true,
    }).then(() => {
      if (opts.onReconnect) opts.onReconnect()
    }).catch(() => {
      // 재연결 실패 시 다시 스케줄링
      scheduleReconnect(peerId)
    })
  }, delay)

  reconnectTimers.set(peerId, timer)
}

function clearReconnectTimer(peerId) {
  const timer = reconnectTimers.get(peerId)
  if (timer) {
    clearTimeout(timer)
    reconnectTimers.delete(peerId)
  }
}

function sendMessage(peerId, messageObj) {
  const socket = connectionMap.get(peerId)
  if (!socket || socket.readyState !== WebSocket.OPEN) return false
  socket.send(JSON.stringify(messageObj))
  return true
}

function broadcastMessage(messageObj) {
  connectionMap.forEach((socket) => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(messageObj))
    }
  })
}

function disconnectFromPeer(peerId) {
  clearReconnectTimer(peerId)
  connectionOptions.delete(peerId)
  const socket = connectionMap.get(peerId)
  if (socket) {
    socket.close()
    connectionMap.delete(peerId)
  }
}

// OPEN 상태인 연결만 반환 — CLOSING/CLOSED 좀비 소켓은 제외
function getConnections() {
  const activeConnections = []
  connectionMap.forEach((socket, peerId) => {
    if (socket.readyState === WebSocket.OPEN) {
      activeConnections.push(peerId)
    }
  })
  return activeConnections
}

function disconnectAll() {
  // 모든 재연결 타이머 취소
  reconnectTimers.forEach((timer) => clearTimeout(timer))
  reconnectTimers.clear()
  connectionOptions.clear()
  connectionMap.forEach((socket) => {
    socket.close()
  })
  connectionMap.clear()
}

module.exports = { connectToPeer, sendMessage, broadcastMessage, disconnectFromPeer, disconnectAll, getConnections }
```

- [ ] **Step 8: 테스트 실행 — 전체 통과 확인**

Run: `npm test -- tests/peer/heartbeat.test.js`
Expected: PASS

- [ ] **Step 9: 기존 테스트 통과 확인**

Run: `npm test -- tests/peer/wsServer.test.js tests/peer/wsClient.test.js`
Expected: PASS

- [ ] **Step 10: main.js에서 자동 재연결 활성화**

`electron/main.js`의 `connectToPeer` 호출부(라인 296, 468 부근)에 `autoReconnect: true` 옵션 추가.

- [ ] **Step 11: 커밋**

```bash
git add electron/peer/wsServer.js electron/peer/wsClient.js tests/peer/heartbeat.test.js electron/main.js
git commit -m "$(cat <<'EOF'
feat: WebSocket heartbeat ping-pong + 자동 재연결

- 30초 간격 ping/pong으로 좀비 연결 탐지 및 종료
- 연결 끊김 시 지수 백오프(1s→30s) 자동 재연결
- 최대 10회 재시도 후 포기
EOF
)"
```

---

## Task 2: 드래그 앤 드롭 파일 전송

**Files:**
- Modify: `src/components/ChatWindow.jsx`
- Modify: `src/components/MessageInput.jsx`

- [ ] **Step 1: ChatWindow.jsx에 드래그 앤 드롭 오버레이 추가**

`src/components/ChatWindow.jsx` 수정 — import에 `useState` 이미 있음. 드래그 상태와 이벤트 핸들러 추가:

```jsx
// ChatWindow.jsx 상단 state 추가 (newMessageToast 아래)
const [isDragOver, setIsDragOver] = useState(false)
const dragCounterRef = useRef(0)

// 드래그 앤 드롭 핸들러
function handleDragEnter(event) {
  event.preventDefault()
  dragCounterRef.current++
  if (event.dataTransfer.types.includes('Files')) {
    setIsDragOver(true)
  }
}

function handleDragLeave(event) {
  event.preventDefault()
  dragCounterRef.current--
  if (dragCounterRef.current === 0) {
    setIsDragOver(false)
  }
}

function handleDragOver(event) {
  event.preventDefault()
}

function handleDrop(event) {
  event.preventDefault()
  dragCounterRef.current = 0
  setIsDragOver(false)
  const files = event.dataTransfer.files
  if (files.length > 0) {
    // MessageInput의 sendFile을 호출하기 위해 ref 사용
    if (messageInputRef.current) {
      messageInputRef.current.handleDroppedFiles(files)
    }
  }
}
```

최상위 div에 이벤트 바인딩:
```jsx
<div
  className="flex flex-col flex-1 overflow-hidden"
  onDragEnter={handleDragEnter}
  onDragLeave={handleDragLeave}
  onDragOver={handleDragOver}
  onDrop={handleDrop}
>
```

오버레이 UI (메시지 목록 영역 내부):
```jsx
{isDragOver && (
  <div className="absolute inset-0 z-40 bg-vsc-bg/80 flex items-center justify-center border-2 border-dashed border-vsc-accent rounded-lg m-2">
    <p className="text-vsc-accent text-sm font-semibold">파일을 여기에 놓으세요</p>
  </div>
)}
```

MessageInput ref 추가:
```jsx
const messageInputRef = useRef(null)
// ...
<MessageInput ref={messageInputRef} />
```

- [ ] **Step 2: MessageInput.jsx에 forwardRef + handleDroppedFiles 노출**

`src/components/MessageInput.jsx` 수정 — `forwardRef`로 변환하고 `useImperativeHandle`로 `handleDroppedFiles` 노출:

```jsx
import React, { useState, useRef, Suspense, lazy, forwardRef, useImperativeHandle } from 'react'

const MessageInput = forwardRef(function MessageInput(props, ref) {
  // ... 기존 코드 ...

  // 드래그앤드롭 파일 처리
  function handleDroppedFiles(fileList) {
    const file = fileList[0] // 첫 번째 파일만 처리
    if (!file) return
    sendFile(file)
  }

  useImperativeHandle(ref, () => ({
    handleDroppedFiles,
  }))

  // ... 기존 return ...
})

export default MessageInput
```

- [ ] **Step 3: 테스트 — 앱 실행 후 파일 드래그앤드롭 동작 확인**

Run: `npm run dev`
Expected: 채팅창에 파일 드래그 시 오버레이 표시, 드롭 시 파일 전송

- [ ] **Step 4: 커밋**

```bash
git add src/components/ChatWindow.jsx src/components/MessageInput.jsx
git commit -m "$(cat <<'EOF'
feat: 드래그 앤 드롭 파일 전송

- 채팅창에 파일 드래그 시 시각적 오버레이 표시
- 드롭 시 기존 sendFile() 재사용하여 파일 전송
- MessageInput에 forwardRef + useImperativeHandle 적용
EOF
)"
```

---

## Task 3: 이모지 리액션

**Files:**
- Modify: `electron/storage/database.js`
- Modify: `electron/storage/queries.js`
- Modify: `electron/main.js`
- Modify: `electron/preload.js`
- Modify: `electron/peer/wsServer.js` (ALLOWED_MESSAGE_TYPES — Task 1에서 이미 추가)
- Modify: `src/components/Message.jsx`
- Modify: `src/store/useChatStore.js`
- Create: `tests/storage/reactions.test.js`

- [ ] **Step 1: reactions 테이블 테스트 작성**

```javascript
// tests/storage/reactions.test.js
const { initDatabase, migrateDatabase, closeDatabase } = require('../../electron/storage/database')
const { saveMessage } = require('../../electron/storage/queries')
const { addReaction, removeReaction, getReactions } = require('../../electron/storage/queries')

describe('메시지 리액션', () => {
  let db

  beforeEach(() => {
    db = initDatabase(':memory:')
    migrateDatabase(db)
    // 테스트용 메시지 삽입
    saveMessage(db, {
      id: 'msg-1', type: 'message', from_id: 'peer1', from_name: '홍길동',
      to_id: null, content: '안녕', content_type: 'text',
      encrypted_payload: null, file_url: null, file_name: null, timestamp: Date.now(),
    })
  })
  afterEach(() => closeDatabase(db))

  it('리액션을 추가하고 조회함', () => {
    addReaction(db, { messageId: 'msg-1', peerId: 'peer1', emoji: '👍' })
    const reactions = getReactions(db, 'msg-1')
    expect(reactions).toHaveLength(1)
    expect(reactions[0].emoji).toBe('👍')
    expect(reactions[0].peer_id).toBe('peer1')
  })

  it('같은 이모지 중복 리액션은 무시됨', () => {
    addReaction(db, { messageId: 'msg-1', peerId: 'peer1', emoji: '👍' })
    addReaction(db, { messageId: 'msg-1', peerId: 'peer1', emoji: '👍' })
    const reactions = getReactions(db, 'msg-1')
    expect(reactions).toHaveLength(1)
  })

  it('리액션을 제거함', () => {
    addReaction(db, { messageId: 'msg-1', peerId: 'peer1', emoji: '👍' })
    removeReaction(db, { messageId: 'msg-1', peerId: 'peer1', emoji: '👍' })
    const reactions = getReactions(db, 'msg-1')
    expect(reactions).toHaveLength(0)
  })

  it('여러 이모지와 여러 피어의 리액션을 조회함', () => {
    addReaction(db, { messageId: 'msg-1', peerId: 'peer1', emoji: '👍' })
    addReaction(db, { messageId: 'msg-1', peerId: 'peer2', emoji: '👍' })
    addReaction(db, { messageId: 'msg-1', peerId: 'peer1', emoji: '😂' })
    const reactions = getReactions(db, 'msg-1')
    expect(reactions).toHaveLength(3)
  })
})
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

Run: `npm test -- tests/storage/reactions.test.js`
Expected: FAIL — `addReaction`, `removeReaction`, `getReactions` 미정의

- [ ] **Step 3: DB 마이그레이션에 reactions 테이블 추가**

`electron/storage/database.js`의 `migrateDatabase()` 끝에 추가:

```javascript
// 리액션 테이블
db.exec(`
  CREATE TABLE IF NOT EXISTS reactions (
    message_id TEXT NOT NULL,
    peer_id    TEXT NOT NULL,
    emoji      TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
    PRIMARY KEY (message_id, peer_id, emoji)
  );
  CREATE INDEX IF NOT EXISTS idx_reactions_message ON reactions(message_id);
`)
```

- [ ] **Step 4: queries.js에 리액션 CRUD 함수 추가**

`electron/storage/queries.js`에 추가:

```javascript
function addReaction(db, { messageId, peerId, emoji }) {
  db.prepare(`
    INSERT OR IGNORE INTO reactions (message_id, peer_id, emoji, created_at)
    VALUES (?, ?, ?, ?)
  `).run(messageId, peerId, emoji, Date.now())
}

function removeReaction(db, { messageId, peerId, emoji }) {
  db.prepare('DELETE FROM reactions WHERE message_id = ? AND peer_id = ? AND emoji = ?')
    .run(messageId, peerId, emoji)
}

function getReactions(db, messageId) {
  return db.prepare('SELECT * FROM reactions WHERE message_id = ?').all(messageId)
}

function getReactionsByMessageIds(db, messageIds) {
  if (!messageIds?.length) return {}
  const placeholders = messageIds.map(() => '?').join(',')
  const rows = db.prepare(`SELECT * FROM reactions WHERE message_id IN (${placeholders})`).all(...messageIds)
  // { messageId: [{ peer_id, emoji, created_at }] }
  const grouped = {}
  for (const row of rows) {
    if (!grouped[row.message_id]) grouped[row.message_id] = []
    grouped[row.message_id].push(row)
  }
  return grouped
}
```

module.exports에 `addReaction, removeReaction, getReactions, getReactionsByMessageIds` 추가.

- [ ] **Step 5: 테스트 실행 — 통과 확인**

Run: `npm test -- tests/storage/reactions.test.js`
Expected: PASS

- [ ] **Step 6: main.js에 리액션 IPC 핸들러 + 메시지 핸들러 추가**

`handleIncomingMessage`에 reaction 타입 처리 추가:

```javascript
// handleIncomingMessage 내부 (key-exchange 위에)
if (message.type === 'reaction') {
  try {
    if (message.action === 'add') {
      addReaction(database, { messageId: message.messageId, peerId: message.fromId, emoji: message.emoji })
    } else if (message.action === 'remove') {
      removeReaction(database, { messageId: message.messageId, peerId: message.fromId, emoji: message.emoji })
    }
    sendToRenderer('reaction-updated', {
      messageId: message.messageId,
      peerId: message.fromId,
      emoji: message.emoji,
      action: message.action,
    })
  } catch { /* 무시 */ }
  return
}
```

IPC 핸들러 추가 (registerIpcHandlers 내부):

```javascript
// 리액션 토글
ipcMain.handle('toggle-reaction', (_, { messageId, emoji, targetPeerId }) => {
  const existing = getReactions(database, messageId)
    .find(r => r.peer_id === currentPeerId && r.emoji === emoji)

  const action = existing ? 'remove' : 'add'

  if (action === 'add') {
    addReaction(database, { messageId, peerId: currentPeerId, emoji })
  } else {
    removeReaction(database, { messageId, peerId: currentPeerId, emoji })
  }

  // 피어에게 전파
  const reactionMessage = {
    type: 'reaction',
    messageId,
    fromId: currentPeerId,
    emoji,
    action,
    timestamp: Date.now(),
  }
  if (targetPeerId) {
    sendMessage(targetPeerId, reactionMessage)
  } else {
    broadcastMessage(reactionMessage)
  }

  return { action }
})

// 메시지별 리액션 조회
ipcMain.handle('get-reactions', (_, messageIds) => {
  return getReactionsByMessageIds(database, messageIds)
})
```

- [ ] **Step 7: preload.js에 리액션 IPC 브릿지 추가**

```javascript
// 리액션
toggleReaction: (data) => ipcRenderer.invoke('toggle-reaction', data),
getReactions: (messageIds) => ipcRenderer.invoke('get-reactions', messageIds),
onReactionUpdated: (callback) => {
  ipcRenderer.removeAllListeners('reaction-updated')
  ipcRenderer.on('reaction-updated', (_, data) => callback(data))
},
```

`unsubscribeAll`에 `ipcRenderer.removeAllListeners('reaction-updated')` 추가.

- [ ] **Step 8: useChatStore.js에 리액션 상태 추가**

```javascript
// 상태에 추가
reactions: {}, // { messageId: { emoji: [peerId, ...] } }

// 액션 추가
setReactions: (reactionsMap) =>
  set((state) => ({ reactions: { ...state.reactions, ...reactionsMap } })),

updateReaction: (messageId, peerId, emoji, action) =>
  set((state) => {
    const messageReactions = { ...(state.reactions[messageId] || {}) }
    const emojiReactors = [...(messageReactions[emoji] || [])]

    if (action === 'add' && !emojiReactors.includes(peerId)) {
      emojiReactors.push(peerId)
    } else if (action === 'remove') {
      const index = emojiReactors.indexOf(peerId)
      if (index !== -1) emojiReactors.splice(index, 1)
    }

    if (emojiReactors.length === 0) {
      delete messageReactions[emoji]
    } else {
      messageReactions[emoji] = emojiReactors
    }

    return { reactions: { ...state.reactions, [messageId]: messageReactions } }
  }),
```

`resetAll`에 `reactions: {}` 추가.

- [ ] **Step 9: Message.jsx에 리액션 UI 추가**

메시지 내용 아래, 라이트박스 위에 리액션 표시 영역 추가:

```jsx
// import 추가
import { Paperclip, Trash2, X, Clock, Check, CheckCheck, SmilePlus } from 'lucide-react'

// useChatStore에서 reactions 가져오기
const reactions = useChatStore(state => state.reactions[message.id] || {})
const { updateReaction } = useChatStore()

// 리액션 퀵 이모지 목록
const quickEmojis = ['👍', '❤️', '😂', '🎉', '😮', '😢']

// 리액션 토글 함수
async function handleReaction(emoji) {
  const targetPeerId = (message.type === 'dm')
    ? (isMyMessage ? (message.to || message.to_id) : senderId)
    : null
  const result = await window.electronAPI.toggleReaction({
    messageId: message.id,
    emoji,
    targetPeerId,
  })
  updateReaction(message.id, myPeerId, emoji, result.action)
}

// 메시지 내용 div 닫힌 후에 렌더링:
{/* 리액션 바 — hover 시 빠른 추가 버튼 */}
<div className="flex items-center gap-1 mt-0.5 flex-wrap">
  {Object.entries(reactions).map(([emoji, peerIds]) => (
    <button
      key={emoji}
      onClick={() => handleReaction(emoji)}
      className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-xs border cursor-pointer transition-colors ${
        peerIds.includes(myPeerId)
          ? 'bg-vsc-accent/20 border-vsc-accent text-vsc-accent'
          : 'bg-vsc-panel border-vsc-border text-vsc-muted hover:border-vsc-accent'
      }`}
    >
      <span>{emoji}</span>
      <span>{peerIds.length}</span>
    </button>
  ))}
  {/* 퀵 리액션 추가 버튼 */}
  <div className="relative group/reaction">
    <button
      className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded text-vsc-muted hover:text-vsc-accent cursor-pointer"
      aria-label="리액션 추가"
    >
      <SmilePlus size={14} />
    </button>
    <div className="hidden group-hover/reaction:flex absolute bottom-full left-0 mb-1 bg-vsc-sidebar border border-vsc-border rounded-lg shadow-lg p-1 gap-0.5 z-10">
      {quickEmojis.map(emoji => (
        <button
          key={emoji}
          onClick={() => handleReaction(emoji)}
          className="p-1 hover:bg-vsc-hover rounded cursor-pointer text-sm"
        >
          {emoji}
        </button>
      ))}
    </div>
  </div>
</div>
```

- [ ] **Step 10: App.jsx에 리액션 이벤트 구독 추가**

App.jsx의 이벤트 구독 영역에서:

```javascript
window.electronAPI.onReactionUpdated(({ messageId, peerId, emoji, action }) => {
  useChatStore.getState().updateReaction(messageId, peerId, emoji, action)
})
```

- [ ] **Step 11: 기존 테스트 통과 확인**

Run: `npm test`
Expected: 전체 PASS

- [ ] **Step 12: 커밋**

```bash
git add electron/storage/database.js electron/storage/queries.js electron/main.js electron/preload.js src/components/Message.jsx src/store/useChatStore.js src/App.jsx tests/storage/reactions.test.js
git commit -m "$(cat <<'EOF'
feat: 메시지 이모지 리액션

- 메시지 hover 시 퀵 리액션 6종(👍❤️😂🎉😮😢) 선택 가능
- 리액션 토글(추가/제거), 피어 간 실시간 동기화
- reactions DB 테이블 + Zustand 상태 관리
EOF
)"
```

---

## Task 4: 메시지 수정

**Files:**
- Modify: `electron/storage/database.js`
- Modify: `electron/storage/queries.js`
- Modify: `electron/main.js`
- Modify: `electron/preload.js`
- Modify: `src/components/Message.jsx`
- Modify: `src/components/MessageInput.jsx`
- Modify: `src/store/useChatStore.js`
- Create: `tests/storage/editMessage.test.js`

- [ ] **Step 1: 메시지 수정 쿼리 테스트 작성**

```javascript
// tests/storage/editMessage.test.js
const { initDatabase, migrateDatabase, closeDatabase } = require('../../electron/storage/database')
const { saveMessage, getGlobalHistory, editMessage } = require('../../electron/storage/queries')

describe('메시지 수정', () => {
  let db

  beforeEach(() => {
    db = initDatabase(':memory:')
    migrateDatabase(db)
    saveMessage(db, {
      id: 'msg-1', type: 'message', from_id: 'peer1', from_name: '홍길동',
      to_id: null, content: '원본 메시지', content_type: 'text',
      encrypted_payload: null, file_url: null, file_name: null, timestamp: Date.now(),
    })
  })
  afterEach(() => closeDatabase(db))

  it('메시지 내용을 수정하고 edited_at이 설정됨', () => {
    editMessage(db, { messageId: 'msg-1', fromId: 'peer1', newContent: '수정된 메시지' })
    const history = getGlobalHistory(db)
    expect(history[0].content).toBe('수정된 메시지')
    expect(history[0].edited_at).toBeGreaterThan(0)
  })

  it('다른 사용자는 메시지를 수정할 수 없음', () => {
    editMessage(db, { messageId: 'msg-1', fromId: 'peer2', newContent: '해킹' })
    const history = getGlobalHistory(db)
    expect(history[0].content).toBe('원본 메시지')
  })
})
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

Run: `npm test -- tests/storage/editMessage.test.js`
Expected: FAIL

- [ ] **Step 3: DB 마이그레이션 + 쿼리 구현**

`database.js` migrateDatabase에 추가:
```javascript
const editMigrations = [
  'ALTER TABLE messages ADD COLUMN edited_at INTEGER',
]
for (const sql of editMigrations) {
  try { db.prepare(sql).run() } catch { /* 이미 존재하면 무시 */ }
}
```

`queries.js`에 추가:
```javascript
function editMessage(db, { messageId, fromId, newContent }) {
  return db.prepare(`
    UPDATE messages SET content = ?, edited_at = ?
    WHERE id = ? AND from_id = ?
  `).run(newContent, Date.now(), messageId, fromId)
}
```

module.exports에 `editMessage` 추가.

- [ ] **Step 4: 테스트 실행 — 통과 확인**

Run: `npm test -- tests/storage/editMessage.test.js`
Expected: PASS

- [ ] **Step 5: main.js에 수정 IPC + 메시지 핸들러 추가**

handleIncomingMessage에 추가:
```javascript
if (message.type === 'edit-message') {
  try {
    editMessage(database, { messageId: message.messageId, fromId: message.fromId, newContent: message.newContent })
    sendToRenderer('message-edited', {
      messageId: message.messageId,
      fromId: message.fromId,
      newContent: message.newContent,
      editedAt: message.editedAt,
      to: message.to || null,
    })
  } catch { /* 무시 */ }
  return
}
```

IPC 핸들러:
```javascript
ipcMain.handle('edit-message', (_, { messageId, newContent, targetPeerId }) => {
  if (!newContent?.trim() || newContent.length > MAX_CONTENT_LENGTH) return null
  const editedAt = Date.now()
  editMessage(database, { messageId, fromId: currentPeerId, newContent })

  const currentNickname = getProfile(database)?.nickname || defaultNickname
  const editPayload = {
    type: 'edit-message',
    messageId,
    fromId: currentPeerId,
    from: currentNickname,
    newContent,
    editedAt,
    to: targetPeerId || null,
    timestamp: Date.now(),
  }
  if (targetPeerId) {
    sendMessage(targetPeerId, editPayload)
  } else {
    broadcastMessage(editPayload)
  }
  return { editedAt }
})
```

- [ ] **Step 6: preload.js에 수정 IPC 브릿지 추가**

```javascript
editMessage: (data) => ipcRenderer.invoke('edit-message', data),
onMessageEdited: (callback) => {
  ipcRenderer.removeAllListeners('message-edited')
  ipcRenderer.on('message-edited', (_, data) => callback(data))
},
```

unsubscribeAll에 `ipcRenderer.removeAllListeners('message-edited')` 추가.

- [ ] **Step 7: useChatStore.js에 editMessage 액션 추가**

```javascript
editGlobalMessage: (messageId, newContent, editedAt) =>
  set((state) => ({
    globalMessages: state.globalMessages.map(msg =>
      msg.id === messageId ? { ...msg, content: newContent, edited_at: editedAt } : msg
    ),
  })),

editDMMessage: (peerId, messageId, newContent, editedAt) =>
  set((state) => ({
    dmMessages: {
      ...state.dmMessages,
      [peerId]: (state.dmMessages[peerId] || []).map(msg =>
        msg.id === messageId ? { ...msg, content: newContent, edited_at: editedAt } : msg
      ),
    },
  })),
```

- [ ] **Step 8: Message.jsx에 수정 버튼 + "(수정됨)" 표시 추가**

삭제 버튼 옆에 수정 버튼:
```jsx
import { Paperclip, Trash2, X, Clock, Check, CheckCheck, SmilePlus, Pencil } from 'lucide-react'

// Trash2 버튼 앞에 추가 (isMyMessage && contentType === 'text' 조건):
{isMyMessage && !message.pending && (contentType === 'text' || !contentType) && (
  <button
    onClick={() => onStartEdit?.(message)}
    aria-label="메시지 수정"
    title="메시지 수정"
    className="opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer p-0.5 rounded text-vsc-muted hover:text-vsc-accent hover:bg-vsc-hover"
  >
    <Pencil size={12} />
  </button>
)}
```

"(수정됨)" 표시 — 시간 옆에:
```jsx
{message.edited_at && (
  <span className="text-vsc-muted text-xs opacity-70">(수정됨)</span>
)}
```

Message props에 `onStartEdit` 추가.

- [ ] **Step 9: MessageInput.jsx에 수정 모드 추가**

```jsx
// 상태 추가
const [editingMessage, setEditingMessage] = useState(null)

// 수정 시작 (ChatWindow에서 호출)
function startEdit(message) {
  setEditingMessage(message)
  editor?.commands.setContent(message.content || '')
  editor?.commands.focus()
}

// 수정 전송
async function submitEdit() {
  if (!editingMessage || !editor) return
  const newContent = editor.storage.markdown.getMarkdown().trim()
  if (!newContent) return

  const targetPeerId = editingMessage.type === 'dm'
    ? (editingMessage.to || editingMessage.to_id) : null

  const result = await window.electronAPI.editMessage({
    messageId: editingMessage.id,
    newContent,
    targetPeerId,
  })

  if (result) {
    const { editGlobalMessage, editDMMessage, currentRoom } = useChatStore.getState()
    if (targetPeerId) {
      editDMMessage(targetPeerId, editingMessage.id, newContent, result.editedAt)
    } else {
      editGlobalMessage(editingMessage.id, newContent, result.editedAt)
    }
  }

  setEditingMessage(null)
  editor.commands.clearContent()
}

// 수정 취소
function cancelEdit() {
  setEditingMessage(null)
  editor?.commands.clearContent()
}

// useImperativeHandle에 startEdit 추가
useImperativeHandle(ref, () => ({
  handleDroppedFiles,
  startEdit,
}))

// 수정 모드 UI — 에디터 위에 배너 표시
{editingMessage && (
  <div className="flex items-center gap-2 px-3 py-1.5 bg-vsc-panel border-b border-vsc-border text-xs text-vsc-muted">
    <Pencil size={12} />
    <span>메시지 수정 중</span>
    <button onClick={cancelEdit} className="ml-auto text-vsc-muted hover:text-red-400 cursor-pointer">
      <X size={12} />
    </button>
  </div>
)}

// sendMessage 함수 시작부에 수정 모드 분기:
if (editingMessage) {
  submitEdit()
  return
}
```

- [ ] **Step 10: ChatWindow.jsx에서 Message에 onStartEdit 전달**

```jsx
<Message
  key={message.id}
  message={message}
  onStartEdit={(msg) => messageInputRef.current?.startEdit(msg)}
/>
```

- [ ] **Step 11: App.jsx에 수정 이벤트 구독 추가**

```javascript
window.electronAPI.onMessageEdited(({ messageId, fromId, newContent, editedAt, to }) => {
  const { editGlobalMessage, editDMMessage } = useChatStore.getState()
  if (to) {
    editDMMessage(fromId, messageId, newContent, editedAt)
  } else {
    editGlobalMessage(messageId, newContent, editedAt)
  }
})
```

- [ ] **Step 12: 기존 테스트 통과 확인**

Run: `npm test`
Expected: 전체 PASS

- [ ] **Step 13: 커밋**

```bash
git add electron/storage/database.js electron/storage/queries.js electron/main.js electron/preload.js src/components/Message.jsx src/components/MessageInput.jsx src/components/ChatWindow.jsx src/store/useChatStore.js src/App.jsx tests/storage/editMessage.test.js
git commit -m "$(cat <<'EOF'
feat: 메시지 수정 기능

- 내 텍스트 메시지 hover 시 수정 버튼 표시
- 수정 모드 진입 시 입력창에 기존 내용 표시
- 수정된 메시지에 "(수정됨)" 라벨 표시
- 피어 간 실시간 동기화, DB edited_at 컬럼
EOF
)"
```

---

## Task 5: 메시지 검색 (FTS5)

**Files:**
- Modify: `electron/storage/database.js`
- Modify: `electron/storage/queries.js`
- Modify: `electron/main.js`
- Modify: `electron/preload.js`
- Modify: `src/components/ChatWindow.jsx`
- Modify: `src/store/useChatStore.js`
- Create: `tests/storage/search.test.js`

- [ ] **Step 1: 검색 쿼리 테스트 작성**

```javascript
// tests/storage/search.test.js
const { initDatabase, migrateDatabase, closeDatabase } = require('../../electron/storage/database')
const { saveMessage, searchMessages } = require('../../electron/storage/queries')

describe('메시지 검색', () => {
  let db

  beforeEach(() => {
    db = initDatabase(':memory:')
    migrateDatabase(db)
    // 테스트 데이터
    saveMessage(db, {
      id: 'msg-1', type: 'message', from_id: 'peer1', from_name: '홍길동',
      to_id: null, content: '오늘 회의 자료 공유합니다', content_type: 'text',
      encrypted_payload: null, file_url: null, file_name: null, timestamp: 1000,
    })
    saveMessage(db, {
      id: 'msg-2', type: 'message', from_id: 'peer2', from_name: '김철수',
      to_id: null, content: '회의 시간이 변경되었습니다', content_type: 'text',
      encrypted_payload: null, file_url: null, file_name: null, timestamp: 2000,
    })
    saveMessage(db, {
      id: 'msg-3', type: 'message', from_id: 'peer1', from_name: '홍길동',
      to_id: null, content: '점심 뭐 먹을까요', content_type: 'text',
      encrypted_payload: null, file_url: null, file_name: null, timestamp: 3000,
    })
  })
  afterEach(() => closeDatabase(db))

  it('키워드로 메시지를 검색함', () => {
    const results = searchMessages(db, { query: '회의', type: 'message' })
    expect(results).toHaveLength(2)
  })

  it('검색 결과가 없으면 빈 배열 반환', () => {
    const results = searchMessages(db, { query: '존재하지않는단어', type: 'message' })
    expect(results).toHaveLength(0)
  })

  it('최근 순으로 정렬됨', () => {
    const results = searchMessages(db, { query: '회의', type: 'message' })
    expect(results[0].id).toBe('msg-2') // timestamp 더 큰 것이 먼저
  })
})
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

Run: `npm test -- tests/storage/search.test.js`
Expected: FAIL

- [ ] **Step 3: FTS5 테이블 + 검색 쿼리 구현**

`database.js` migrateDatabase에 추가:
```javascript
// FTS5 전문 검색 테이블 (글로벌 메시지만 — DM은 암호화되어 인덱싱 불가)
try {
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
      id UNINDEXED, content, from_name,
      content='messages', content_rowid='rowid'
    );
  `)
  // 기존 메시지 FTS 인덱싱 (최초 마이그레이션 시)
  db.exec(`
    INSERT OR IGNORE INTO messages_fts(id, content, from_name)
    SELECT id, content, from_name FROM messages
    WHERE type = 'message' AND content IS NOT NULL;
  `)
} catch { /* FTS5 미지원 환경 무시 */ }
```

`queries.js`의 `saveMessage` 수정 — FTS 인덱스 동기화:
```javascript
function saveMessage(db, message) {
  db.prepare(`
    INSERT OR IGNORE INTO messages
    (id, type, from_id, from_name, to_id, content, content_type, encrypted_payload, file_url, file_name, timestamp, format)
    VALUES (@id, @type, @from_id, @from_name, @to_id, @content, @content_type, @encrypted_payload, @file_url, @file_name, @timestamp, @format)
  `).run({ ...message, format: message.format || null })

  // FTS 인덱스 업데이트 (글로벌 텍스트 메시지만)
  if (message.type === 'message' && message.content) {
    try {
      db.prepare(`INSERT OR IGNORE INTO messages_fts(id, content, from_name) VALUES (?, ?, ?)`)
        .run(message.id, message.content, message.from_name)
    } catch { /* FTS 테이블 없으면 무시 */ }
  }
}
```

`queries.js`에 검색 함수 추가:
```javascript
function searchMessages(db, { query, type, peerId, limit = 50 }) {
  if (!query?.trim()) return []
  // FTS5 검색 (글로벌 메시지)
  try {
    let sql = `
      SELECT m.* FROM messages m
      INNER JOIN messages_fts fts ON m.id = fts.id
      WHERE messages_fts MATCH ?
    `
    const params = [query + '*']
    if (type) {
      sql += ' AND m.type = ?'
      params.push(type)
    }
    sql += ' ORDER BY m.timestamp DESC LIMIT ?'
    params.push(limit)
    return db.prepare(sql).all(...params)
  } catch {
    // FTS5 미지원 시 LIKE 폴백
    let sql = 'SELECT * FROM messages WHERE content LIKE ?'
    const params = [`%${query}%`]
    if (type) {
      sql += ' AND type = ?'
      params.push(type)
    }
    sql += ' ORDER BY timestamp DESC LIMIT ?'
    params.push(limit)
    return db.prepare(sql).all(...params)
  }
}
```

module.exports에 `searchMessages` 추가.

- [ ] **Step 4: 테스트 실행 — 통과 확인**

Run: `npm test -- tests/storage/search.test.js`
Expected: PASS

- [ ] **Step 5: main.js에 검색 IPC 핸들러 추가**

```javascript
ipcMain.handle('search-messages', (_, { query, type, peerId }) => {
  return searchMessages(database, { query, type, peerId })
})
```

- [ ] **Step 6: preload.js에 검색 IPC 브릿지 추가**

```javascript
searchMessages: (params) => ipcRenderer.invoke('search-messages', params),
```

- [ ] **Step 7: useChatStore.js에 검색 상태 추가**

```javascript
// 상태 추가
searchQuery: '',
searchResults: [],
isSearching: false,

// 액션 추가
setSearchQuery: (query) => set({ searchQuery: query }),
setSearchResults: (results) => set({ searchResults: results }),
setIsSearching: (isSearching) => set({ isSearching }),
clearSearch: () => set({ searchQuery: '', searchResults: [], isSearching: false }),
```

resetAll에 `searchQuery: '', searchResults: [], isSearching: false` 추가.

- [ ] **Step 8: ChatWindow.jsx에 검색 UI 추가**

헤더에 검색 토글 버튼:
```jsx
import { ChevronDown, Search, X } from 'lucide-react'

// 상태 추가
const { searchQuery, searchResults, isSearching, setSearchQuery, setSearchResults, setIsSearching, clearSearch } = useChatStore()
const [showSearch, setShowSearch] = useState(false)
const searchInputRef = useRef(null)

async function handleSearch(query) {
  setSearchQuery(query)
  if (!query.trim()) {
    setSearchResults([])
    return
  }
  setIsSearching(true)
  const type = currentRoom.type === 'global' ? 'message' : null
  const results = await window.electronAPI.searchMessages({
    query,
    type,
  })
  setSearchResults(results)
  setIsSearching(false)
}

// 헤더 수정
<div className="px-4 py-2.5 border-b border-vsc-border shrink-0">
  <div className="flex items-center justify-between">
    <h2 className="text-sm font-semibold text-vsc-text">{chatTitle}</h2>
    <button
      onClick={() => {
        setShowSearch(!showSearch)
        if (showSearch) clearSearch()
      }}
      className="p-1 rounded text-vsc-muted hover:text-vsc-text hover:bg-vsc-hover cursor-pointer"
    >
      <Search size={14} />
    </button>
  </div>
  {showSearch && (
    <div className="mt-2 flex items-center gap-2">
      <input
        ref={searchInputRef}
        type="text"
        value={searchQuery}
        onChange={(e) => handleSearch(e.target.value)}
        placeholder="메시지 검색..."
        className="flex-1 bg-vsc-bg border border-vsc-border rounded px-2 py-1 text-xs text-vsc-text placeholder:text-vsc-muted focus:outline-none focus:border-vsc-accent"
        autoFocus
      />
      <span className="text-xs text-vsc-muted">
        {searchResults.length > 0 ? `${searchResults.length}개 결과` : ''}
      </span>
      <button onClick={() => { setShowSearch(false); clearSearch() }} className="text-vsc-muted hover:text-vsc-text cursor-pointer">
        <X size={14} />
      </button>
    </div>
  )}
</div>
```

메시지 목록에서 검색 결과 하이라이트 — 검색어가 있으면 해당 메시지에 하이라이트 CSS 추가:
```jsx
// Message 컴포넌트에 searchQuery prop 전달
<Message
  key={message.id}
  message={message}
  onStartEdit={(msg) => messageInputRef.current?.startEdit(msg)}
  isHighlighted={searchQuery && message.content?.includes(searchQuery)}
/>
```

Message.jsx에서 `isHighlighted` prop 처리:
```jsx
export default function Message({ message, onStartEdit, isHighlighted }) {
  // 최상위 div에 하이라이트 클래스 추가
  className={`... ${isHighlighted ? 'bg-vsc-accent/10 ring-1 ring-vsc-accent/30' : ''}`}
```

- [ ] **Step 9: 기존 테스트 통과 확인**

Run: `npm test`
Expected: 전체 PASS

- [ ] **Step 10: 커밋**

```bash
git add electron/storage/database.js electron/storage/queries.js electron/main.js electron/preload.js src/components/ChatWindow.jsx src/components/Message.jsx src/store/useChatStore.js tests/storage/search.test.js
git commit -m "$(cat <<'EOF'
feat: 메시지 검색 기능 (FTS5)

- SQLite FTS5 전문 검색 (글로벌 메시지)
- 채팅 헤더에 검색 UI, 실시간 결과 카운트
- 검색어 매칭 메시지 하이라이트 표시
- FTS5 미지원 시 LIKE 쿼리 폴백
EOF
)"
```

---

## Task 6: 읽지 않은 메시지 구분선

**Files:**
- Modify: `src/components/ChatWindow.jsx`
- Modify: `src/store/useChatStore.js`

- [ ] **Step 1: useChatStore.js에 lastReadTimestamp 상태 추가**

```javascript
// 상태 추가
lastReadTimestamps: {}, // { peerId | 'global': timestamp }

// 액션 추가
setLastReadTimestamp: (roomKey, timestamp) =>
  set((state) => ({
    lastReadTimestamps: { ...state.lastReadTimestamps, [roomKey]: timestamp },
  })),
```

resetAll에 `lastReadTimestamps: {}` 추가.

- [ ] **Step 2: ChatWindow.jsx에 구분선 렌더링**

```jsx
// DM 진입 useEffect에서 lastReadTimestamp 기록
useEffect(() => {
  if (currentRoom.type === 'dm' && myPeerId) {
    const roomKey = currentRoom.peerId
    // 기존 메시지의 마지막 타임스탬프를 lastRead로 기록 (진입 전 기준)
    const existingMessages = useChatStore.getState().dmMessages[roomKey] || []
    const lastTimestamp = existingMessages.length > 0
      ? existingMessages[existingMessages.length - 1].timestamp
      : Date.now()

    resetUnread(currentRoom.peerId)
    window.electronAPI.getDMHistory(myPeerId, currentRoom.peerId)
      .then(history => {
        // lastRead 기록은 히스토리 로드 전에 설정
        const { lastReadTimestamps } = useChatStore.getState()
        if (!lastReadTimestamps[roomKey]) {
          useChatStore.getState().setLastReadTimestamp(roomKey, lastTimestamp)
        }
        setDMHistory(currentRoom.peerId, history)
      })
    // ... 기존 읽음 확인 로직 ...
  }
}, [currentRoom, myPeerId])

// 방 떠날 때 lastReadTimestamp 업데이트 — 현재 마지막 메시지 시간으로
useEffect(() => {
  return () => {
    const roomKey = currentRoom.type === 'global' ? 'global' : currentRoom.peerId
    if (currentMessages.length > 0) {
      useChatStore.getState().setLastReadTimestamp(
        roomKey,
        currentMessages[currentMessages.length - 1].timestamp
      )
    }
  }
}, [currentRoom])

// 메시지 목록에서 구분선 렌더링
const lastReadTimestamp = useChatStore(state => {
  const roomKey = currentRoom.type === 'global' ? 'global' : currentRoom.peerId
  return state.lastReadTimestamps[roomKey] || 0
})

// 렌더링 부분 수정 — 구분선 삽입
{currentMessages.map((message, index) => {
  const prevMessage = index > 0 ? currentMessages[index - 1] : null
  const showUnreadDivider = lastReadTimestamp > 0
    && prevMessage
    && prevMessage.timestamp <= lastReadTimestamp
    && message.timestamp > lastReadTimestamp
    && (message.fromId || message.from_id) !== myPeerId

  return (
    <React.Fragment key={message.id}>
      {showUnreadDivider && (
        <div className="flex items-center gap-2 px-4 py-1 my-1">
          <div className="flex-1 border-t border-red-400/50" />
          <span className="text-xs text-red-400 font-semibold shrink-0">여기서부터 새 메시지</span>
          <div className="flex-1 border-t border-red-400/50" />
        </div>
      )}
      <Message
        message={message}
        onStartEdit={(msg) => messageInputRef.current?.startEdit(msg)}
        isHighlighted={searchQuery && message.content?.includes(searchQuery)}
      />
    </React.Fragment>
  )
})}
```

- [ ] **Step 3: 앱 실행 확인**

Run: `npm run dev`
Expected: DM 재진입 시 새 메시지가 있으면 빨간 구분선 표시

- [ ] **Step 4: 커밋**

```bash
git add src/components/ChatWindow.jsx src/store/useChatStore.js
git commit -m "$(cat <<'EOF'
feat: 읽지 않은 메시지 구분선

- 채팅방 재진입 시 '여기서부터 새 메시지' 구분선 표시
- lastReadTimestamp로 이전 방문 기준점 추적
- 방 이탈 시 자동 업데이트
EOF
)"
```

---

## Task 7: 상태 메시지 (자리비움/회의중/방해금지)

**Files:**
- Modify: `electron/storage/database.js`
- Modify: `electron/storage/queries.js` (또는 profile.js)
- Modify: `electron/main.js`
- Modify: `electron/preload.js`
- Modify: `src/store/usePeerStore.js`
- Modify: `src/store/useUserStore.js`
- Modify: `src/components/Sidebar.jsx`
- Create: `tests/storage/status.test.js`

- [ ] **Step 1: 상태 메시지 DB 테스트 작성**

```javascript
// tests/storage/status.test.js
const { initDatabase, migrateDatabase, closeDatabase } = require('../../electron/storage/database')
const { getProfile, saveProfile, updateStatus } = require('../../electron/storage/profile')

describe('상태 메시지', () => {
  let db

  beforeEach(() => {
    db = initDatabase(':memory:')
    migrateDatabase(db)
    saveProfile(db, { username: 'test', nickname: '테스트', password: 'pw123' })
  })
  afterEach(() => closeDatabase(db))

  it('상태 메시지를 저장하고 조회함', () => {
    updateStatus(db, { statusType: 'busy', statusMessage: '회의 중' })
    const profile = getProfile(db)
    expect(profile.status_type).toBe('busy')
    expect(profile.status_message).toBe('회의 중')
  })

  it('상태를 online으로 초기화함', () => {
    updateStatus(db, { statusType: 'busy', statusMessage: '회의 중' })
    updateStatus(db, { statusType: 'online', statusMessage: '' })
    const profile = getProfile(db)
    expect(profile.status_type).toBe('online')
    expect(profile.status_message).toBe('')
  })
})
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

Run: `npm test -- tests/storage/status.test.js`
Expected: FAIL

- [ ] **Step 3: DB 마이그레이션 + profile.js에 updateStatus 추가**

`database.js` migrateDatabase — profileMigrations 배열에 추가:
```javascript
"ALTER TABLE profile ADD COLUMN status_type TEXT DEFAULT 'online'",
"ALTER TABLE profile ADD COLUMN status_message TEXT DEFAULT ''",
```

`electron/storage/profile.js`에 추가:
```javascript
function updateStatus(db, { statusType, statusMessage }) {
  db.prepare('UPDATE profile SET status_type = ?, status_message = ? WHERE id = 1')
    .run(statusType, statusMessage || '')
}
```

module.exports에 `updateStatus` 추가.

- [ ] **Step 4: 테스트 실행 — 통과 확인**

Run: `npm test -- tests/storage/status.test.js`
Expected: PASS

- [ ] **Step 5: main.js에 상태 변경 IPC + 브로드캐스트**

ALLOWED_MESSAGE_TYPES에 `'status-changed'` 추가 (Task 1에서 이미 포함).

handleIncomingMessage에 추가:
```javascript
if (message.type === 'status-changed') {
  sendToRenderer('peer-status-changed', {
    peerId: message.fromId,
    statusType: message.statusType,
    statusMessage: message.statusMessage,
  })
  return
}
```

IPC 핸들러:
```javascript
ipcMain.handle('update-status', (_, { statusType, statusMessage }) => {
  const allowedTypes = ['online', 'away', 'busy', 'dnd']
  if (!allowedTypes.includes(statusType)) return
  updateStatus(database, { statusType, statusMessage: (statusMessage || '').slice(0, 100) })
  broadcastMessage({
    type: 'status-changed',
    fromId: currentPeerId,
    statusType,
    statusMessage: statusMessage || '',
    timestamp: Date.now(),
  })
})
```

- [ ] **Step 6: preload.js에 상태 IPC 브릿지 추가**

```javascript
updateStatus: (data) => ipcRenderer.invoke('update-status', data),
onPeerStatusChanged: (callback) => {
  ipcRenderer.removeAllListeners('peer-status-changed')
  ipcRenderer.on('peer-status-changed', (_, data) => callback(data))
},
```

unsubscribeAll에 `ipcRenderer.removeAllListeners('peer-status-changed')` 추가.

- [ ] **Step 7: usePeerStore.js에 상태 필드 추가**

`updatePeer` 액션을 사용하여 statusType, statusMessage를 피어 정보에 포함.

useUserStore.js에 내 상태 추가:
```javascript
// 상태 추가
myStatusType: 'online',
myStatusMessage: '',

// 액션 추가
setMyStatus: (statusType, statusMessage) =>
  set({ myStatusType: statusType, myStatusMessage: statusMessage || '' }),
```

reset에 `myStatusType: 'online', myStatusMessage: ''` 추가.

- [ ] **Step 8: Sidebar.jsx에 상태 아이콘 표시 + 상태 변경 UI**

사이드바 피어 목록의 온라인 dot을 상태별 색상으로 변경:
```jsx
// 상태별 dot 색상
const statusColors = {
  online: 'bg-green-400',
  away: 'bg-yellow-400',
  busy: 'bg-red-400',
  dnd: 'bg-red-600',
}

// 피어 아바타 옆 dot에 적용
<span className={`w-2 h-2 rounded-full ${statusColors[peer.statusType || 'online']}`} />
```

사이드바 하단 또는 프로필 영역에 내 상태 변경 드롭다운:
```jsx
// 내 프로필 영역에 상태 선택기 추가
<select
  value={myStatusType}
  onChange={(e) => {
    const newStatus = e.target.value
    useUserStore.getState().setMyStatus(newStatus, '')
    window.electronAPI.updateStatus({ statusType: newStatus, statusMessage: '' })
  }}
  className="bg-vsc-bg border border-vsc-border rounded px-1 py-0.5 text-xs text-vsc-text"
>
  <option value="online">온라인</option>
  <option value="away">자리비움</option>
  <option value="busy">바쁨</option>
  <option value="dnd">방해 금지</option>
</select>
```

- [ ] **Step 9: App.jsx에 상태 변경 이벤트 구독**

```javascript
window.electronAPI.onPeerStatusChanged(({ peerId, statusType, statusMessage }) => {
  usePeerStore.getState().updatePeer(peerId, { statusType, statusMessage })
})
```

- [ ] **Step 10: 기존 테스트 통과 확인**

Run: `npm test`
Expected: 전체 PASS

- [ ] **Step 11: 커밋**

```bash
git add electron/storage/database.js electron/storage/profile.js electron/main.js electron/preload.js src/store/usePeerStore.js src/store/useUserStore.js src/components/Sidebar.jsx src/App.jsx tests/storage/status.test.js
git commit -m "$(cat <<'EOF'
feat: 상태 메시지 (온라인/자리비움/바쁨/방해금지)

- 사이드바에서 내 상태 변경 가능
- 피어 상태에 따른 dot 색상 변경 (초록/노랑/빨강)
- 피어 간 실시간 상태 브로드캐스트
EOF
)"
```

---

## Task 8: Replay Attack 방어 + HKDF 솔트 강화

**Files:**
- Modify: `electron/peer/wsServer.js`
- Modify: `electron/crypto/encryption.js`
- Create: `tests/peer/replayAttack.test.js`
- Create: `tests/crypto/hkdf.test.js`

- [ ] **Step 1: Replay Attack 방어 테스트 작성**

```javascript
// tests/peer/replayAttack.test.js
const { startWsServer, stopWsServer } = require('../../electron/peer/wsServer')
const WebSocket = require('ws')

describe('Replay Attack 방어', () => {
  let serverInfo

  afterEach((done) => {
    if (serverInfo) {
      stopWsServer(serverInfo)
      setTimeout(done, 100)
    } else {
      done()
    }
  })

  it('같은 메시지 ID를 중복 전송하면 두 번째는 무시됨', (done) => {
    let receiveCount = 0
    const testMessage = {
      type: 'message', id: 'msg-duplicate', content: '중복 테스트',
      from: '홍길동', fromId: 'peer1', contentType: 'text', timestamp: Date.now(),
    }

    serverInfo = startWsServer({
      onMessage: () => {
        receiveCount++
      },
    })

    const client = new WebSocket(`ws://localhost:${serverInfo.port}`)
    client.on('open', () => {
      client.send(JSON.stringify(testMessage))
      client.send(JSON.stringify(testMessage)) // 같은 ID 재전송
      setTimeout(() => {
        expect(receiveCount).toBe(1)
        client.close()
        done()
      }, 200)
    })
  })
})
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

Run: `npm test -- tests/peer/replayAttack.test.js`
Expected: FAIL — receiveCount가 2

- [ ] **Step 3: wsServer.js에 메시지 ID 중복 검사 추가**

`wsServer.js`의 `startWsServer` 함수 내 `server.on('connection')` 블록에:

```javascript
// Replay Attack 방어 — 최근 메시지 ID 추적
const recentMessageIds = new Set()
const REPLAY_WINDOW_SIZE = 1000

// socket.on('message') 핸들러 내부, JSON 파싱 후:
if (message.id) {
  if (recentMessageIds.has(message.id)) return // 중복 메시지 무시
  recentMessageIds.add(message.id)
  // 윈도우 초과 시 오래된 것 정리
  if (recentMessageIds.size > REPLAY_WINDOW_SIZE) {
    const firstId = recentMessageIds.values().next().value
    recentMessageIds.delete(firstId)
  }
}
```

- [ ] **Step 4: 테스트 실행 — 통과 확인**

Run: `npm test -- tests/peer/replayAttack.test.js`
Expected: PASS

- [ ] **Step 5: HKDF 솔트 강화 테스트 작성**

```javascript
// tests/crypto/hkdf.test.js
const crypto = require('crypto')
const { deriveSharedSecret, encryptDM, decryptDM } = require('../../electron/crypto/encryption')

function generateTestKeyPair() {
  return crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })
}

describe('HKDF 솔트/컨텍스트 강화', () => {
  let aliceKeyPair, bobKeyPair

  beforeEach(() => {
    aliceKeyPair = generateTestKeyPair()
    bobKeyPair = generateTestKeyPair()
  })

  it('peerId 조합 솔트로 암호화/복호화가 정상 동작함', () => {
    const original = { content: '솔트 테스트', contentType: 'text', fileUrl: null, fileName: null }
    const aliceSecret = deriveSharedSecret(aliceKeyPair.privateKey, bobKeyPair.publicKey)

    const ciphertext = encryptDM(original, aliceSecret, 'alice-id', 'bob-id')
    const bobSecret = deriveSharedSecret(bobKeyPair.privateKey, aliceKeyPair.publicKey)
    const decrypted = decryptDM(ciphertext, bobSecret, 'alice-id', 'bob-id')

    expect(decrypted.content).toBe('솔트 테스트')
  })

  it('다른 peerId 조합으로는 복호화 실패', () => {
    const original = { content: '비밀', contentType: 'text', fileUrl: null, fileName: null }
    const aliceSecret = deriveSharedSecret(aliceKeyPair.privateKey, bobKeyPair.publicKey)

    const ciphertext = encryptDM(original, aliceSecret, 'alice-id', 'bob-id')
    const bobSecret = deriveSharedSecret(bobKeyPair.privateKey, aliceKeyPair.publicKey)
    // 다른 peerId 조합
    expect(() => decryptDM(ciphertext, bobSecret, 'wrong-id', 'bob-id')).toThrow()
  })
})
```

- [ ] **Step 6: 테스트 실행 — 실패 확인**

Run: `npm test -- tests/crypto/hkdf.test.js`
Expected: FAIL — encryptDM/decryptDM 시그니처 변경 필요

- [ ] **Step 7: encryption.js HKDF 솔트/컨텍스트 강화**

```javascript
// electron/crypto/encryption.js
const crypto = require('crypto')

function deriveSharedSecret(myPrivateKey, peerPublicKey) {
  return crypto.diffieHellman({
    privateKey: myPrivateKey,
    publicKey: peerPublicKey,
  })
}

function deriveAESKey(sharedSecretBuffer, senderPeerId, recipientPeerId) {
  // peerId 쌍을 정렬하여 양방향 동일 솔트 생성
  const sortedIds = [senderPeerId, recipientPeerId].sort()
  const salt = Buffer.from(sortedIds.join(':'))
  const info = Buffer.from(`lan-chat-dm:${sortedIds[0]}:${sortedIds[1]}`)

  return crypto.hkdfSync(
    'sha256',
    sharedSecretBuffer,
    salt,
    info,
    32
  )
}

function encryptDM(payload, sharedSecretBuffer, senderPeerId, recipientPeerId) {
  // 하위 호환: peerId가 없으면 기존 방식 사용
  const aesKey = Buffer.from(
    senderPeerId && recipientPeerId
      ? deriveAESKey(sharedSecretBuffer, senderPeerId, recipientPeerId)
      : crypto.hkdfSync('sha256', sharedSecretBuffer, Buffer.alloc(0), Buffer.from('lan-chat-dm'), 32)
  )
  const iv = crypto.randomBytes(12)

  const cipher = crypto.createCipheriv('aes-256-gcm', aesKey, iv)
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf-8')

  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const authTag = cipher.getAuthTag()

  return Buffer.concat([iv, ciphertext, authTag]).toString('base64')
}

function decryptDM(base64Ciphertext, sharedSecretBuffer, senderPeerId, recipientPeerId) {
  // 하위 호환: peerId가 없으면 기존 방식 사용
  const aesKey = Buffer.from(
    senderPeerId && recipientPeerId
      ? deriveAESKey(sharedSecretBuffer, senderPeerId, recipientPeerId)
      : crypto.hkdfSync('sha256', sharedSecretBuffer, Buffer.alloc(0), Buffer.from('lan-chat-dm'), 32)
  )
  const fullBuffer = Buffer.from(base64Ciphertext, 'base64')

  const iv = fullBuffer.subarray(0, 12)
  const authTag = fullBuffer.subarray(fullBuffer.length - 16)
  const ciphertext = fullBuffer.subarray(12, fullBuffer.length - 16)

  const decipher = crypto.createDecipheriv('aes-256-gcm', aesKey, iv)
  decipher.setAuthTag(authTag)

  const decryptedBuffer = Buffer.concat([decipher.update(ciphertext), decipher.final()])
  return JSON.parse(decryptedBuffer.toString('utf-8'))
}

module.exports = { deriveSharedSecret, encryptDM, decryptDM }
```

- [ ] **Step 8: main.js의 encryptDM/decryptDM 호출부에 peerId 전달**

`main.js`의 모든 `encryptDM`, `decryptDM` 호출에 peerId 인자 추가:
- `encryptDM(payload, sharedSecret)` → `encryptDM(payload, sharedSecret, peerId, recipientPeerId)`
- `decryptDM(ciphertext, sharedSecret)` → `decryptDM(ciphertext, sharedSecret, message.fromId, peerId)`

하위 호환을 위해 기존 메시지 복호화 시 실패하면 레거시 방식으로 재시도:
```javascript
// get-dm-history 핸들러의 복호화 부분:
try {
  const decryptedPayload = decryptDM(msg.encrypted_payload, sharedSecret, msg.from_id, peerId2)
  // ... 성공 처리 ...
} catch {
  try {
    // 레거시 메시지 (솔트 없는 버전)
    const decryptedPayload = decryptDM(msg.encrypted_payload, sharedSecret)
    // ... 성공 처리 ...
  } catch { /* 복호화 실패 무시 */ }
}
```

- [ ] **Step 9: 테스트 실행 — 전체 통과 확인**

Run: `npm test`
Expected: 전체 PASS (기존 encryption.test.js는 peerId 없이 호출 → 하위 호환으로 통과)

- [ ] **Step 10: 커밋**

```bash
git add electron/peer/wsServer.js electron/crypto/encryption.js electron/main.js tests/peer/replayAttack.test.js tests/crypto/hkdf.test.js
git commit -m "$(cat <<'EOF'
fix: Replay Attack 방어 + HKDF 솔트/컨텍스트 강화

- 메시지 ID 중복 검사로 재전송 공격 차단 (윈도우 1000개)
- HKDF에 peerId 조합 솔트 + 컨텍스트 추가
- 기존 메시지 하위 호환 (레거시 폴백)
EOF
)"
```

---

## Task 9: 파일 영구 캐시

**Files:**
- Modify: `electron/storage/database.js`
- Modify: `electron/storage/queries.js`
- Modify: `electron/main.js`
- Modify: `electron/preload.js`
- Modify: `src/components/Message.jsx`
- Create: `tests/storage/fileCache.test.js`

- [ ] **Step 1: 파일 캐시 쿼리 테스트 작성**

```javascript
// tests/storage/fileCache.test.js
const { initDatabase, migrateDatabase, closeDatabase } = require('../../electron/storage/database')
const { saveMessage, saveFileCache, getFileCache } = require('../../electron/storage/queries')

describe('파일 영구 캐시', () => {
  let db

  beforeEach(() => {
    db = initDatabase(':memory:')
    migrateDatabase(db)
    saveMessage(db, {
      id: 'msg-file', type: 'message', from_id: 'peer1', from_name: '홍길동',
      to_id: null, content: null, content_type: 'image',
      encrypted_payload: null, file_url: 'http://peer1:3000/files/test.jpg',
      file_name: 'test.jpg', timestamp: Date.now(),
    })
  })
  afterEach(() => closeDatabase(db))

  it('파일 캐시 경로를 저장하고 조회함', () => {
    saveFileCache(db, { messageId: 'msg-file', cachedPath: '/cache/test.jpg' })
    const cached = getFileCache(db, 'msg-file')
    expect(cached).toBe('/cache/test.jpg')
  })

  it('캐시가 없으면 null 반환', () => {
    const cached = getFileCache(db, 'msg-nonexistent')
    expect(cached).toBeNull()
  })
})
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

Run: `npm test -- tests/storage/fileCache.test.js`
Expected: FAIL

- [ ] **Step 3: DB 마이그레이션 + 캐시 쿼리 구현**

`database.js` migrateDatabase — messagesMigrations 배열에 추가:
```javascript
'ALTER TABLE messages ADD COLUMN cached_file_path TEXT',
```

`queries.js`에 추가:
```javascript
function saveFileCache(db, { messageId, cachedPath }) {
  db.prepare('UPDATE messages SET cached_file_path = ? WHERE id = ?')
    .run(cachedPath, messageId)
}

function getFileCache(db, messageId) {
  const row = db.prepare('SELECT cached_file_path FROM messages WHERE id = ?').get(messageId)
  return row?.cached_file_path || null
}
```

module.exports에 `saveFileCache, getFileCache` 추가.

- [ ] **Step 4: 테스트 실행 — 통과 확인**

Run: `npm test -- tests/storage/fileCache.test.js`
Expected: PASS

- [ ] **Step 5: main.js에 파일 캐시 로직 추가**

파일 수신 시 자동 캐시 — handleIncomingMessage의 전체채팅/DM 메시지 처리 후:

```javascript
// 파일 수신 시 자동 캐시
function cacheReceivedFile(messageId, fileUrl, fileName) {
  if (!fileUrl || !fileName) return
  const cacheDir = path.join(appDataPath, 'file_cache')
  if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true })

  const ext = path.extname(fileName)
  const cachedFileName = `${messageId}${ext}`
  const cachedPath = path.join(cacheDir, cachedFileName)

  // 비동기 다운로드
  const http = require('http')
  const file = fs.createWriteStream(cachedPath)
  http.get(fileUrl, (response) => {
    response.pipe(file)
    file.on('finish', () => {
      file.close()
      try {
        saveFileCache(database, { messageId, cachedPath })
      } catch { /* 무시 */ }
    })
  }).on('error', () => {
    try { fs.unlinkSync(cachedPath) } catch { /* 무시 */ }
  })
}
```

전체채팅 메시지 수신 후(라인 396 부근) 및 DM 복호화 후(라인 366 부근):
```javascript
// 파일 메시지면 캐시
if (message.fileUrl || decryptedPayload?.fileUrl) {
  cacheReceivedFile(message.id, message.fileUrl || decryptedPayload.fileUrl, message.fileName || decryptedPayload.fileName)
}
```

IPC 핸들러 — 캐시된 파일 URL 조회:
```javascript
ipcMain.handle('get-cached-file-url', (_, messageId) => {
  const cachedPath = getFileCache(database, messageId)
  if (cachedPath && fs.existsSync(cachedPath)) {
    return `file://${cachedPath}`
  }
  return null
})
```

- [ ] **Step 6: preload.js에 캐시 IPC 브릿지 추가**

```javascript
getCachedFileUrl: (messageId) => ipcRenderer.invoke('get-cached-file-url', messageId),
```

- [ ] **Step 7: Message.jsx에서 캐시된 파일 폴백**

이미지/비디오/파일 렌더링 시 원본 URL 로드 실패하면 캐시된 URL로 폴백:

```jsx
// Message.jsx 상태 추가
const [resolvedFileUrl, setResolvedFileUrl] = useState(fileUrl)

// URL 폴백 로직
useEffect(() => {
  setResolvedFileUrl(fileUrl)
}, [fileUrl])

async function handleFileError() {
  // 원본 URL 실패 시 캐시된 URL로 폴백
  const cachedUrl = await window.electronAPI.getCachedFileUrl(message.id)
  if (cachedUrl) {
    setResolvedFileUrl(cachedUrl)
  }
}

// 이미지 onError:
onError={(event) => {
  if (resolvedFileUrl === fileUrl) {
    handleFileError()
  } else {
    event.target.style.display = 'none'
  }
}}

// fileUrl 대신 resolvedFileUrl 사용
```

- [ ] **Step 8: 기존 테스트 통과 확인**

Run: `npm test`
Expected: 전체 PASS

- [ ] **Step 9: 커밋**

```bash
git add electron/storage/database.js electron/storage/queries.js electron/main.js electron/preload.js src/components/Message.jsx tests/storage/fileCache.test.js
git commit -m "$(cat <<'EOF'
feat: 파일 영구 캐시

- 수신 파일을 로컬 file_cache 폴더에 자동 캐싱
- 원본 URL 접근 불가 시 캐시된 파일로 자동 폴백
- DB에 cached_file_path 저장하여 재시작 후에도 유지
EOF
)"
```

---

## 최종 확인

- [ ] **전체 테스트 통과**

Run: `npm test`
Expected: 전체 PASS

- [ ] **앱 실행 확인**

Run: `npm run dev`
Expected: 모든 9개 기능이 정상 동작

---

## 의존성 그래프

```
Task 1 (Heartbeat+재연결) ─── 독립
Task 2 (드래그앤드롭)     ─── 독립
Task 3 (이모지 리액션)    ─── 독립
Task 4 (메시지 수정)      ─── Task 2 이후 (MessageInput forwardRef 공유)
Task 5 (메시지 검색)      ─── 독립
Task 6 (읽지않은 구분선)   ─── 독립
Task 7 (상태 메시지)      ─── 독립
Task 8 (보안 강화)        ─── 독립
Task 9 (파일 캐시)        ─── 독립
```

병렬 실행 가능: Task 1, 2, 3, 5, 6, 7, 8, 9
순서 의존: Task 4는 Task 2 이후
