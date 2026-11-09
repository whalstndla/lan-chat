const MarkdownIt = require('markdown-it')

const markdownParser = new MarkdownIt({ html: false, linkify: false })

// OS 알림에는 렌더러가 표시하는 텍스트를 전달한다. 원본 메시지는 변경하지 않는다.
function notificationText(content, format) {
  if (format !== 'markdown' || !content) return content
  const fragments = []
  function collect(tokens) {
    for (const token of tokens) {
      if (token.children) collect(token.children)
      else if (['text', 'code_inline', 'code_block', 'fence'].includes(token.type)) fragments.push(token.content)
      if (token.type === 'softbreak' || token.type === 'hardbreak' || token.block) fragments.push(' ')
    }
  }
  collect(markdownParser.parse(content, {}))
  return fragments.join('').replace(/\s+/g, ' ').trim()
}

module.exports = { notificationText }
