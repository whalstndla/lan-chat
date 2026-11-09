import MarkdownIt from 'markdown-it'

const markdownParser = new MarkdownIt({ html: false, linkify: true })

// 마크다운의 구분 문자는 주소가 아니므로 링크 토큰의 실제 목적지만 사용한다.
export function extractFirstMessageUrl(content, format) {
  if (!content) return null
  if (format !== 'markdown') {
    const link = markdownParser.linkify.match(content)?.find(candidate => /^https?:\/\//i.test(candidate.url))
    return link?.url || null
  }
  for (const block of markdownParser.parse(content, {})) {
    for (const token of block.children || []) {
      if (token.type !== 'link_open') continue
      const url = token.attrGet('href')
      if (/^https?:\/\//i.test(url || '')) return url
    }
  }
  return null
}

// 일반 텍스트는 원문을 유지하면서 실제 링크 범위만 클릭 가능하게 만든다.
export function findTextLinks(content) {
  return (markdownParser.linkify.match(content) || []).filter(link => /^https?:\/\//i.test(link.url))
}
