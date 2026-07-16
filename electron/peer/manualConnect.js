// electron/peer/manualConnect.js
// 수동 IP 입력 피어 연결(#33) — mDNS/UDP 브로드캐스트 발견이 둘 다 막힌 망
// (기업 AP isolation + 멀티캐스트 필터)에서, 발견 없이 host:port 만으로 최초
// 핸드셰이크를 개시하는 진입점.
//
// 설계 핵심: 아직 상대 peerId 를 모르므로 wsClient.connectToPeer 의 connectionMap
// (peerId 를 키로 사용) 을 임시 값으로 오염시키지 않는다. 대신 이 모듈이 직접
// 1회성 "probe" WebSocket 을 열어 hello(v2) 페이로드만 보내고 응답을 기다린다.
// 응답(v2 hello)이 도착하면 그 메시지를 기존 ctx.state.handleIncomingMessage 로
// 그대로 전달한다 — 이후 처리는 electron/peer/inbound/handlers/hello.js 의 기존
// "역방향 연결" 로직이 실제 peerId 로 정식 연결(autoReconnect 포함)을 자동으로
// 맺어준다. probe 소켓은 응답을 받는 즉시 폐기하므로 connectionMap 오염이 없다.

const WebSocket = require('ws')
const { MAX_PAYLOAD_BYTES } = require('./wsServer')
const { writePeerDebugLog } = require('../utils/peerDebugLogger')

// wsServer.js 와 동일한 고정 포트 범위 — wsPort 미지정 시 순차 시도
const MANUAL_CONNECT_PORT_RANGE_START = 49152
const MANUAL_CONNECT_PORT_RANGE_END = 49161

// WebSocket 핸드셰이크(open) 대기 한도 — 대부분의 실패(포트 미사용 등)는 즉시
// ECONNREFUSED 로 끝나므로 실사용 지연은 훨씬 짧다.
const PROBE_OPEN_TIMEOUT_MS = 3000
// open 이후 상대방의 hello 응답 대기 한도
const PROBE_REPLY_TIMEOUT_MS = 5000

// host:wsPort 하나에 대한 1회성 probe. hello 페이로드 전송 후 상대 응답
// (type: 'hello') 수신 시 resolve, 그 외에는 reject(Error)
function probeOnce({ host, wsPort, buildHelloPayload, onReply }) {
  return new Promise((resolve, reject) => {
    let settled = false
    let socket
    try {
      socket = new WebSocket(`ws://${host}:${wsPort}`, { maxPayload: MAX_PAYLOAD_BYTES })
    } catch (error) {
      reject(error)
      return
    }

    let replyTimeoutHandle = null

    const finish = (fn, arg) => {
      if (settled) return
      settled = true
      clearTimeout(openTimeoutHandle)
      if (replyTimeoutHandle) clearTimeout(replyTimeoutHandle)
      try { socket.terminate() } catch { /* 이미 종료된 소켓 */ }
      fn(arg)
    }

    const openTimeoutHandle = setTimeout(() => {
      writePeerDebugLog('manualConnect.probe.openTimeout', { host, wsPort })
      finish(reject, new Error('연결 시간 초과'))
    }, PROBE_OPEN_TIMEOUT_MS)
    if (openTimeoutHandle.unref) openTimeoutHandle.unref()

    socket.on('open', () => {
      if (settled) return
      writePeerDebugLog('manualConnect.probe.open', { host, wsPort })
      socket.send(JSON.stringify(buildHelloPayload()))

      replyTimeoutHandle = setTimeout(() => {
        writePeerDebugLog('manualConnect.probe.replyTimeout', { host, wsPort })
        finish(reject, new Error('상대방 응답이 없습니다'))
      }, PROBE_REPLY_TIMEOUT_MS)
      if (replyTimeoutHandle.unref) replyTimeoutHandle.unref()
    })

    socket.on('message', (data) => {
      if (settled) return
      let message
      try {
        message = JSON.parse(data.toString())
      } catch {
        return // 잘못된 JSON 무시
      }
      // v2 hello 만 핸드셰이크 응답으로 인정(#69) — v1 key-exchange 는 더 이상 수용하지 않는다.
      // 그 외 타입은 무시하고 계속 대기.
      if (message.type !== 'hello') return
      writePeerDebugLog('manualConnect.probe.reply', {
        host, wsPort, messageType: message.type, fromId: message.fromId || null,
      })
      // 기존 hello 인바운드 핸들러로 위임 — 실제 peerId 로 세션 확정 +
      // 역방향 연결(autoReconnect)이 이 호출 안에서 시작된다.
      onReply(message)
      finish(resolve, undefined)
    })

    socket.on('error', (error) => {
      writePeerDebugLog('manualConnect.probe.error', { host, wsPort, error: error?.message })
      finish(reject, error)
    })

    socket.on('close', () => {
      finish(reject, new Error('연결이 종료되었습니다'))
    })
  })
}

// host 유효성 검사 — 공백 제거 후 빈 문자열이면 실패
function normalizeHost(host) {
  if (typeof host !== 'string') return null
  const trimmed = host.trim()
  return trimmed || null
}

// wsPort 유효성 검사 — 미지정(undefined/null/'')이면 null 반환(포트 범위 순차 시도),
// 지정됐지만 유효하지 않은 값이면 Error 를 던진다.
function normalizePort(wsPort) {
  if (wsPort === undefined || wsPort === null || wsPort === '') return null
  const parsed = Number(wsPort)
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    throw new Error('포트 번호가 올바르지 않습니다 (1~65535)')
  }
  return parsed
}

function buildPortCandidates(wsPort) {
  const parsedPort = normalizePort(wsPort)
  if (parsedPort) return [parsedPort]
  const candidates = []
  for (let p = MANUAL_CONNECT_PORT_RANGE_START; p <= MANUAL_CONNECT_PORT_RANGE_END; p++) {
    candidates.push(p)
  }
  return candidates
}

// host(+선택적 wsPort) 로 피어 최초 핸드셰이크 시도.
// - wsPort 미지정 시 고정 포트 범위(49152~49161)를 순차 시도.
// - 성공(핸드셰이크 응답 수신) 시 { ok: true }, 실패 시 { ok: false, error }.
async function connectManualPeer({ host, wsPort, buildHelloPayload, onReply }) {
  const normalizedHost = normalizeHost(host)
  if (!normalizedHost) {
    return { ok: false, error: '호스트를 입력하세요' }
  }

  let portCandidates
  try {
    portCandidates = buildPortCandidates(wsPort)
  } catch (error) {
    return { ok: false, error: error.message }
  }

  let lastError = null
  for (const candidatePort of portCandidates) {
    try {
      await probeOnce({ host: normalizedHost, wsPort: candidatePort, buildHelloPayload, onReply })
      writePeerDebugLog('manualConnect.connect.success', { host: normalizedHost, wsPort: candidatePort })
      return { ok: true }
    } catch (error) {
      lastError = error
    }
  }

  writePeerDebugLog('manualConnect.connect.failed', {
    host: normalizedHost, portCandidates, error: lastError?.message,
  })
  return { ok: false, error: lastError?.message || '연결 실패' }
}

module.exports = {
  connectManualPeer,
  MANUAL_CONNECT_PORT_RANGE_START,
  MANUAL_CONNECT_PORT_RANGE_END,
}
