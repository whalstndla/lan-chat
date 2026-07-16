// vite.config.js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 개발 서버(vite serve) 에서만 CSP 를 완화하는 플러그인.
// index.html 의 CSP 는 프로덕션(file://) 기준으로 엄격하게 잡혀 있는데,
// dev 는 @vitejs/plugin-react 가 <head> 상단에 인라인 refresh preamble 스크립트를
// 주입하고 HMR 이 WebSocket(ws://localhost)으로 통신하기 때문에 그대로 두면 앱이 뜨지 않는다.
// 따라서 serve 모드일 때만 meta 의 CSP 를 완화한 값으로 교체한다.
// (apply: 'serve' 이므로 vite build 산출물에는 전혀 영향이 없다 — 프로덕션은 엄격 유지.)
function devRelaxCspPlugin() {
  // 프로덕션 대비 완화점:
  //   script-src 에 'unsafe-inline'  → 인라인 refresh preamble 허용
  //   connect-src 에 ws:/http:       → HMR WebSocket + 모듈 리로드 허용
  const devCsp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-eval' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: lanchat: http: https:",
    "media-src 'self' data: blob: lanchat:",
    "font-src 'self' data:",
    "connect-src 'self' data: blob: lanchat: ws: http:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ')

  return {
    name: 'dev-relax-csp',
    apply: 'serve',
    transformIndexHtml(html) {
      // index.html 의 CSP meta 태그를 dev 완화 버전으로 치환 (content 만 교체).
      return html.replace(
        /<meta\s+http-equiv="Content-Security-Policy"[^>]*>/i,
        `<meta http-equiv="Content-Security-Policy" content="${devCsp}" />`
      )
    },
  }
}

export default defineConfig({
  plugins: [react(), devRelaxCspPlugin()],
  base: './',
  build: {
    outDir: 'dist/renderer',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/react') || id.includes('node_modules/scheduler')) {
            return 'vendor-react'
          }
          if (id.includes('node_modules/emoji-picker-react') || id.includes('node_modules/emoji-datasource')) {
            return 'vendor-emoji'
          }
        },
      },
    },
  },
})
