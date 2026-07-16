// tailwind.config.js
module.exports = {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // 색상값을 CSS 변수(src/index.css 의 :root / [data-theme="light"])로 위임한다.
        // 'rgb(var(--x) / <alpha-value>)' 형식은 Tailwind 공식 CSS-변수 컬러 패턴 —
        // bg-vsc-accent/20 같은 기존 opacity 모디파이어 사용처(하이라이트, 배지 등)가
        // 계속 정상 동작하려면 변수가 "R, G, B" 채널값이어야 하고(hex 문자열이면 안 됨),
        // <alpha-value> 자리에 Tailwind 가 모디파이어 값을 주입한다. 다크(:root) 기본값은
        // 아래 index.css 에 기존 16진값과 동일한 RGB로 정의되어 있어 렌더 결과는 그대로다.
        'vsc-bg':        'rgb(var(--vsc-bg) / <alpha-value>)',
        'vsc-sidebar':   'rgb(var(--vsc-sidebar) / <alpha-value>)',
        'vsc-panel':     'rgb(var(--vsc-panel) / <alpha-value>)',
        'vsc-border':    'rgb(var(--vsc-border) / <alpha-value>)',
        'vsc-text':      'rgb(var(--vsc-text) / <alpha-value>)',
        'vsc-muted':     'rgb(var(--vsc-muted) / <alpha-value>)',
        'vsc-accent':    'rgb(var(--vsc-accent) / <alpha-value>)',
        'vsc-selected':  'rgb(var(--vsc-selected) / <alpha-value>)',
        'vsc-hover':     'rgb(var(--vsc-hover) / <alpha-value>)',
      }
    }
  },
  plugins: []
}
