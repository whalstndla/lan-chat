// src/utils/clipboard.js
// 클립보드 복사 공용 유틸 — 렌더러(Electron BrowserWindow)에서 navigator.clipboard 사용.
// 실패해도 조용히 무시하지 않고 최소한 콘솔 경고를 남긴다.
export async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text ?? '')
    return true
  } catch (err) {
    console.warn('[클립보드 복사 실패]', err)
    return false
  }
}
