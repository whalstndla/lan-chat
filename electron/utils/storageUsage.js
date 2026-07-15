// electron/utils/storageUsage.js
// 저장소 사용량 계산 순수 로직(#74) — Electron 런타임 의존성 없음(단위 테스트 용이성을 위해 분리).
// chat.db(+ -wal/-shm), files/, file_cache/, sounds/ 디렉토리 크기를 계산해 설정 화면에 표시한다.

const fs = require('fs')
const path = require('path')

// 바이트 → 사람이 읽는 단위(B/KB/MB/GB/TB) 변환. 1024 진법, 소수점 1자리(바이트 단위는 정수).
function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** exponent
  const formatted = exponent === 0 ? String(value) : value.toFixed(1)
  return `${formatted} ${units[exponent]}`
}

// 단일 파일 크기(bytes) — 파일이 없거나 접근 실패하면 0
function getFileSizeSafe(filePath) {
  try {
    return fs.statSync(filePath).size
  } catch {
    return 0
  }
}

// 디렉토리 전체 크기(bytes, 재귀 합산) — 디렉토리가 없으면 0.
// 심볼릭 링크는 순회하지 않는다(순환 참조로 인한 무한루프 및 디렉토리 밖 경로 유출 방지).
function getDirectorySize(dirPath) {
  let entries
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true })
  } catch {
    return 0
  }
  let total = 0
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name)
    if (entry.isDirectory()) {
      total += getDirectorySize(fullPath)
    } else if (entry.isFile()) {
      total += getFileSizeSafe(fullPath)
    }
  }
  return total
}

// appDataPath 기준 저장소 사용량 계산 — 항목별 바이트 크기 + 사람이 읽는 문자열을 반환.
function computeStorageUsage(appDataPath) {
  const dbPath = path.join(appDataPath, 'chat.db')
  const dbBytes = getFileSizeSafe(dbPath) + getFileSizeSafe(`${dbPath}-wal`) + getFileSizeSafe(`${dbPath}-shm`)
  const filesBytes = getDirectorySize(path.join(appDataPath, 'files'))
  const fileCacheBytes = getDirectorySize(path.join(appDataPath, 'file_cache'))
  const soundsBytes = getDirectorySize(path.join(appDataPath, 'sounds'))
  const totalBytes = dbBytes + filesBytes + fileCacheBytes + soundsBytes

  return {
    database: { bytes: dbBytes, readable: formatBytes(dbBytes) },
    files: { bytes: filesBytes, readable: formatBytes(filesBytes) },
    fileCache: { bytes: fileCacheBytes, readable: formatBytes(fileCacheBytes) },
    sounds: { bytes: soundsBytes, readable: formatBytes(soundsBytes) },
    total: { bytes: totalBytes, readable: formatBytes(totalBytes) },
  }
}

module.exports = { formatBytes, getFileSizeSafe, getDirectorySize, computeStorageUsage }
