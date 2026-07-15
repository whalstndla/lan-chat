// tests/utils/fontScale.test.js
// 폰트 크기 프리셋 → 배율 매핑 + 클램프 순수 로직 검증(#73).
// applyFontScaleToDocument 는 DOM 이 없는 jest(node) 환경에서도 안전해야 한다.

const {
  FONT_SIZE_OPTIONS,
  DEFAULT_FONT_SIZE,
  fontSizeToScale,
  clampFontScale,
  applyFontScaleToDocument,
} = require('../../src/utils/fontScale')

describe('fontSizeToScale', () => {
  it('기본 크기는 medium(배율 1) 이다', () => {
    expect(DEFAULT_FONT_SIZE).toBe('medium')
    expect(FONT_SIZE_OPTIONS).toEqual(['small', 'medium', 'large'])
    expect(fontSizeToScale('medium')).toBe(1)
  })

  it('작게/크게 프리셋은 각각 1보다 작거나 큰 배율을 반환한다', () => {
    expect(fontSizeToScale('small')).toBeLessThan(1)
    expect(fontSizeToScale('large')).toBeGreaterThan(1)
  })

  it('알 수 없거나 손상된 프리셋 값은 medium(1) 로 폴백한다', () => {
    expect(fontSizeToScale('corrupted-value')).toBe(1)
    expect(fontSizeToScale(undefined)).toBe(1)
  })
})

describe('clampFontScale', () => {
  it('허용 범위 내 숫자는 그대로 반환한다', () => {
    expect(clampFontScale(1)).toBe(1)
    expect(clampFontScale(0.9)).toBe(0.9)
    expect(clampFontScale(1.15)).toBe(1.15)
  })

  it('허용 범위를 벗어나면 상/하한으로 클램프한다', () => {
    expect(clampFontScale(0.1)).toBeGreaterThanOrEqual(0.8)
    expect(clampFontScale(5)).toBeLessThanOrEqual(1.4)
  })

  it('숫자로 변환할 수 없는 값은 기본 배율(1) 로 폴백한다', () => {
    expect(clampFontScale('abc')).toBe(1)
    expect(clampFontScale(undefined)).toBe(1)
    expect(clampFontScale(NaN)).toBe(1)
  })
})

describe('applyFontScaleToDocument', () => {
  it('document 가 없는 환경(jest node)에서도 예외 없이 안전하게 무시한다', () => {
    expect(() => applyFontScaleToDocument(1.15)).not.toThrow()
  })
})
