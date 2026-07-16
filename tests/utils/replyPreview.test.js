// tests/utils/replyPreview.test.js
// 답장/인용(#28) 미리보기 스냅샷 생성/정규화 순수 로직 단위 테스트.
import { buildReplyPreview, parseReplyPreview, REPLY_SNIPPET_MAX_LENGTH } from '../../src/utils/replyPreview'

describe('buildReplyPreview', () => {
  it('메시지가 없으면 null 을 반환한다', () => {
    expect(buildReplyPreview(null)).toBeNull()
  })

  it('텍스트 메시지의 fromName + 내용을 스냅샷으로 만든다 (camelCase)', () => {
    const preview = buildReplyPreview({ from: '홍길동', contentType: 'text', content: '안녕하세요' })
    expect(preview).toEqual({ fromName: '홍길동', snippet: '안녕하세요' })
  })

  it('DB snake_case 키(from_name/content_type)도 처리한다', () => {
    const preview = buildReplyPreview({ from_name: '김철수', content_type: 'text', content: '반가워요' })
    expect(preview).toEqual({ fromName: '김철수', snippet: '반가워요' })
  })

  it('긴 내용은 최대 길이에서 잘리고 말줄임표가 붙는다', () => {
    const long = 'a'.repeat(REPLY_SNIPPET_MAX_LENGTH + 20)
    const preview = buildReplyPreview({ from: 'A', content: long })
    expect(preview.snippet).toBe(`${'a'.repeat(REPLY_SNIPPET_MAX_LENGTH)}…`)
  })

  it('정확히 최대 길이인 내용은 자르지 않는다', () => {
    const exact = 'b'.repeat(REPLY_SNIPPET_MAX_LENGTH)
    const preview = buildReplyPreview({ from: 'A', content: exact })
    expect(preview.snippet).toBe(exact)
  })

  it('이미지 메시지는 "사진" 으로 표시한다', () => {
    expect(buildReplyPreview({ from: 'A', contentType: 'image' }).snippet).toBe('사진')
  })

  it('동영상 메시지는 "동영상" 으로 표시한다', () => {
    expect(buildReplyPreview({ from: 'A', contentType: 'video' }).snippet).toBe('동영상')
  })

  it('파일 메시지는 파일명과 함께 표시한다', () => {
    expect(buildReplyPreview({ from: 'A', contentType: 'file', fileName: 'doc.pdf' }).snippet).toBe('📎 doc.pdf')
  })

  it('발신자 이름이 없으면 "알 수 없음" 으로 대체한다', () => {
    expect(buildReplyPreview({ content: 'x' }).fromName).toBe('알 수 없음')
  })
})

describe('parseReplyPreview', () => {
  it('falsy 값은 null 을 반환한다', () => {
    expect(parseReplyPreview(null)).toBeNull()
    expect(parseReplyPreview(undefined)).toBeNull()
    expect(parseReplyPreview('')).toBeNull()
  })

  it('객체는 그대로 반환한다 (라이브 경로)', () => {
    const obj = { fromName: '홍길동', snippet: 'hi' }
    expect(parseReplyPreview(obj)).toBe(obj)
  })

  it('JSON 문자열은 파싱해 객체로 반환한다 (DB/히스토리 경로)', () => {
    const raw = JSON.stringify({ fromName: '김철수', snippet: '테스트' })
    expect(parseReplyPreview(raw)).toEqual({ fromName: '김철수', snippet: '테스트' })
  })

  it('깨진 JSON 문자열은 null 을 반환한다', () => {
    expect(parseReplyPreview('{not json')).toBeNull()
  })
})
