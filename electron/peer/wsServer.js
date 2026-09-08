// electron/peer/wsServer.js
const { WebSocketServer, WebSocket } = require('ws')
const { writePeerDebugLog } = require('../utils/peerDebugLogger')

// 허용되는 메시지 타입 화이트리스트 — 핸드셰이크는 v2 'hello' (wire v2)만 허용한다.
// v1 'key-exchange' 는 제거됨(#69) — 목록에 없어 wsServer 진입 시점에 drop 되므로
// 무검증 v1 수용(다운그레이드 공격면)이 사라진다. v1 전용 구버전(≤v0.7.x)과는 연결 단절.
// #31: 'history-sync-request'/'history-sync-response' 추가 (additive — 구버전은 이 목록에
// 없어 drop = graceful degradation, WIRE_VERSION 불변).
const ALLOWED_MESSAGE_TYPES = [
  'hello', 'typing', 'typing-stop', 'delete-message', 'nickname-changed',
  'read-receipt', 'message', 'dm', 'reaction', 'edit-message', 'status-changed',
  'file-request', 'file-data', 'file-request-error',
  // 청크 스트리밍 전송 (#44/#45/#49) — additive. 구버전은 이 목록에 없어 drop = 레거시 폴백.
  'file-chunk-start', 'file-chunk', 'file-chunk-end', 'file-cancel',
  'history-sync-request', 'history-sync-response',
  'lanpet',
]

// 청크 스트림은 유한(전송당 totalChunks 개)하고 프레임당 maxPayload 로 이미 제한되며,
// 수신측 totalBytes 상한/동시 transfer 상한으로 자원이 방어된다. 따라서 초당 메시지 캡에서
// 제외해 대용량 파일이 rate limiter 에 의해 청크가 조용히 드롭(→전송 깨짐)되지 않게 한다.
const RATE_LIMIT_EXEMPT_TYPES = new Set(['file-chunk-start', 'file-chunk', 'file-chunk-end'])

// IP별 연결 수 추적 (DoS 방지)
const connectionCountByIP = new Map()
const MAX_CONNECTIONS_PER_IP = 20
const MAX_MESSAGES_PER_SECOND = 50

// WebSocket 단일 메시지 최대 크기.
// 10MB(v0.10.x 이전) 는 대부분 사진/스크린샷·모든 동영상 file-data 가 초과 → ws 라이브러리가
// 메시지가 아니라 연결 자체를 끊어버려 수신측이 영원히 "이미지 불러오기 실패" 상태에 빠짐.
// 200MB 까지 허용하면 base64 오버헤드(1.33x) 고려 시 raw 약 150MB 파일까지 단발 전송 가능.
// 그 이상은 sender 측에서 사전 차단 (MAX_RAW_FILE_BYTES, save-file IPC).
const MAX_PAYLOAD_BYTES = 200 * 1024 * 1024

// 기본 heartbeat 주기 (ms)
const DEFAULT_HEARTBEAT_INTERVAL = 10000

// 재시작 후에도 같은 포트를 사용하기 위한 고정 포트 범위
// — 포트가 바뀌면 상대방 autoReconnect가 실패하므로 고정 범위 우선 시도
// — 범위 내 모든 포트가 사용 중이면 랜덤 포트로 폴백
const LAN_CHAT_PORT_RANGE_START = 49152
const LAN_CHAT_PORT_RANGE_END = 49161   // 49152~49161, 총 10개

function startWsServer({ onMessage, heartbeatInterval = DEFAULT_HEARTBEAT_INTERVAL }) {
  return new Promise((resolve, reject) => {
    const portCandidates = []
    for (let p = LAN_CHAT_PORT_RANGE_START; p <= LAN_CHAT_PORT_RANGE_END; p++) {
      portCandidates.push(p)
    }
    portCandidates.push(0) // 마지막 폴백: 랜덤 포트

    const attemptBind = (candidateIndex) => {
      const port = portCandidates[candidateIndex]
      const server = new WebSocketServer({ port, maxPayload: MAX_PAYLOAD_BYTES })
      server._peerSocketMap = new Map()

      const onBindError = (err) => {
        if (err.code === 'EADDRINUSE' && candidateIndex < portCandidates.length - 1) {
          // 현재 포트 사용 중 → 다음 후보 포트 시도
          writePeerDebugLog('wsServer.portBusy', { port, nextCandidate: portCandidates[candidateIndex + 1] })
          server.close()
          attemptBind(candidateIndex + 1)
        } else {
          reject(err)
        }
      }

      server.once('error', onBindError)
      server.once('listening', () => {
        server.off('error', onBindError)

        server.on('connection', (socket, req) => {
          // IP별 연결 수 제한
          const clientIP = req.socket.remoteAddress || 'unknown'
          writePeerDebugLog('wsServer.connection.accepted', { clientIP })
          const currentCount = connectionCountByIP.get(clientIP) || 0
          if (currentCount >= MAX_CONNECTIONS_PER_IP) {
            socket.close(1008, 'Too many connections')
            return
          }
          connectionCountByIP.set(clientIP, currentCount + 1)
          socket._peerId = null
          socket.on('close', () => {
            const count = connectionCountByIP.get(clientIP) || 1
            if (count <= 1) connectionCountByIP.delete(clientIP)
            else connectionCountByIP.set(clientIP, count - 1)
            if (socket._peerId && server._peerSocketMap.get(socket._peerId) === socket) {
              server._peerSocketMap.delete(socket._peerId)
            }
            writePeerDebugLog('wsServer.connection.closed', {
              clientIP,
              peerId: socket._peerId,
            })
          })

          // heartbeat 생존 여부 플래그 — pong 수신 시 true로 갱신
          socket.isAlive = true
          socket.on('pong', () => {
            socket.isAlive = true
          })

          // 메시지 빈도 제한 (초당 MAX_MESSAGES_PER_SECOND개)
          let messageCount = 0
          let lastResetTime = Date.now()

          // 소켓 에러를 개별 처리 — 없으면 uncaughtException 으로 번짐.
          // maxPayload 초과 (ws code 1009 "message too big") 가 가장 흔한 케이스 — 그 경우
          // ws 라이브러리가 연결을 끊으므로 파일 송수신 실패가 영구화될 수 있다. 진단 가능하도록 로깅.
          socket.on('error', (err) => {
            writePeerDebugLog('wsServer.socket.error', {
              clientIP,
              peerId: socket._peerId,
              code: err?.code || null,
              message: err?.message || null,
            })
          })

          socket.on('message', (data) => {
            let message
            try {
              message = JSON.parse(data.toString())
            } catch {
              // 잘못된 JSON 무시
              return
            }
            // 알 수 없는 메시지 타입은 무시 (fallthrough 방지)
            if (!ALLOWED_MESSAGE_TYPES.includes(message.type)) return
            // 암호문 base64 오버헤드를 포함한 펫 메시지 상한을 복호화 전에 제한한다.
            if (message.type === 'lanpet' && data.length > 23000) return

            // 메시지 빈도 체크 — 청크 스트림 타입은 캡에서 제외(유한 + maxPayload/버퍼 상한으로 방어).
            // 그 외 타입만 초당 카운트해 초과 시 드롭한다.
            if (!RATE_LIMIT_EXEMPT_TYPES.has(message.type)) {
              const now = Date.now()
              if (now - lastResetTime >= 1000) { messageCount = 0; lastResetTime = now }
              messageCount++
              if (messageCount > MAX_MESSAGES_PER_SECOND) return // 초과 시 무시
            }

            try {
              // 동일 ID 메시지 재수신(replay/재전송) 차단은 wsServer/wsClient 공용 진입점인
              // messageHandler.js 의 handleIncomingMessage 로 이동했다(#57). 여기서는 판정하지 않는다.

              // 메시지에서 fromId가 있으면 소켓에 peerId 태깅 (서버 inbound 피어 추적용)
              if (message.fromId) {
                if (socket._peerId && socket._peerId !== message.fromId) {
                  socket.close(1008, 'Peer identity changed')
                  return
                }
                if (!socket._peerId) {
                  socket._peerId = message.fromId
                }
                server._peerSocketMap.set(message.fromId, socket)
                writePeerDebugLog('wsServer.connection.taggedPeer', {
                  clientIP,
                  peerId: message.fromId,
                  messageType: message.type,
                })
              }

              const reply = (response) => {
                if (socket.readyState === socket.OPEN) {
                  writePeerDebugLog('wsServer.reply.sent', {
                    clientIP,
                    peerId: socket._peerId,
                    messageType: response?.type,
                    messageId: response?.id || null,
                  })
                  socket.send(JSON.stringify(response))
                  return true
                }
                return false
              }
              writePeerDebugLog('wsServer.message.received', {
                clientIP,
                peerId: socket._peerId,
                messageType: message.type,
                messageId: message.id || null,
                fromId: message.fromId || null,
              })
              onMessage(message, reply)
            } catch {
              // 처리 중 예외 무시 (개별 핸들러 오류가 소켓 전체를 죽이지 않도록)
            }
          })
        })

        // heartbeat 인터벌 — 응답 없는 클라이언트 감지 후 종료
        const heartbeatTimer = setInterval(() => {
          server.clients.forEach((socket) => {
            if (socket.isAlive === false) {
              // 이전 ping에 pong 응답 없음 → 좀비 연결 강제 종료
              socket.terminate()
              return
            }
            // 다음 interval까지 응답 대기 상태로 설정 후 ping 전송
            socket.isAlive = false
            socket.ping()
          })
        }, heartbeatInterval)

        // Jest가 타이머를 잡아두지 않도록 unref 처리
        if (heartbeatTimer.unref) heartbeatTimer.unref()

        // 서버 종료 시 heartbeat 인터벌 정리
        server.on('close', () => {
          clearInterval(heartbeatTimer)
        })

        const actualPort = server.address().port
        writePeerDebugLog('wsServer.started', { actualPort, portRangeStart: LAN_CHAT_PORT_RANGE_START, portRangeEnd: LAN_CHAT_PORT_RANGE_END, heartbeatInterval })
        resolve({ server, port: actualPort })
      })
    }

    attemptBind(0)
  })
}

function stopWsServer({ server }) {
  writePeerDebugLog('wsServer.stopped', { port: server.address()?.port || null })
  server.close()
}

// 서버에 연결된 모든 클라이언트 소켓 즉시 종료 (새로고침/재로그인 시 좀비 소켓 정리용)
// terminate()는 graceful close 없이 즉시 TCP 연결을 끊어 상대방 close 이벤트를 빠르게 발생시킴
function closeAllServerClients({ server }) {
  writePeerDebugLog('wsServer.closeAllClients', {
    peerIds: getServerClientPeerIds({ server }),
  })
  server.clients.forEach((socket) => socket.terminate())
}

// 서버에 연결된 inbound 피어 ID 목록 반환 (OPEN 상태 + peerId 태깅된 소켓만)
function getServerClientPeerIds({ server }) {
  return [...server._peerSocketMap.entries()]
    .filter(([, socket]) => socket.readyState === WebSocket.OPEN)
    .map(([peerId]) => peerId)
}

function sendMessageToServerPeer({ server }, peerId, messageObj) {
  const socket = server?._peerSocketMap?.get(peerId)
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    writePeerDebugLog('wsServer.send.skipped', {
      peerId,
      messageType: messageObj?.type,
      messageId: messageObj?.id || null,
      hasSocket: !!socket,
      readyState: socket?.readyState ?? null,
    })
    return false
  }
  writePeerDebugLog('wsServer.send.sent', {
    peerId,
    messageType: messageObj?.type,
    messageId: messageObj?.id || null,
  })
  socket.send(JSON.stringify(messageObj))
  return true
}

module.exports = {
  startWsServer,
  stopWsServer,
  closeAllServerClients,
  getServerClientPeerIds,
  sendMessageToServerPeer,
  MAX_PAYLOAD_BYTES,
}
