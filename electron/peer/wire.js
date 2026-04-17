// 와이어 프로토콜 v2 — hello 핸드셰이크 직렬화/파싱.
//
// v1의 key-exchange 는 비대칭 reply 구조 + 세션ID 부재로 stale 연결 구분이 어려웠다.
// v2는:
//   - 대칭 hello (양쪽이 같은 메시지를 교환)
//   - sessionId 로 재시작 감지
//   - capabilities 로 점진적 기능 확장
//   - v 필드로 향후 버전 호환성 관리

const WIRE_VERSION = 2

// 현재 앱이 지원하는 capabilities — 각 기능 플래그 OFF/ON 협상
const LOCAL_CAPABILITIES = Object.freeze([
  'dm',                 // E2E DM
  'file-ws-fallback',   // AP isolation 환경에서 WebSocket 파일 전송
  'reactions',          // 이모지 리액션
  'typing',             // 타이핑 인디케이터
  'read-receipts',      // 읽음 확인
  'edit-delete',        // 메시지 수정/삭제
  'status',             // 상태 메시지
  'nickname-change',    // 닉네임 실시간 변경
])

function buildHello({
  peerId,
  sessionId,
  publicKey,
  nickname,
  wsPort,
  filePort,
  addresses,
  profileImageUrl,
  capabilities = LOCAL_CAPABILITIES,
}) {
  return {
    type: 'hello',
    v: WIRE_VERSION,
    fromId: peerId,
    sessionId,
    publicKey,
    nickname,
    wsPort,
    filePort,
    addresses: Array.isArray(addresses) ? [...addresses] : [],
    profileImageUrl: profileImageUrl ?? null,
    capabilities: Array.isArray(capabilities) ? [...capabilities] : [],
  }
}

function parseHello(rawMessage) {
  if (!rawMessage || typeof rawMessage !== 'object') {
    return { ok: false, reason: 'not an object' }
  }
  if (rawMessage.type !== 'hello') {
    return { ok: false, reason: `type must be 'hello', got '${rawMessage.type}'` }
  }
  if (rawMessage.v !== WIRE_VERSION) {
    return { ok: false, reason: `unsupported version ${rawMessage.v} (expected ${WIRE_VERSION})` }
  }
  const requiredFields = ['fromId', 'sessionId', 'publicKey', 'nickname', 'wsPort']
  for (const field of requiredFields) {
    if (rawMessage[field] === undefined || rawMessage[field] === null) {
      return { ok: false, reason: `missing field: ${field}` }
    }
  }
  if (typeof rawMessage.fromId !== 'string' || !rawMessage.fromId) {
    return { ok: false, reason: 'fromId must be non-empty string' }
  }
  if (typeof rawMessage.sessionId !== 'string' || !rawMessage.sessionId) {
    return { ok: false, reason: 'sessionId must be non-empty string' }
  }
  if (!Number.isInteger(rawMessage.wsPort) || rawMessage.wsPort <= 0) {
    return { ok: false, reason: 'wsPort must be positive integer' }
  }
  const hello = {
    peerId: rawMessage.fromId,
    sessionId: rawMessage.sessionId,
    publicKey: rawMessage.publicKey,
    nickname: String(rawMessage.nickname || ''),
    wsPort: rawMessage.wsPort,
    filePort: Number.isInteger(rawMessage.filePort) ? rawMessage.filePort : 0,
    addresses: Array.isArray(rawMessage.addresses) ? rawMessage.addresses.filter(a => typeof a === 'string') : [],
    profileImageUrl: typeof rawMessage.profileImageUrl === 'string' ? rawMessage.profileImageUrl : null,
    capabilities: Array.isArray(rawMessage.capabilities) ? rawMessage.capabilities.filter(c => typeof c === 'string') : [],
  }
  return { ok: true, hello }
}

// 상대 capabilities 와 내 capabilities 의 교집합 반환 (negotiated)
function negotiateCapabilities(remoteCapabilities) {
  const remoteSet = new Set(remoteCapabilities)
  return LOCAL_CAPABILITIES.filter(cap => remoteSet.has(cap))
}

module.exports = {
  WIRE_VERSION,
  LOCAL_CAPABILITIES,
  buildHello,
  parseHello,
  negotiateCapabilities,
}
