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
// HEIC / HEIF 는 송신측에서 JPEG 으로 변환하지만 변환 실패 / 구버전에서 넘어온 원본을
// 폴백으로 처리하기 위해 매핑은 유지. Chromium 이 시스템 코덱으로 디코딩하면 그나마 표시됨.
const MIME_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.heic': 'image/heic', '.heif': 'image/heif',
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

// 복호화된 평문 버퍼 LRU 캐시.
// AES-GCM 암호문은 부분 읽기가 불가능해 요청마다 파일 전체를 읽고 전체 복호화해야 한다.
// 특히 Range 요청은 같은 파일에 대해 여러 번 발생하므로, 한 번 복호화한 평문을
// cachedPath 키로 재사용해 반복 복호화를 막는다.
//
// 상한 정책(이중 제한):
//   - maxEntries: 캐시에 유지할 최대 항목 수
//   - maxBytes:   캐시에 유지할 평문 총 바이트 상한 (기본 256MB)
//   - maxEntryBytes: 단일 파일 최대 바이트 (기본 maxBytes/2) — 이 값을 넘는 대용량
//     파일은 캐시에 넣지 않아 하나의 큰 파일이 캐시를 독점하는 것을 방지한다.
// 콘텐츠는 cachedPath 기준으로 사실상 불변이라 TTL 없이 LRU 방출만으로 충분하다.
function createDecryptedCache(options = {}) {
  const maxEntries = options.maxEntries ?? 8
  const maxBytes = options.maxBytes ?? 256 * 1024 * 1024
  const maxEntryBytes = options.maxEntryBytes ?? Math.floor(maxBytes / 2)

  // Map 은 삽입 순서를 보존하므로 "가장 앞 = 가장 오래 안 쓰인 항목" 으로 LRU 근사.
  const entryMap = new Map()
  let totalBytes = 0

  // 가장 오래된 항목 1개 방출.
  function evictOldest() {
    const oldestKey = entryMap.keys().next().value
    if (oldestKey === undefined) return
    totalBytes -= entryMap.get(oldestKey).length
    entryMap.delete(oldestKey)
  }

  // 히트 시 해당 항목을 최신 위치로 이동(재삽입)하고 버퍼 반환. 미스면 undefined.
  function get(key) {
    if (!entryMap.has(key)) return undefined
    const value = entryMap.get(key)
    entryMap.delete(key)
    entryMap.set(key, value)
    return value
  }

  // 버퍼 저장. 단일 상한 초과 파일은 캐싱을 건너뛰고, 저장 후 이중 상한을 넘으면 LRU 방출.
  function put(key, value) {
    if (!Buffer.isBuffer(value)) return
    if (value.length > maxEntryBytes) return
    if (entryMap.has(key)) {
      totalBytes -= entryMap.get(key).length
      entryMap.delete(key)
    }
    entryMap.set(key, value)
    totalBytes += value.length
    while (entryMap.size > 0 && (entryMap.size > maxEntries || totalBytes > maxBytes)) {
      evictOldest()
    }
  }

  // 전체 비우기 — 로그아웃/마스터키 폐기 시 평문 잔재 제거.
  function clear() {
    entryMap.clear()
    totalBytes = 0
  }

  return {
    get,
    put,
    clear,
    get size() { return entryMap.size },
    get bytes() { return totalBytes },
  }
}

// main 프로세스 단일 인스턴스 — 프로토콜 핸들러가 공유한다.
const decryptedCache = createDecryptedCache()

// 로그아웃/마스터키 폐기 시 복호화 평문 캐시를 비운다(teardownSession 에서 호출).
function clearDecryptedCache() {
  decryptedCache.clear()
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

      // LRU 캐시 히트 시 재복호화 없이 평문 재사용. 미스면 읽어서 복호화 후 캐시에 저장.
      let plaintext = decryptedCache.get(cachedPath)
      if (!plaintext) {
        const raw = fs.readFileSync(cachedPath)
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
        decryptedCache.put(cachedPath, plaintext)
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
  createDecryptedCache,
  clearDecryptedCache,
}
