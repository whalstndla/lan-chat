// src/utils/fontScale.js
// 폰트 크기 설정(작게/보통/크게) → 루트 font-size 배율(--app-font-scale) 매핑 + DOM 반영.
// Tailwind 의 text-xs/text-sm 등은 rem 기반이라, html 의 font-size 를 이 배율만큼 조정하면
// 컴포넌트 코드를 건드리지 않고도 채팅 텍스트를 포함한 전체 UI 글자 크기가 함께 스케일된다.

export const FONT_SIZE_OPTIONS = ['small', 'medium', 'large']
export const DEFAULT_FONT_SIZE = 'medium'

const FONT_SCALE_BY_SIZE = {
  small: 0.9,
  medium: 1,
  large: 1.15,
}

// 스케일이 벗어날 수 있는 하한/상한 — 저장값 손상, 향후 슬라이더 UI 도입 등에 대비한 방어선.
const MIN_FONT_SCALE = 0.8
const MAX_FONT_SCALE = 1.4

// 프리셋 이름 → 배율. 알 수 없는 값(손상된 저장값 등)은 '보통'(1) 으로 폴백한다.
export function fontSizeToScale(fontSize) {
  return FONT_SCALE_BY_SIZE[fontSize] ?? FONT_SCALE_BY_SIZE[DEFAULT_FONT_SIZE]
}

// 임의의 숫자 배율을 [MIN_FONT_SCALE, MAX_FONT_SCALE] 범위로 클램프한다.
// 숫자로 변환할 수 없으면 기본 배율(1)로 폴백한다.
export function clampFontScale(scale) {
  const numeric = Number(scale)
  if (!Number.isFinite(numeric)) return FONT_SCALE_BY_SIZE[DEFAULT_FONT_SIZE]
  return Math.min(MAX_FONT_SCALE, Math.max(MIN_FONT_SCALE, numeric))
}

// 문서 루트(html)에 --app-font-scale CSS 변수를 반영한다. 클램프를 거쳐 항상 안전한 값만 쓴다.
export function applyFontScaleToDocument(scale) {
  if (typeof document === 'undefined') return // 테스트(node) 등 DOM 없는 환경에서는 무시
  document.documentElement.style.setProperty('--app-font-scale', String(clampFontScale(scale)))
}
