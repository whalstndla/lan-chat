// electron/utils/urlGuard.js
// SSRF(Server-Side Request Forgery) 방어용 URL 가드 — 순수 함수 모음.
//
// 메인 프로세스가 링크 프리뷰(fetch-link-preview) / 이미지 클립보드 복사
// (copy-image-to-clipboard) 에서 "피어가 보낸 임의의 URL" 로 외부 요청을 보낸다.
// 검증이 없으면 악성 링크 하나만으로:
//   - 내부 LAN 호스트(10.x, 192.168.x 등) 스캔/접근
//   - 클라우드 메타데이터(169.254.169.254 등) 크리덴셜 탈취
//   - 루프백(127.0.0.1) 로컬 서비스 접근
//   - DNS rebinding: 공개 도메인이 사설 IP 로 resolve 되도록 유도
// 같은 공격이 가능하다. 이 모듈은 스킴/IP 대역/DNS 조회 결과를 검사해 이를 차단한다.
//
// 설계: 동기 검사(isBlockedUrl)와 DNS 조회가 필요한 비동기 검사(isBlockedUrlAsync)를
// 분리해 순수 로직만 단위 테스트할 수 있게 한다. isBlockedIp 는 완전 순수 함수다.

const net = require('net')
const dns = require('dns')

// ── IPv4 사설/링크로컬/루프백/메타데이터 대역 판정 (순수) ───────────────────
function isBlockedIpv4(ip) {
  const parts = String(ip).split('.').map((n) => Number(n))
  // 형식이 온전하지 않으면 안전측으로 차단
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true
  }
  const [a, b] = parts
  if (a === 0) return true                          // 0.0.0.0/8 ("this network")
  if (a === 10) return true                         // 10.0.0.0/8 사설
  if (a === 127) return true                        // 127.0.0.0/8 루프백
  if (a === 169 && b === 254) return true           // 169.254.0.0/16 링크로컬 + 클라우드 메타데이터
  if (a === 172 && b >= 16 && b <= 31) return true  // 172.16.0.0/12 사설
  if (a === 192 && b === 168) return true           // 192.168.0.0/16 사설
  if (a === 100 && b >= 64 && b <= 127) return true // 100.64.0.0/10 CGN(공유 대역) — SSRF 방어 강화
  return false
}

// IPv4-mapped/compatible IPv6 (::ffff:1.2.3.4, ::1.2.3.4, ::ffff:a9fe:a9fe) 에서
// 내부 IPv4 문자열을 추출한다. 없으면 null.
function extractMappedIpv4(addr) {
  // 끝이 점표기 IPv4 인 형태 (::1.2.3.4 / ::ffff:1.2.3.4)
  const dotted = addr.match(/:((?:\d{1,3}\.){3}\d{1,3})$/)
  if (dotted) return dotted[1]
  // ::ffff:XXXX:XXXX (16진) 형태 → 마지막 32비트를 IPv4 로 환원
  const hex = addr.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i)
  if (hex) {
    const high = parseInt(hex[1], 16)
    const low = parseInt(hex[2], 16)
    return `${(high >> 8) & 0xff}.${high & 0xff}.${(low >> 8) & 0xff}.${low & 0xff}`
  }
  return null
}

// ── IPv6 사설/링크로컬/루프백 판정 (순수) ───────────────────────────────────
function isBlockedIpv6(ip) {
  let addr = String(ip).toLowerCase()
  addr = addr.replace(/^\[/, '').replace(/\]$/, '') // URL 대괄호 제거
  const percentIdx = addr.indexOf('%')
  if (percentIdx !== -1) addr = addr.slice(0, percentIdx) // zone id(fe80::1%eth0) 제거

  // IPv4-mapped/compatible → 내부 IPv4 대역 검사로 위임 (우회 방지)
  const mapped = extractMappedIpv4(addr)
  if (mapped) return isBlockedIpv4(mapped)

  if (addr === '::') return true   // 불특정 주소(0.0.0.0 상당)
  if (addr === '::1') return true  // 루프백

  // 첫 16비트 그룹으로 fc00::/7(ULA), fe80::/10(링크로컬) 판정.
  // fc00::/7 과 fe80::/10 은 항상 첫 그룹이 존재하므로 '::' 로 압축될 일이 없다.
  const firstHextet = parseInt(addr.split(':')[0] || '', 16)
  if (Number.isNaN(firstHextet)) return false
  if ((firstHextet & 0xfe00) === 0xfc00) return true // fc00::/7 (fc00 ~ fdff)
  if ((firstHextet & 0xffc0) === 0xfe80) return true // fe80::/10 (fe80 ~ febf)
  return false
}

// IP 리터럴 문자열이 차단 대역인지 (순수). IP 가 아니면 안전측으로 차단(true).
function isBlockedIp(ip) {
  const family = net.isIP(String(ip))
  if (family === 4) return isBlockedIpv4(ip)
  if (family === 6) return isBlockedIpv6(ip)
  return true
}

// ── URL 동기 검사 (순수, DNS 미수행) ────────────────────────────────────────
// 차단 조건: 파싱 불가 / http·https 외 스킴 / 호스트가 사설 IP 리터럴 / localhost 계열.
// 일반 호스트명은 여기서 판단 불가 → false 를 반환하고, DNS 조회는 isBlockedUrlAsync 가 담당.
function isBlockedUrl(rawUrl) {
  let parsed
  try {
    parsed = new URL(rawUrl)
  } catch {
    return true
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return true
  const hostname = parsed.hostname
  if (!hostname) return true

  // URL 은 IPv6 를 [..] 로 감싸므로 net.isIP 판정 전에 대괄호 제거
  const host = hostname.replace(/^\[/, '').replace(/\]$/, '')
  if (net.isIP(host)) return isBlockedIp(host)

  // 명백한 로컬 호스트명은 DNS 조회 없이 즉시 차단
  const lowerHost = host.toLowerCase()
  if (lowerHost === 'localhost' || lowerHost.endsWith('.localhost')) return true

  return false
}

// ── URL 비동기 검사 (DNS 조회 포함) ─────────────────────────────────────────
// DNS rebinding 방어: 호스트명을 resolve 한 뒤 모든 결과 IP 를 대역 검사한다.
// options.lookup 을 주입하면 테스트에서 DNS 를 대체할 수 있다(기본 dns.promises.lookup).
async function isBlockedUrlAsync(rawUrl, options = {}) {
  // 1차: 동기 검사(스킴/리터럴 IP/localhost)
  if (isBlockedUrl(rawUrl)) return true

  const parsed = new URL(rawUrl)
  const host = parsed.hostname.replace(/^\[/, '').replace(/\]$/, '')
  // 이미 동기 검사를 통과한 공인 IP 리터럴이면 DNS 조회 불필요
  if (net.isIP(host)) return false

  const lookup = options.lookup || dns.promises.lookup
  try {
    // all:true → 이 호스트로 매핑되는 모든 IP 를 받아 하나라도 사설이면 차단
    const results = await lookup(host, { all: true })
    if (!Array.isArray(results) || results.length === 0) return true
    return results.some((entry) => isBlockedIp(entry.address))
  } catch {
    // 조회 실패 시 안전측으로 차단
    return true
  }
}

module.exports = {
  isBlockedIp,
  isBlockedUrl,
  isBlockedUrlAsync,
}
