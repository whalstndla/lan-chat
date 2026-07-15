// tests/utils/lastEditableMessage.test.js
// ↑ 키로 마지막 내 메시지 불러오기(#40)의 대상 판정 로직 단위 테스트.
// Message.jsx 수정 버튼 노출 조건과 동일 기준(내가 보낸 메시지 + pending 아님 + 텍스트)을
// 검증한다.
import { findLastEditableOwnMessage } from '../../src/utils/lastEditableMessage'

const ME = 'peer-me'
const OTHER = 'peer-other'

describe('findLastEditableOwnMessage', () => {
  it('메시지가 없으면 null 을 반환한다', () => {
    expect(findLastEditableOwnMessage([], ME)).toBeNull()
  })

  it('myPeerId 가 없으면 null 을 반환한다', () => {
    expect(findLastEditableOwnMessage([{ fromId: ME, contentType: 'text' }], null)).toBeNull()
  })

  it('내가 보낸 가장 최근 텍스트 메시지를 찾는다', () => {
    const messages = [
      { id: 1, fromId: ME, contentType: 'text', content: '첫번째' },
      { id: 2, fromId: OTHER, contentType: 'text', content: '상대방' },
      { id: 3, fromId: ME, contentType: 'text', content: '두번째' },
    ]
    expect(findLastEditableOwnMessage(messages, ME)?.id).toBe(3)
  })

  it('상대방 메시지가 마지막이면 그 이전의 내 메시지를 찾는다', () => {
    const messages = [
      { id: 1, fromId: ME, contentType: 'text' },
      { id: 2, fromId: OTHER, contentType: 'text' },
    ]
    expect(findLastEditableOwnMessage(messages, ME)?.id).toBe(1)
  })

  it('내가 보낸 메시지가 없으면 null 을 반환한다', () => {
    const messages = [
      { id: 1, fromId: OTHER, contentType: 'text' },
      { id: 2, fromId: OTHER, contentType: 'text' },
    ]
    expect(findLastEditableOwnMessage(messages, ME)).toBeNull()
  })

  it('pending(전송 중) 메시지는 건너뛴다', () => {
    const messages = [
      { id: 1, fromId: ME, contentType: 'text' },
      { id: 2, fromId: ME, contentType: 'text', pending: true },
    ]
    expect(findLastEditableOwnMessage(messages, ME)?.id).toBe(1)
  })

  it('이미지/파일 등 텍스트가 아닌 메시지는 건너뛴다', () => {
    const messages = [
      { id: 1, fromId: ME, contentType: 'text' },
      { id: 2, fromId: ME, contentType: 'image' },
      { id: 3, fromId: ME, contentType: 'file' },
    ]
    expect(findLastEditableOwnMessage(messages, ME)?.id).toBe(1)
  })

  it('contentType 이 없는 메시지(구버전 텍스트 메시지)는 텍스트로 취급한다', () => {
    const messages = [{ id: 1, fromId: ME }]
    expect(findLastEditableOwnMessage(messages, ME)?.id).toBe(1)
  })

  it('from_id/content_type(snake_case) 필드도 지원한다', () => {
    const messages = [{ id: 1, from_id: ME, content_type: 'text' }]
    expect(findLastEditableOwnMessage(messages, ME)?.id).toBe(1)
  })

  it('null/undefined 항목이 섞여 있어도 안전하게 처리한다', () => {
    const messages = [null, undefined, { id: 1, fromId: ME, contentType: 'text' }]
    expect(findLastEditableOwnMessage(messages, ME)?.id).toBe(1)
  })
})
