// src/utils/lastEditableMessage.js
// ↑ 키로 "마지막 내 메시지 수정" 기능(#40)에 쓰이는 순수 판정 로직.
// Message.jsx 의 수정 버튼 노출 조건(isMyMessage && !pending && (contentType==='text' || 없음))과
// 반드시 동일한 기준을 써야 한다 — 버튼으로는 수정할 수 없는 메시지를 단축키로는 열 수 있게 되는
// 불일치를 막기 위함. 스토어(zustand)에 직접 의존하지 않는 순수 함수로 분리해 단위 테스트한다.

// messages: 현재 방(전체채팅 또는 DM)의 메시지 배열(시간순, 오래된 → 최신).
// myPeerId: 내 peerId.
// 반환값: 조건을 만족하는 가장 최근(배열 끝에서부터) 메시지, 없으면 null.
export function findLastEditableOwnMessage(messages, myPeerId) {
  if (!Array.isArray(messages) || !myPeerId) return null
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]
    if (!message) continue
    const senderId = message.fromId || message.from_id
    if (senderId !== myPeerId) continue
    if (message.pending) continue
    const contentType = message.contentType || message.content_type
    if (contentType && contentType !== 'text') continue
    return message
  }
  return null
}
