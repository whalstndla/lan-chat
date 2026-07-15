// tests/utils/exportFormatter.test.js
// 채팅 내보내기(#74) 포맷팅 순수 로직 단위 테스트 — Electron 런타임 불필요.
const {
  formatTimestamp, formatMessageLine, formatMessagesAsText, formatMessageForJson,
} = require('../../electron/utils/exportFormatter')

describe('formatTimestamp', () => {
  it('ms 타임스탬프를 "YYYY-MM-DD HH:mm:ss" 로 포맷한다', () => {
    const date = new Date(2026, 0, 5, 9, 3, 7) // 2026-01-05 09:03:07 (로컬)
    expect(formatTimestamp(date.getTime())).toBe('2026-01-05 09:03:07')
  })

  it('한 자리 월/일/시/분/초는 0으로 패딩된다', () => {
    const date = new Date(2026, 8, 1, 1, 1, 1) // 2026-09-01 01:01:01
    expect(formatTimestamp(date.getTime())).toBe('2026-09-01 01:01:01')
  })
})

describe('formatMessageLine', () => {
  it('텍스트 메시지는 "시각 발신자: 내용" 형식으로 포맷한다', () => {
    const timestamp = new Date(2026, 0, 1, 12, 0, 0).getTime()
    const line = formatMessageLine({ timestamp, from_name: '홍길동', content: '안녕하세요' })
    expect(line).toBe('2026-01-01 12:00:00 홍길동: 안녕하세요')
  })

  it('content 가 없고 파일명이 있으면 [파일: 이름] 으로 대체 표시한다', () => {
    const timestamp = new Date(2026, 0, 1, 12, 0, 0).getTime()
    const line = formatMessageLine({ timestamp, from_name: '홍길동', content: null, file_name: '사진.jpg' })
    expect(line).toBe('2026-01-01 12:00:00 홍길동: [파일: 사진.jpg]')
  })

  it('camelCase 필드(fromName/fileName) 로도 동작한다 (decryptDMRecord 결과 호환)', () => {
    const timestamp = new Date(2026, 0, 1, 12, 0, 0).getTime()
    const line = formatMessageLine({ timestamp, fromName: '상대', content: null, fileName: '문서.pdf' })
    expect(line).toBe('2026-01-01 12:00:00 상대: [파일: 문서.pdf]')
  })

  it('content 도 파일명도 없으면 [내용 없음] 을 표시한다', () => {
    const timestamp = new Date(2026, 0, 1, 12, 0, 0).getTime()
    const line = formatMessageLine({ timestamp, from_name: '홍길동', content: null })
    expect(line).toBe('2026-01-01 12:00:00 홍길동: [내용 없음]')
  })

  it('발신자 이름이 없으면 "알 수 없음" 으로 표시한다', () => {
    const timestamp = new Date(2026, 0, 1, 12, 0, 0).getTime()
    expect(formatMessageLine({ timestamp, content: '내용' })).toBe('2026-01-01 12:00:00 알 수 없음: 내용')
  })

  it('수정된 메시지는 "(수정됨)" 접미사가 붙는다', () => {
    const timestamp = new Date(2026, 0, 1, 12, 0, 0).getTime()
    const line = formatMessageLine({ timestamp, from_name: '홍길동', content: '수정본', edited_at: Date.now() })
    expect(line).toBe('2026-01-01 12:00:00 홍길동: 수정본 (수정됨)')
  })
})

describe('formatMessagesAsText', () => {
  it('메시지 배열을 줄바꿈으로 이어붙인다', () => {
    const t1 = new Date(2026, 0, 1, 9, 0, 0).getTime()
    const t2 = new Date(2026, 0, 1, 9, 1, 0).getTime()
    const text = formatMessagesAsText([
      { timestamp: t1, from_name: 'A', content: '첫번째' },
      { timestamp: t2, from_name: 'B', content: '두번째' },
    ])
    expect(text).toBe('2026-01-01 09:00:00 A: 첫번째\n2026-01-01 09:01:00 B: 두번째')
  })

  it('빈 배열은 빈 문자열을 반환한다', () => {
    expect(formatMessagesAsText([])).toBe('')
  })
})

describe('formatMessageForJson', () => {
  it('DB 원본 컬럼(snake_case)을 일관된 camelCase 필드로 변환한다', () => {
    const timestamp = 1700000000000
    const result = formatMessageForJson({
      id: 'msg-1', timestamp, from_name: '홍길동', from_id: 'peer-1',
      content: '안녕', content_type: 'text', file_name: null, edited_at: null,
    })
    expect(result).toEqual({
      id: 'msg-1',
      timestamp,
      time: formatTimestamp(timestamp),
      from: '홍길동',
      fromId: 'peer-1',
      content: '안녕',
      contentType: 'text',
      fileName: null,
      edited: false,
    })
  })

  it('content_type 미지정 시 기본값 text 를 사용한다', () => {
    const result = formatMessageForJson({ id: 'm', timestamp: 1, content: '내용' })
    expect(result.contentType).toBe('text')
  })

  it('edited_at 이 있으면 edited: true', () => {
    const result = formatMessageForJson({ id: 'm', timestamp: 1, content: '내용', edited_at: 12345 })
    expect(result.edited).toBe(true)
  })

  it('camelCase 필드(decryptDMRecord 결과)로도 동작한다', () => {
    const result = formatMessageForJson({
      id: 'dm-1', timestamp: 1, fromName: '상대', fromId: 'peer-2',
      content: null, contentType: 'image', fileName: '사진.png',
    })
    expect(result).toMatchObject({ from: '상대', fromId: 'peer-2', contentType: 'image', fileName: '사진.png' })
  })
})
