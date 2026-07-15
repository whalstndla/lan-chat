// TOFU(Trust On First Use) 키 고정 판정 헬퍼(#59).
//
// hello 수신 시 상대 공개키를 무검증으로 덮어쓰면, 같은 LAN 의 공격자가 피해자의 peerId +
// 자기 공개키로 hello 를 보내 그 자리에서 신뢰돼 사칭/MITM 이 가능하다. 이를 막기 위해
// 최초 공개키를 DB(peer_keys)에 고정하고, 알려진 peerId 의 키가 바뀌면 조용히 덮어쓰지
// 않고 사용자 재확인을 거치게 한다.
//
// 이 모듈은 순수 판정/지문 계산만 담당한다(읽기 전용). 실제 고정(pin)/세션 맵 갱신은
// 호출부(hello 핸들러 / trust-peer-key IPC)가 판정 결과에 따라 수행한다.

const crypto = require('crypto')
const { getPinnedKey } = require('../storage/queries')

// 공개키(base64 SPKI DER)의 SHA-256 지문을 사람이 대면 비교하기 쉬운 형태로 반환한다.
// 예: "A1B2 C3D4 E5F6 ...". 앞 32 hex(16바이트)만 4자리씩 그룹핑 — 읽기 편의와 충돌
// 저항의 균형(대면 안전 번호 비교 용도). 입력이 없으면 빈 문자열.
function computeKeyFingerprint(publicKeyBase64) {
  if (!publicKeyBase64) return ''
  try {
    const der = Buffer.from(publicKeyBase64, 'base64')
    const hashHex = crypto.createHash('sha256').update(der).digest('hex').toUpperCase()
    return hashHex.slice(0, 32).match(/.{1,4}/g).join(' ')
  } catch {
    return ''
  }
}

// TOFU 판정 — DB 에 고정된 키와 수신 공개키를 비교해 3분기 중 하나를 반환한다.
//   - db 없음(테스트/초기화 전) 또는 고정된 키 없음 → 'first'(최초 고정 대상)
//   - 고정 키와 일치                             → 'match'(정상 재연결)
//   - 고정 키와 불일치                           → 'mismatch'(키 변경 — 경고 필요)
// 조회 실패(손상 등)는 안전하게 'first' 로 처리하지 않고, DB 는 있으나 조회가 던지면
// pinned=null 로 보고 'first' 로 흐른다(연결 자체는 막지 않되 최초 고정으로 취급).
function evaluatePeerKey(db, peerId, incomingPublicKeyBase64) {
  if (!db) return { status: 'first', pinned: null }
  let pinned = null
  try {
    pinned = getPinnedKey(db, peerId)
  } catch {
    pinned = null
  }
  if (!pinned) return { status: 'first', pinned: null }
  if (pinned.publicKey === incomingPublicKeyBase64) return { status: 'match', pinned }
  return { status: 'mismatch', pinned }
}

module.exports = { computeKeyFingerprint, evaluatePeerKey }
