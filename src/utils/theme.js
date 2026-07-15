// src/utils/theme.js
// 테마 설정(THEME_OPTIONS) → 실제 렌더링에 쓸 dark/light 판정 + DOM 반영을 담당한다.
// resolveTheme 은 순수 함수(테스트 용이), applyThemeToDocument 만 DOM 부수효과를 가진다.

export const THEME_OPTIONS = ['dark', 'light', 'system']
export const DEFAULT_THEME = 'dark'

// themeSetting(사용자 선택값)과 시스템 다크모드 선호 여부(prefersDark)를 받아
// 실제로 렌더링할 테마('dark' | 'light')를 계산한다.
// 'system' 이 아니면 선택값을 그대로 쓰고, 알 수 없는 값(손상된 저장값 등)은 항상
// 다크로 폴백한다 — 다크가 이 앱의 기본 테마라는 불변식을 여기서도 지킨다.
export function resolveTheme(themeSetting, prefersDark) {
  if (themeSetting === 'system') return prefersDark ? 'dark' : 'light'
  if (themeSetting === 'light') return 'light'
  return 'dark'
}

// 문서 루트(html)의 data-theme 속성을 갱신한다. CSS 는 [data-theme="light"] 선택자로만
// 라이트 팔레트를 오버라이드하므로, data-theme 이 없거나 'dark' 인 경우 항상 다크 변수값이 적용된다.
export function applyThemeToDocument(resolvedTheme) {
  if (typeof document === 'undefined') return // 테스트(node) 등 DOM 없는 환경에서는 무시
  document.documentElement.setAttribute('data-theme', resolvedTheme)
}
