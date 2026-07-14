const fs = require('fs')
const path = require('path')

function isPeerDebugEnabled() {
  return process.env.LAN_CHAT_DEBUG_PEER === '1'
}

function getPeerDebugLogPath() {
  return process.env.LAN_CHAT_DEBUG_LOG_PATH || path.resolve(process.cwd(), 'logs', 'peer-debug.log')
}

function ensurePeerDebugLogFile() {
  if (!isPeerDebugEnabled()) return false
  const peerDebugLogPath = getPeerDebugLogPath()
  const logDirectoryPath = path.dirname(peerDebugLogPath)
  if (!fs.existsSync(logDirectoryPath)) {
    fs.mkdirSync(logDirectoryPath, { recursive: true })
  }
  if (!fs.existsSync(peerDebugLogPath)) {
    fs.writeFileSync(peerDebugLogPath, '')
  }
  return true
}

// IPv4 주소를 부분 마스킹 — 뒤 두 옥텟을 가려 LAN 대역 유추는 가능하되 정확한
// 호스트는 노출하지 않는다 (예: 192.168.1.23 -> 192.168.*.*).
function maskIpAddress(value) {
  const ipv4Pattern = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/
  const match = value.match(ipv4Pattern)
  if (!match) return value
  return `${match[1]}.${match[2]}.*.*`
}

// 닉네임 부분 마스킹 — 첫/마지막 글자만 남기고 중간을 가린다.
function maskNickname(value) {
  if (value.length === 0) return value
  if (value.length <= 2) return `${value[0]}*`
  return `${value[0]}${'*'.repeat(value.length - 2)}${value[value.length - 1]}`
}

// 닉네임이 담길 가능성이 있는 키 이름 (소문자 비교) — 이 키 아래의 문자열 값만
// 닉네임으로 간주해 마스킹한다. IP 는 값 자체가 IPv4 패턴이면 키와 무관하게 마스킹.
const NICKNAME_LIKE_KEYS = new Set(['nickname', 'from', 'from_name', 'fromname', 'currentnickname'])

function maskSensitiveString(value, keyHint) {
  const ipMasked = maskIpAddress(value)
  if (ipMasked !== value) return ipMasked
  if (keyHint && NICKNAME_LIKE_KEYS.has(keyHint.toLowerCase())) return maskNickname(value)
  return value
}

// 로그에 남길 값 직렬화 — 릴리즈 진단용으로 IP/닉네임을 부분 마스킹한다(#26).
// keyHint 는 바로 위 계층의 프로퍼티 이름으로, 배열 원소에도 부모 키 이름이 그대로
// 전달되어 예를 들어 addresses: ["192.168.0.2"] 같은 배열의 원소도 마스킹 대상이 된다.
function serializeLogValue(value, seen = new WeakSet(), keyHint = null) {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
      code: value.code,
    }
  }
  if (value === null || value === undefined) return value
  if (typeof value === 'function') return `[Function ${value.name || 'anonymous'}]`
  if (typeof value === 'string') return maskSensitiveString(value, keyHint)
  if (typeof value !== 'object') return value
  if (seen.has(value)) return '[Circular]'
  seen.add(value)
  if (Array.isArray(value)) {
    return value.map(item => serializeLogValue(item, seen, keyHint))
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, serializeLogValue(item, seen, key)])
  )
}

// 로그 파일 크기 상한 — 초과 시 회전 (10MB x 현재+2개 = 최대 3개 파일).
const MAX_LOG_BYTES = 10 * 1024 * 1024
const MAX_ROTATED_FILES = 2

function rotateLogIfNeeded(peerDebugLogPath) {
  let stat
  try { stat = fs.statSync(peerDebugLogPath) } catch { return }
  if (stat.size < MAX_LOG_BYTES) return
  // 가장 오래된 파일 삭제 → 한 칸씩 밀기 → 현재 로그를 .1 로 이동 (새 로그는 flush 가
  // fs.appendFile 로 다시 생성).
  try { fs.rmSync(`${peerDebugLogPath}.${MAX_ROTATED_FILES}`, { force: true }) } catch { /* 무시 */ }
  for (let index = MAX_ROTATED_FILES - 1; index >= 1; index--) {
    const src = `${peerDebugLogPath}.${index}`
    const dest = `${peerDebugLogPath}.${index + 1}`
    try { if (fs.existsSync(src)) fs.renameSync(src, dest) } catch { /* 회전 실패는 무시 — 다음 flush 에서 재시도 */ }
  }
  try { fs.renameSync(peerDebugLogPath, `${peerDebugLogPath}.1`) } catch { /* 무시 */ }
}

// 배치 flush 주기 — 메시지마다 동기 I/O 하지 않도록 짧게 모았다가 한 번에 기록한다.
const FLUSH_INTERVAL_MS = 200
// 대기열이 너무 커지기 전에 강제로 flush (메모리 사용량 방지).
const MAX_QUEUE_LENGTH = 200

let pendingLines = []
let flushTimer = null
// 이전 flush 가 끝나기 전에 다음 flush 가 겹쳐 실행되지 않도록 직렬화하는 체인.
let flushChain = Promise.resolve()

function flushPendingLinesAsync() {
  if (pendingLines.length === 0) return Promise.resolve()
  const linesToWrite = pendingLines
  pendingLines = []
  const peerDebugLogPath = getPeerDebugLogPath()
  rotateLogIfNeeded(peerDebugLogPath)
  return new Promise((resolve) => {
    fs.appendFile(peerDebugLogPath, linesToWrite.join(''), () => {
      // 쓰기 실패해도 로거 자체가 죽지 않도록 조용히 무시 — 디버그 로그 유실은
      // 치명적이지 않다 (다음 flush 에서 이후 로그는 계속 기록 시도).
      resolve()
    })
  })
}

function scheduleFlush() {
  if (flushTimer) return
  flushTimer = setTimeout(() => {
    flushTimer = null
    flushChain = flushChain.then(flushPendingLinesAsync)
  }, FLUSH_INTERVAL_MS)
  if (flushTimer.unref) flushTimer.unref()
}

function writePeerDebugLog(eventName, details = {}) {
  if (!ensurePeerDebugLogFile()) return
  const logLine = JSON.stringify({
    timestamp: new Date().toISOString(),
    pid: process.pid,
    event: eventName,
    details: serializeLogValue(details),
  })
  pendingLines.push(`${logLine}\n`)

  if (pendingLines.length >= MAX_QUEUE_LENGTH) {
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null }
    flushChain = flushChain.then(flushPendingLinesAsync)
  } else {
    scheduleFlush()
  }
}

// 대기 중인 로그를 즉시 디스크에 기록 — 테스트 또는 앱 종료 직전 유실 방지용.
async function flushPeerDebugLogNow() {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null }
  flushChain = flushChain.then(flushPendingLinesAsync)
  await flushChain
}

function resetPeerDebugLog() {
  if (!ensurePeerDebugLogFile()) return
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null }
  pendingLines = []
  fs.writeFileSync(getPeerDebugLogPath(), '')
}

module.exports = {
  isPeerDebugEnabled,
  writePeerDebugLog,
  resetPeerDebugLog,
  getPeerDebugLogPath,
  flushPeerDebugLogNow,
}
