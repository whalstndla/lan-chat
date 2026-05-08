// electron/peer/fileServer.js
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
  // 미디어가 아닌 파일은 attachment 로 다운로드 강제 (html/svg/js 등 브라우저 실행 방지)
  const ext = path.extname(filePath).toLowerCase()
  if (!INLINE_SAFE_EXT.has(ext)) {
    res.set('Content-Disposition', 'attachment')
  }
}

function startFileServer(tempFolderPath, profileFolderPath) {
  return new Promise((resolve) => {
    const app = express()

    app.use('/files', express.static(tempFolderPath, { setHeaders: buildFileHeaders }))
    if (profileFolderPath) {
      // 프로필 이미지는 인라인 표시 필요 (Content-Disposition 미적용)
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
