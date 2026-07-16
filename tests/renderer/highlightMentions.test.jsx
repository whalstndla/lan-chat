// tests/renderer/highlightMentions.test.jsx
// 멘션("@닉네임") 하이라이트 유틸(highlightMentions) 렌더 결과 테스트.
import { render } from '@testing-library/react'
import { highlightMentions } from '../../src/utils/highlightMentions'

describe('highlightMentions', () => {
  it('멘션 목록이 비어있으면 원본 text 를 그대로 반환한다', () => {
    expect(highlightMentions('hello @world', [])).toBe('hello @world')
    expect(highlightMentions('hello @world', undefined)).toBe('hello @world')
  })

  it('text 가 문자열이 아니면 원본을 그대로 반환한다', () => {
    expect(highlightMentions(null, ['홍길동'])).toBeNull()
  })

  it('일치하는 멘션이 없으면 원본 text 를 그대로 반환한다', () => {
    expect(highlightMentions('hello world', ['홍길동'])).toBe('hello world')
  })

  it('일치하는 "@닉네임"을 배지(span)로 감싸 렌더링한다', () => {
    const result = highlightMentions('hi @홍길동 how are you', ['홍길동'])
    const { container } = render(<div>{result}</div>)
    const badge = container.querySelector('span')
    expect(badge).toBeInTheDocument()
    expect(badge).toHaveTextContent('@홍길동')
    expect(container).toHaveTextContent('hi @홍길동 how are you')
  })

  it('짧은 닉네임이 긴 닉네임의 부분 문자열이어도 최장일치로 매칭한다', () => {
    const result = highlightMentions('@길동이 님 안녕', ['길동', '길동이'])
    const { container } = render(<div>{result}</div>)
    const badge = container.querySelector('span')
    expect(badge).toHaveTextContent('@길동이')
  })
})
