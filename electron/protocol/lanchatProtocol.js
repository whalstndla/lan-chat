// 'lanchat://' custom protocol — 앱 BrowserWindow 안에서만 접근 가능한 파일 전달 채널.
// 외부 브라우저 / 다른 PC 에서 절대 GET 불가 (HTTP 가 아님).
//
// 지원하는 URL:
//   lanchat://file/<messageId>
//
// 핸들러는 messageId 로 DB 의 cached_file_path 를 조회한 뒤,
// 디스크에 저장된 ciphertext 를 메모리에서 복호화해 응답한다.
// (3단계에서 디스크 암호화가 적용되기 전까지는 평문도 그대로 통과시킨다 — 마이그레이션 진행 중 호환성)

const fs = require('fs')
const path = require('path')
const { protocol } = require('electron')
const { getFileCache } = require('../storage/queries')
const { decryptBuffer, isEncryptedFile } = require('../crypto/fileEncryption')

const SCHEME = 'lanchat'

// 미디어 mime 추정 — fileServer 의 INLINE_SAFE_EXT 와 동일 정책.
const MIME_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.m4v': 'video/x-m4v',
  '.ogv': 'video/ogg',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
}

function guessMime(fileName) {
  return MIME_BY_EXT[path.extname(fileName).toLowerCase()] || 'application/octet-stream'
}

// app.whenReady() 이전에 호출되어야 함.
function registerLanChatScheme() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        bypassCSP: false,
      },
    },
  ])
}

// app.whenReady() 이후 호출.
function registerLanChatHandler(ctx) {
  protocol.handle(SCHEME, async (request) => {
    try {
      const url = new URL(request.url)
      // host 가 'file' 인 경우만 지원
      if (url.host !== 'file') {
        return new Response('Not Found', { status: 404 })
      }
      const messageId = decodeURIComponent(url.pathname.replace(/^\//, ''))
      if (!messageId) return new Response('Bad Request', { status: 400 })

      const cachedPath = getFileCache(ctx.state.database, messageId)
      if (!cachedPath || !fs.existsSync(cachedPath)) {
        return new Response('Not Found', { status: 404 })
      }

      const raw = fs.readFileSync(cachedPath)
      let plaintext
      if (isEncryptedFile(raw)) {
        // 3단계 이후에 도달하는 경로 — 마스터키로 복호화
        const masterKey = ctx.state.masterKey
        if (!masterKey) return new Response('Internal Error', { status: 500 })
        try {
          plaintext = decryptBuffer(raw, masterKey)
        } catch {
          return new Response('Decryption Failed', { status: 500 })
        }
      } else {
        // 마이그레이션 전 평문 캐시 — 그대로 응답 (3단계에서 일괄 변환 예정)
        plaintext = raw
      }

      return new Response(plaintext, {
        status: 200,
        headers: {
          'Content-Type': guessMime(cachedPath),
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
        },
      })
    } catch {
      return new Response('Internal Error', { status: 500 })
    }
  })
}

// 메시지 표시용 lanchat URL 생성 — 렌더러가 이 URL 을 <img src> 로 사용.
function buildLanChatUrl(messageId) {
  return `${SCHEME}://file/${encodeURIComponent(messageId)}`
}

module.exports = {
  SCHEME,
  registerLanChatScheme,
  registerLanChatHandler,
  buildLanChatUrl,
  guessMime,
}
