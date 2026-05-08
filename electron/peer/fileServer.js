// electron/peer/fileServer.js
// 5단계 이후로는 프로필 이미지(공개 정보) 만 LAN HTTP 로 노출.
// 사용자 송수신 파일은 ECDH ws 채널 + 자기 마스터키 디스크 암호화 + lanchat:// 표시로만 처리.
//
// INLINE_SAFE_EXT / buildFileHeaders 는 lanchat:// 핸들러 와 fileServer 헤더 분기 테스트에서
// 공통으로 쓰는 정책이라 export 만 유지.

const http = require('http')
const path = require('path')
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
  const ext = path.extname(filePath).toLowerCase()
  if (!INLINE_SAFE_EXT.has(ext)) {
    res.set('Content-Disposition', 'attachment')
  }
}

function startFileServer(profileFolderPath) {
  return new Promise((resolve) => {
    const app = express()
    if (profileFolderPath) {
      // 프로필 이미지는 LAN 공개 정보 — 평문 인라인 표시 유지
      app.use('/profile', express.static(profileFolderPath, {
        setHeaders: (res) => { res.set('X-Content-Type-Options', 'nosniff') },
      }))
    }
    // /files 라우트는 폐기 — 사용자 파일은 lanchat:// (자기) + ECDH ws (피어) 로만 접근
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
