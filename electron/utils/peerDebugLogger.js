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

function serializeLogValue(value, seen = new WeakSet()) {
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
  if (typeof value !== 'object') return value
  if (seen.has(value)) return '[Circular]'
  seen.add(value)
  if (Array.isArray(value)) {
    return value.map(item => serializeLogValue(item, seen))
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, serializeLogValue(item, seen)])
  )
}

function writePeerDebugLog(eventName, details = {}) {
  if (!ensurePeerDebugLogFile()) return
  const peerDebugLogPath = getPeerDebugLogPath()
  const logLine = JSON.stringify({
    timestamp: new Date().toISOString(),
    pid: process.pid,
    event: eventName,
    details: serializeLogValue(details),
  })
  fs.appendFileSync(peerDebugLogPath, `${logLine}\n`)
}

function resetPeerDebugLog() {
  if (!ensurePeerDebugLogFile()) return
  fs.writeFileSync(getPeerDebugLogPath(), '')
}

module.exports = {
  isPeerDebugEnabled,
  writePeerDebugLog,
  resetPeerDebugLog,
  getPeerDebugLogPath,
}
