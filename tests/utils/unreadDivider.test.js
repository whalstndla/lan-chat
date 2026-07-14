// tests/utils/unreadDivider.test.js
// 안읽음 구분선/점프 버튼 판정 순수 로직 단위 테스트(#39).
// ChatWindow.jsx 의 렌더 루프(구분선 삽입)와 점프 버튼(개수/스크롤 대상 계산)이 동일한
// 기준(isFirstUnreadMessage/getUnreadMessages)을 공유하는지 검증한다.
import { isFirstUnreadMessage, getUnreadMessages } from '../../src/utils/unreadDivider'

describe('isFirstUnreadMessage', () => {
  it('lastReadTimestamp 가 없으면(null) 구분선을 표시하지 않는다', () => {
    const message = { timestamp: 100 }
    expect(isFirstUnreadMessage(message, null, null, false)).toBe(false)
  })

  it('lastReadTimestamp 가 undefined 여도 구분선을 표시하지 않는다', () => {
    const message = { timestamp: 100 }
    expect(isFirstUnreadMessage(message, null, undefined, false)).toBe(false)
  })

  it('lastReadTimestamp 이후 첫 메시지(이전 메시지 없음)면 true', () => {
    const message = { timestamp: 200 }
    expect(isFirstUnreadMessage(message, null, 100, false)).toBe(true)
  })

  it('이전 메시지가 이미 lastReadTimestamp 이후(=이미 구분선이 그 앞에 표시됨)면 false', () => {
    const prevMessage = { timestamp: 150 }
    const message = { timestamp: 200 }
    expect(isFirstUnreadMessage(message, prevMessage, 100, false)).toBe(false)
  })

  it('이전 메시지가 lastReadTimestamp 와 같아도(경계값) 첫 안읽음으로 인정한다', () => {
    const prevMessage = { timestamp: 100 }
    const message = { timestamp: 200 }
    expect(isFirstUnreadMessage(message, prevMessage, 100, false)).toBe(true)
  })

  it('내가 보낸 메시지에는 구분선을 표시하지 않는다', () => {
    const message = { timestamp: 200 }
    expect(isFirstUnreadMessage(message, null, 100, true)).toBe(false)
  })

  it('메시지 timestamp 가 lastReadTimestamp 이하이면 false', () => {
    const message = { timestamp: 100 }
    expect(isFirstUnreadMessage(message, null, 100, false)).toBe(false)
  })
})

describe('getUnreadMessages', () => {
  const myPeerId = 'me'

  it('lastReadTimestamp 가 null 이면 빈 배열을 반환한다', () => {
    const messages = [{ id: '1', timestamp: 100, fromId: 'peer-1' }]
    expect(getUnreadMessages(messages, null, myPeerId)).toEqual([])
  })

  it('lastReadTimestamp 이후 && 내가 보내지 않은 메시지만 포함한다', () => {
    const messages = [
      { id: '1', timestamp: 100, fromId: 'peer-1' }, // 읽음
      { id: '2', timestamp: 200, fromId: 'peer-1' }, // 안읽음
      { id: '3', timestamp: 300, fromId: myPeerId }, // 내 메시지 — 제외
      { id: '4', timestamp: 400, fromId: 'peer-1' }, // 안읽음
    ]
    const result = getUnreadMessages(messages, 150, myPeerId)
    expect(result.map(m => m.id)).toEqual(['2', '4'])
  })

  it('from_id(snake_case) 필드도 내 메시지 판별에 사용한다', () => {
    const messages = [{ id: '1', timestamp: 200, from_id: myPeerId }]
    expect(getUnreadMessages(messages, 100, myPeerId)).toEqual([])
  })

  it('안읽음 메시지가 없으면 빈 배열을 반환한다', () => {
    const messages = [{ id: '1', timestamp: 100, fromId: 'peer-1' }]
    expect(getUnreadMessages(messages, 200, myPeerId)).toEqual([])
  })
})
