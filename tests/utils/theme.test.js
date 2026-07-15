// tests/utils/theme.test.js
// resolveTheme 순수 로직 + applyThemeToDocument 의 DOM-없는 환경(node) 안전성 검증(#73).
// 다크가 이 앱의 기본 테마라는 불변식(알 수 없는 값 → 항상 dark 폴백)을 핵심으로 확인한다.

const { THEME_OPTIONS, DEFAULT_THEME, resolveTheme, applyThemeToDocument } = require('../../src/utils/theme')

describe('resolveTheme', () => {
  it('기본 테마는 dark 이다', () => {
    expect(DEFAULT_THEME).toBe('dark')
    expect(THEME_OPTIONS).toEqual(['dark', 'light', 'system'])
  })

  it("themeSetting 이 'dark' 면 prefersDark 와 무관하게 dark 를 반환한다", () => {
    expect(resolveTheme('dark', true)).toBe('dark')
    expect(resolveTheme('dark', false)).toBe('dark')
  })

  it("themeSetting 이 'light' 면 prefersDark 와 무관하게 light 를 반환한다", () => {
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('light', false)).toBe('light')
  })

  it("themeSetting 이 'system' 이면 prefersDark 를 그대로 따른다", () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
  })

  it('알 수 없거나 손상된 값은 항상 dark 로 폴백한다(다크 기본 불변식)', () => {
    expect(resolveTheme(undefined, false)).toBe('dark')
    expect(resolveTheme(null, false)).toBe('dark')
    expect(resolveTheme('corrupted-value', false)).toBe('dark')
  })
})

describe('applyThemeToDocument', () => {
  it('document 가 없는 환경(jest node)에서도 예외 없이 안전하게 무시한다', () => {
    expect(() => applyThemeToDocument('light')).not.toThrow()
  })
})
