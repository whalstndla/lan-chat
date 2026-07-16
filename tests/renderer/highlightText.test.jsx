// tests/renderer/highlightText.test.jsx
// 검색어 하이라이트 유틸(highlightText) 렌더 결과 테스트 — jsdom + React Testing Library.
import { render } from '@testing-library/react'
import { highlightText } from '../../src/utils/highlightText'

describe('highlightText', () => {
  it('query 가 없으면 원본 text 를 그대로 반환한다', () => {
    expect(highlightText('안녕하세요', '')).toBe('안녕하세요')
    expect(highlightText('안녕하세요', undefined)).toBe('안녕하세요')
  })

  it('text 가 문자열이 아니면 원본을 그대로 반환한다', () => {
    expect(highlightText(null, 'foo')).toBeNull()
    expect(highlightText(undefined, 'foo')).toBeUndefined()
  })

  it('일치하는 부분이 없으면 원본 text 를 그대로 반환한다', () => {
    expect(highlightText('안녕하세요', '없는단어')).toBe('안녕하세요')
  })

  it('일치하는 부분을 <mark> 로 감싸 렌더링한다', () => {
    const result = highlightText('hello world', 'world')
    const { container } = render(<div>{result}</div>)
    const mark = container.querySelector('mark')
    expect(mark).toBeInTheDocument()
    expect(mark).toHaveTextContent('world')
    expect(container).toHaveTextContent('hello world')
  })

  it('대소문자 구분 없이 매칭한다', () => {
    const result = highlightText('Hello World', 'WORLD')
    const { container } = render(<div>{result}</div>)
    expect(container.querySelector('mark')).toHaveTextContent('World')
  })

  it('정규식 특수문자가 포함된 검색어도 안전하게 처리한다', () => {
    const result = highlightText('a.b (c)', '(c)')
    const { container } = render(<div>{result}</div>)
    expect(container.querySelector('mark')).toHaveTextContent('(c)')
  })
})
