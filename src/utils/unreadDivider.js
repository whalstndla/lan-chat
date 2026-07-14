// src/utils/unreadDivider.js
// 안읽음 구분선/점프 버튼 판정 순수 로직(#39) — ChatWindow.jsx 의 렌더 루프(구분선 삽입)와
// 점프 버튼(개수 표시 + 스크롤 대상)이 동일한 기준을 공유하도록 이 모듈로 추출한다.
// 두 곳이 각자 조건을 계산하면 판정 기준이 어긋날 위험이 있어, 하나의 함수로 통일했다.

// 메시지가 "첫 안읽음 메시지"인지 판정 — 방(global/dm) 공용.
// - lastReadTimestamp 가 없으면(null/undefined) 구분선을 표시하지 않는다(첫 방문 등).
// - 내가 보낸 메시지에는 구분선을 붙이지 않는다.
// - 바로 이전 메시지가 이미 안읽음이면(=이미 구분선이 그 앞에 표시됨) 다시 표시하지 않는다.
export function isFirstUnreadMessage(message, prevMessage, lastReadTimestamp, isMyMessage) {
  return (
    lastReadTimestamp != null &&
    message.timestamp > lastReadTimestamp &&
    (prevMessage === null || prevMessage.timestamp <= lastReadTimestamp) &&
    !isMyMessage
  )
}

// 현재 로드된 메시지 중 안읽음(lastReadTimestamp 이후 && 내가 보낸 메시지 아님) 목록.
// 점프 버튼의 개수 표시 및 스크롤 대상(첫 번째 항목) 계산에 사용된다.
export function getUnreadMessages(messages, lastReadTimestamp, myPeerId) {
  if (lastReadTimestamp == null) return []
  return messages.filter((msg) => {
    const isMy = msg.fromId === myPeerId || msg.from_id === myPeerId
    return !isMy && msg.timestamp > lastReadTimestamp
  })
}
