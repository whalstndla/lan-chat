// src/utils/buildMessageRenderItems.js
// 메시지 목록 → 렌더 아이템 목록 변환의 순수 로직. ChatWindow.jsx 의 렌더 IIFE 가 매 렌더마다
// 전체 메시지를 순회하며 계산하던 날짜 구분선 / 안읽음 구분선 / 연속 이미지 그룹핑을 이 함수로
// 분리한다. ChatWindow 는 이 결과를 useMemo 로 캐시해(키: messages/lastReadTimestamp/myPeerId)
// 구조가 바뀔 때만 재계산하고, 자주 바뀌는 isHighlighted/searchQuery 는 렌더 시 각 Message 에
// props 로 넘긴다(React.memo 라 실제로 바뀐 메시지만 리렌더).
import { isFirstUnreadMessage } from './unreadDivider'

// 비그룹 메시지가 공유하는 안정적인 빈 배열 참조 — 매 계산마다 새 [] 를 만들면 React.memo 의
// 얕은 비교가 깨져 무관한 메시지까지 리렌더되므로 모듈 상수를 재사용한다.
export const EMPTY_EXTRA_IMAGES = []

// timestamp → 날짜 비교용 키 문자열 (로케일 날짜). 이전 메시지와 날짜가 다른지 판정에 사용.
function toDateKey(timestamp) {
  return new Date(timestamp).toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' })
}

// 날짜 구분선에 표시할 라벨 문자열 — "2026년 07월 14일" 형식.
function formatDateLabel(timestamp) {
  const date = new Date(timestamp)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}년 ${month}월 ${day}일`
}

// 메시지 배열을 렌더 아이템 배열로 변환한다. 각 아이템은 순수 데이터이며 다음을 포함한다:
//   - message: 렌더할 메시지(연속 이미지 그룹은 첫 번째 메시지만 아이템으로 남는다)
//   - isGrouped: 바로 이전 메시지와 같은 발신자라 헤더(아바타/닉네임)를 생략할지
//   - extraImages: 연속 이미지 그룹의 2번째 이후 이미지들(그룹이 아니면 EMPTY_EXTRA_IMAGES)
//   - showDateDivider / dateLabel: 이전 메시지와 날짜가 다를 때 표시할 날짜 구분선
//   - showUnreadDivider: 안읽음 구분선(#39)을 이 메시지 앞에 표시할지
export function buildMessageRenderItems(messages, lastReadTimestamp, myPeerId) {
  const items = []
  let i = 0
  while (i < messages.length) {
    const message = messages[i]
    const prevMessage = i > 0 ? messages[i - 1] : null
    const isMyMessage = message.fromId === myPeerId || message.from_id === myPeerId
    const messageContentType = message.contentType || message.content_type
    const messageSenderId = message.fromId || message.from_id

    // 날짜 구분선: 이전 메시지와 날짜가 다르면 표시
    const prevDateKey = prevMessage ? toDateKey(prevMessage.timestamp) : null
    const showDateDivider = prevDateKey !== null && toDateKey(message.timestamp) !== prevDateKey
    const dateLabel = showDateDivider ? formatDateLabel(message.timestamp) : null

    // 안읽음 구분선: 렌더 루프/점프 버튼과 동일한 순수 함수로 판정
    const showUnreadDivider = isFirstUnreadMessage(message, prevMessage, lastReadTimestamp, isMyMessage)

    // 바로 이전 메시지가 같은 발신자면 그룹으로 묶어 헤더 생략
    const isGrouped = prevMessage !== null && (prevMessage.fromId || prevMessage.from_id) === messageSenderId

    // 연속 이미지 그룹 감지 — 같은 발신자의 연속 이미지를 한 아이템으로 묶는다
    if (messageContentType === 'image') {
      const imageGroup = [message]
      let j = i + 1
      while (j < messages.length) {
        const next = messages[j]
        const nextContentType = next.contentType || next.content_type
        const nextSenderId = next.fromId || next.from_id
        if (nextContentType === 'image' && nextSenderId === messageSenderId) {
          imageGroup.push(next)
          j++
        } else break
      }

      if (imageGroup.length > 1) {
        // 연속 이미지 그룹 → 첫 번째만 Message 로 렌더, 나머지는 그리드(extraImages)에 포함
        items.push({
          message,
          isGrouped,
          extraImages: imageGroup.slice(1),
          showDateDivider,
          dateLabel,
          showUnreadDivider,
        })
        i = j
        continue
      }
    }

    // 일반 메시지(단일 이미지 포함)
    items.push({
      message,
      isGrouped,
      extraImages: EMPTY_EXTRA_IMAGES,
      showDateDivider,
      dateLabel,
      showUnreadDivider,
    })
    i++
  }
  return items
}
