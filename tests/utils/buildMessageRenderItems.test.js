// tests/utils/buildMessageRenderItems.test.js
// 메시지 목록 → 렌더 아이템 구조 계산 순수 로직 단위 테스트. ChatWindow 의 렌더 IIFE 에서
// 분리한 날짜/안읽음 구분선 + 연속 이미지 그룹핑 계산이 기존 동작과 동일한지 검증한다.
import { buildMessageRenderItems, EMPTY_EXTRA_IMAGES } from '../../src/utils/buildMessageRenderItems'

const myPeerId = 'me'

// 같은 날(2026-07-14) 안에서 오름차순 timestamp 를 만드는 헬퍼 — 날짜 구분선 없이 순수 그룹핑 검증용
function textMsg(id, senderId, offsetMinutes = 0, extra = {}) {
  return {
    id,
    fromId: senderId,
    contentType: 'text',
    content: `msg ${id}`,
    timestamp: new Date('2026-07-14T12:00:00').getTime() + offsetMinutes * 60000,
    ...extra,
  }
}

function imageMsg(id, senderId, offsetMinutes = 0) {
  return {
    id,
    fromId: senderId,
    contentType: 'image',
    fileUrl: `url-${id}`,
    timestamp: new Date('2026-07-14T12:00:00').getTime() + offsetMinutes * 60000,
  }
}

describe('buildMessageRenderItems — 기본 구조', () => {
  it('빈 배열이면 빈 아이템 목록을 반환한다', () => {
    expect(buildMessageRenderItems([], null, myPeerId)).toEqual([])
  })

  it('단일 메시지는 그룹/구분선 없이 하나의 아이템으로 변환된다', () => {
    const items = buildMessageRenderItems([textMsg('1', 'peerA')], null, myPeerId)
    expect(items).toHaveLength(1)
    expect(items[0].message.id).toBe('1')
    expect(items[0].isGrouped).toBe(false)
    expect(items[0].showDateDivider).toBe(false)
    expect(items[0].showUnreadDivider).toBe(false)
    // 비그룹 메시지는 공유 상수(안정적 참조)를 사용해야 React.memo 얕은 비교가 유지된다
    expect(items[0].extraImages).toBe(EMPTY_EXTRA_IMAGES)
  })

  it('같은 발신자의 연속 메시지는 두 번째부터 isGrouped=true', () => {
    const items = buildMessageRenderItems(
      [textMsg('1', 'peerA'), textMsg('2', 'peerA', 1)],
      null,
      myPeerId
    )
    expect(items[0].isGrouped).toBe(false)
    expect(items[1].isGrouped).toBe(true)
  })

  it('발신자가 바뀌면 isGrouped=false', () => {
    const items = buildMessageRenderItems(
      [textMsg('1', 'peerA'), textMsg('2', 'peerB', 1)],
      null,
      myPeerId
    )
    expect(items[1].isGrouped).toBe(false)
  })
})

describe('buildMessageRenderItems — 날짜 구분선', () => {
  it('이전 메시지와 날짜가 다르면 showDateDivider=true 와 라벨을 채운다', () => {
    const day1 = { id: '1', fromId: 'peerA', contentType: 'text', timestamp: new Date('2026-07-14T12:00:00').getTime() }
    const day2 = { id: '2', fromId: 'peerA', contentType: 'text', timestamp: new Date('2026-07-16T12:00:00').getTime() }
    const items = buildMessageRenderItems([day1, day2], null, myPeerId)
    expect(items[0].showDateDivider).toBe(false) // 첫 메시지 앞에는 구분선 없음
    expect(items[1].showDateDivider).toBe(true)
    expect(items[1].dateLabel).toBe('2026년 07월 16일')
  })
})

describe('buildMessageRenderItems — 안읽음 구분선', () => {
  it('lastReadTimestamp 이후 첫 상대 메시지에 showUnreadDivider=true', () => {
    const base = new Date('2026-07-14T12:00:00').getTime()
    const messages = [
      { id: '1', fromId: 'peerA', contentType: 'text', timestamp: base },       // 읽음
      { id: '2', fromId: 'peerA', contentType: 'text', timestamp: base + 1000 }, // 첫 안읽음
    ]
    const items = buildMessageRenderItems(messages, base, myPeerId)
    expect(items[0].showUnreadDivider).toBe(false)
    expect(items[1].showUnreadDivider).toBe(true)
  })

  it('내가 보낸 메시지에는 안읽음 구분선을 붙이지 않는다', () => {
    const base = new Date('2026-07-14T12:00:00').getTime()
    const messages = [
      { id: '1', fromId: 'peerA', contentType: 'text', timestamp: base },
      { id: '2', fromId: myPeerId, contentType: 'text', timestamp: base + 1000 },
    ]
    const items = buildMessageRenderItems(messages, base, myPeerId)
    expect(items[1].showUnreadDivider).toBe(false)
  })
})

describe('buildMessageRenderItems — 연속 이미지 그룹핑', () => {
  it('같은 발신자의 연속 이미지 3장은 첫 장 + extraImages(나머지 2장)로 묶인다', () => {
    const messages = [
      imageMsg('img1', 'peerA'),
      imageMsg('img2', 'peerA', 1),
      imageMsg('img3', 'peerA', 2),
    ]
    const items = buildMessageRenderItems(messages, null, myPeerId)
    expect(items).toHaveLength(1)
    expect(items[0].message.id).toBe('img1')
    expect(items[0].extraImages.map(m => m.id)).toEqual(['img2', 'img3'])
  })

  it('그룹 뒤의 다른 메시지는 별도 아이템으로 남는다', () => {
    const messages = [
      imageMsg('img1', 'peerA'),
      imageMsg('img2', 'peerA', 1),
      textMsg('t1', 'peerA', 2),
    ]
    const items = buildMessageRenderItems(messages, null, myPeerId)
    expect(items).toHaveLength(2)
    expect(items[0].message.id).toBe('img1')
    expect(items[0].extraImages.map(m => m.id)).toEqual(['img2'])
    expect(items[1].message.id).toBe('t1')
  })

  it('발신자가 다른 이미지는 그룹으로 묶이지 않고 각각 아이템이 된다', () => {
    const messages = [imageMsg('img1', 'peerA'), imageMsg('img2', 'peerB', 1)]
    const items = buildMessageRenderItems(messages, null, myPeerId)
    expect(items).toHaveLength(2)
    expect(items[0].extraImages).toBe(EMPTY_EXTRA_IMAGES)
    expect(items[1].extraImages).toBe(EMPTY_EXTRA_IMAGES)
  })

  it('단일 이미지는 그룹이 아니라 일반 아이템(EMPTY_EXTRA_IMAGES)으로 처리된다', () => {
    const items = buildMessageRenderItems([imageMsg('img1', 'peerA')], null, myPeerId)
    expect(items).toHaveLength(1)
    expect(items[0].extraImages).toBe(EMPTY_EXTRA_IMAGES)
  })

  it('snake_case(content_type/from_id) 필드도 그룹핑에 사용한다', () => {
    const base = new Date('2026-07-14T12:00:00').getTime()
    const messages = [
      { id: 'a', from_id: 'peerA', content_type: 'image', timestamp: base },
      { id: 'b', from_id: 'peerA', content_type: 'image', timestamp: base + 1000 },
    ]
    const items = buildMessageRenderItems(messages, null, myPeerId)
    expect(items).toHaveLength(1)
    expect(items[0].extraImages.map(m => m.id)).toEqual(['b'])
  })
})
