// src/utils/mentions.js
// @멘션(#29) 순수 로직 — 실시간 자동완성/드롭다운은 만들지 않는다(한글 IME 조합 충돌 위험,
// Phase 3E 의 :shortcode: 자동완성 제외 결정과 동일한 이유). 대신 전송 시점에 메시지 텍스트에서
// "@닉네임" 토큰을 파싱해 멘션 대상 peerId 를 추출한다 — MessageInput.jsx 의
// handleKeyDown/composing/clearContent 로직과는 완전히 무관한 send 페이로드 구성 단계의 순수 함수.
//
// 렌더러가 usePeerStore 로 이미 알고 있는 "알려진 피어 닉네임 목록"을 인자로 받아 파싱한다
// (main 프로세스는 peerId→닉네임 매핑을 따로 들고 있지 않아, main 에서 파싱하려면 별도 map 을
// 새로 관리해야 하므로 렌더러가 계산해 mentions 를 함께 넘기는 쪽이 더 단순하고 정확하다).

// 문자가 "닉네임의 연장"으로 볼 수 있는 단어 문자(한글 음절/영문/숫자/밑줄)인지 판단.
// 매칭된 닉네임 바로 다음 글자가 이런 문자면, 실제로는 더 긴 미등록 단어의 일부일 수 있으므로
// 완전한 멘션으로 인정하지 않는다(예: 닉네임 "Bob" 이 "Bobby" 안에 오매칭되는 것을 방지).
function isWordContinuation(char) {
  return !!char && /[\p{L}\p{N}_]/u.test(char)
}

// 텍스트 안에서 "@닉네임" 패턴을 알려진 피어 닉네임 목록과 매칭해 peerId 배열로 반환한다.
// - peerNicknameList: [{ peerId, nickname }, ...]
// - options.excludePeerId: 매칭 후보에서 제외할 peerId(보통 나 자신) — 지정 시 자기 자신에
//   대한 "멘션"은 파싱 결과에 포함되지 않는다.
//
// 매칭 규칙:
// - 닉네임에 공백이 포함될 수 있으므로 단순 \b 단어 경계 대신, 매칭 직후 문자가
//   "단어 연장 문자"가 아닐 때만(공백/구두점/문자열 끝) 완전한 매칭으로 인정한다.
// - 정확일치 우선 — 같은 위치에서 여러 닉네임이 매칭 가능하면(한 닉네임이 다른 닉네임의
//   접두사인 경우) 가장 긴 닉네임을 우선 채택한다(최장일치).
// - 동일 peerId 가 텍스트에 여러 번 멘션돼도 결과에는 한 번만(첫 등장 순서로) 포함한다.
export function parseMentions(text, peerNicknameList, { excludePeerId } = {}) {
  if (!text || typeof text !== 'string') return []
  if (!Array.isArray(peerNicknameList) || peerNicknameList.length === 0) return []

  const candidates = peerNicknameList
    .filter(peer => peer && typeof peer.nickname === 'string' && peer.nickname.trim() && peer.peerId !== excludePeerId)
    .sort((a, b) => b.nickname.length - a.nickname.length)
  if (candidates.length === 0) return []

  const mentionedPeerIds = []
  const seen = new Set()

  let searchIndex = 0
  while (searchIndex < text.length) {
    const atIndex = text.indexOf('@', searchIndex)
    if (atIndex === -1) break

    const afterAt = text.slice(atIndex + 1)
    const matched = candidates.find(candidate => afterAt.startsWith(candidate.nickname))

    if (matched && !isWordContinuation(afterAt[matched.nickname.length])) {
      if (!seen.has(matched.peerId)) {
        seen.add(matched.peerId)
        mentionedPeerIds.push(matched.peerId)
      }
      searchIndex = atIndex + 1 + matched.nickname.length
      continue
    }
    searchIndex = atIndex + 1
  }

  return mentionedPeerIds
}

// 저장/전송된 mentions 값을 peerId 배열로 정규화한다.
// 라이브 경로(IPC 응답/수신 이벤트)는 배열, DB/히스토리 경로는 JSON 문자열로 들어온다
// (replyPreview.js 의 parseReplyPreview 와 동일 패턴).
export function parseStoredMentions(raw) {
  if (!raw) return []
  if (Array.isArray(raw)) return raw
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
  return []
}

// 멘션 하이라이트 렌더링용 닉네임 조회 — resolvePeerNickname(라벨 표시용, 자신은 "나")과
// 달리, 여기서는 "메시지 원문에 실제로 타이핑된 문자열"이 필요하므로 자신인 경우 "나"가
// 아니라 실제 내 닉네임을 반환해야 정확히 매칭된다.
export function resolveMentionNickname(peerId, { myPeerId, myNickname, onlinePeers = [], pastDMPeers = [] } = {}) {
  if (peerId === myPeerId) return myNickname || null
  const peer = onlinePeers.find(p => p.peerId === peerId) || pastDMPeers.find(p => p.peerId === peerId)
  return peer?.nickname || null
}
