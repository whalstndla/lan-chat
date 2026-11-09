const { extractFirstMessageUrl, findTextLinks } = require('../../src/utils/messageLinks')

describe('message URL extraction', () => {
  test.each([
    ['<https://example.com/path>', 'https://example.com/path'],
    ['[Read more](https://example.com/path "Title")', 'https://example.com/path'],
    ['[Article](https://example.com/wiki/Test_(example))', 'https://example.com/wiki/Test_(example)'],
    ['[Search](https://example.com/search?q=a&amp;page=2)', 'https://example.com/search?q=a&page=2'],
    ['<https://example.com/search?q=a&amp;page=2>', 'https://example.com/search?q=a&amp;page=2'],
    ['See https://example.com/path.', 'https://example.com/path'],
    ['`https://example.com/code`', null],
    ['[unsafe](javascript:alert(1))', null],
    ['![image](https://example.com/image.png)', null],
  ])('extracts the actual destination from %s', (content, expected) => {
    expect(extractFirstMessageUrl(content, 'markdown')).toBe(expected)
  })

  test('excludes closing angle brackets from legacy plain text links', () => {
    const content = 'See <https://example.com/path> now'
    const [link] = findTextLinks(content)
    expect(link.url).toBe('https://example.com/path')
    expect(content.slice(link.index, link.lastIndex)).toBe(link.url)
  })
})
