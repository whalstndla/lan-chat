// Phase 4: 성능 계측 유틸.
// LAN_CHAT_PERF=1 환경 변수가 설정되면 활성화.
// 타이머, 메모리 사용량, 느린 쿼리를 peerDebugLog 또는 stderr 로 기록.

const { writePeerDebugLog } = require('./peerDebugLogger')

const perfEnabled = process.env.LAN_CHAT_PERF === '1'
const slowQueryThresholdMs = Number(process.env.LAN_CHAT_PERF_SLOW_QUERY_MS || 10)

// 간단한 타이머 — key 로 start, 같은 key 로 end 호출.
const activeTimers = new Map()

function startTimer(key) {
  if (!perfEnabled) return
  activeTimers.set(key, process.hrtime.bigint())
}

function endTimer(key, extraData = {}) {
  if (!perfEnabled) return null
  const start = activeTimers.get(key)
  if (!start) return null
  activeTimers.delete(key)
  const elapsedNs = Number(process.hrtime.bigint() - start)
  const elapsedMs = elapsedNs / 1_000_000
  writePeerDebugLog('perf.timer', { key, elapsedMs, ...extraData })
  return elapsedMs
}

// 함수 래퍼 — async 함수의 실행 시간을 자동 측정.
function measureAsync(key, fn) {
  return async (...args) => {
    if (!perfEnabled) return fn(...args)
    const start = process.hrtime.bigint()
    try {
      return await fn(...args)
    } finally {
      const elapsedMs = Number(process.hrtime.bigint() - start) / 1_000_000
      writePeerDebugLog('perf.measureAsync', { key, elapsedMs })
    }
  }
}

// better-sqlite3 쿼리 래핑 — 느린 쿼리만 기록.
function measureQuery(key, fn) {
  return (...args) => {
    if (!perfEnabled) return fn(...args)
    const start = process.hrtime.bigint()
    try {
      return fn(...args)
    } finally {
      const elapsedMs = Number(process.hrtime.bigint() - start) / 1_000_000
      if (elapsedMs >= slowQueryThresholdMs) {
        writePeerDebugLog('perf.slowQuery', { key, elapsedMs })
      }
    }
  }
}

// 주기적 메모리 사용량 로깅 — 앱 시작 시 한 번만 호출.
let memoryIntervalHandle = null
function startMemoryMonitor(intervalMs = 300_000) { // 5분
  if (!perfEnabled) return
  if (memoryIntervalHandle) clearInterval(memoryIntervalHandle)
  memoryIntervalHandle = setInterval(() => {
    const usage = process.memoryUsage()
    writePeerDebugLog('perf.memory', {
      rssMB: Math.round(usage.rss / 1024 / 1024),
      heapUsedMB: Math.round(usage.heapUsed / 1024 / 1024),
      externalMB: Math.round(usage.external / 1024 / 1024),
    })
  }, intervalMs)
  if (memoryIntervalHandle.unref) memoryIntervalHandle.unref()
}

function stopMemoryMonitor() {
  if (memoryIntervalHandle) {
    clearInterval(memoryIntervalHandle)
    memoryIntervalHandle = null
  }
}

module.exports = {
  perfEnabled,
  startTimer,
  endTimer,
  measureAsync,
  measureQuery,
  startMemoryMonitor,
  stopMemoryMonitor,
}
