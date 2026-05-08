// electron/peer/fileServer.js
const http = require('http')
const path = require('path')
const fs = require('fs')
const express = require('express')

let serverInstance = null
let filePort = 0

// 인라인 표시가 안전한 미디어 확장자 — 그 외는 attachment 강제 (Stored XSS 방지)
const INLINE_SAFE_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.avif', '.ico',
  '.mp4', '.webm', '.mov', '.m4v', '.ogg', '.ogv',
  '.mp3', '.wav', '.m4a', '.flac',
])

function buildFileHeaders(res, filePath) {
  res.set('X-Content-Type-Options', 'nosniff')
  // 미디어가 아닌 파일은 attachment 로 다운로드 강제 (html/svg/js 등 브라우저 실행 방지)
  const ext = path.extname(filePath).toLowerCase()
  if (!INLINE_SAFE_EXT.has(ext)) {
    res.set('Content-Disposition', 'attachment')
  }
}

const MIME_BY_EXT = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
  '.avif': 'image/avif',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4',
}

// 디스크는 ciphertext 만 저장된다는 전제로 동작.
// 같은 LAN 다른 PC 가 GET 시도 → ciphertext 그대로 응답 → 자기 마스터키 없으면 못 풀음.
// 다른 피어는 ciphertext 를 받아도 무용하므로 자동으로 ws fallback 으로 전환된다 (cacheReceivedFile).
// 4단계에서 ws fallback 도 ECDH 공유키 기반 ciphertext 로 재설계 → 이 라우트는 5단계에서 제거 예정.
//
// 마이그레이션 호환: 평문 파일이 남아 있다면 그대로 응답.
function buildFileRequestHandler(tempFolderPath) {
  return (req, res) => {
    const fileName = path.basename(req.path)
    const filePath = path.join(tempFolderPath, fileName)
    if (!filePath.startsWith(tempFolderPath)) return res.status(400).end()
    if (!fs.existsSync(filePath)) return res.status(404).end()
    let raw
    try { raw = fs.readFileSync(filePath) } catch { return res.status(500).end() }
    buildFileHeaders(res, filePath)
    res.set('Content-Type', MIME_BY_EXT[path.extname(filePath).toLowerCase()] || 'application/octet-stream')
    return res.end(raw)
  }
}

function startFileServer(tempFolderPath, profileFolderPath) {
  return new Promise((resolve) => {
    const app = express()

    app.use('/files', buildFileRequestHandler(tempFolderPath))
    if (profileFolderPath) {
      // 프로필 이미지는 LAN 공개 정보 — 평문 인라인 표시 유지
      app.use('/profile', express.static(profileFolderPath, {
        setHeaders: (res) => { res.set('X-Content-Type-Options', 'nosniff') },
      }))
    }
    // http.createServer를 사용하여 listen 이전에 서버 인스턴스를 확보
    serverInstance = http.createServer(app)
    serverInstance.listen(0, () => {
      filePort = serverInstance.address().port
      resolve(filePort)
    })
  })
}

function stopFileServer() {
  if (serverInstance) {
    serverInstance.close()
    serverInstance = null
    filePort = 0
  }
}

function getFilePort() {
  return filePort
}

module.exports = { startFileServer, stopFileServer, getFilePort, buildFileHeaders, INLINE_SAFE_EXT }
