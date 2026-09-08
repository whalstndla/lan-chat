// 확장 뒤 사용자가 직접 크기를 바꾼 창은 원래 크기로 덮어쓰지 않는다.
const expandedWindows = new WeakMap()
function setDrawerExpanded(window, expanded, workArea) {
  if (!window || window.isDestroyed()) return
  const previous = expandedWindows.get(window)
  if (!expanded) {
    expandedWindows.delete(window)
    if (!previous || window.isMaximized() || window.isFullScreen()) return
    const current = window.getBounds()
    if (current.height === previous.expandedHeight) window.setBounds({ ...current, height: previous.height })
    return
  }
  if (previous || window.isMaximized() || window.isFullScreen()) return
  const bounds = window.getBounds()
  const extra = Math.min(Math.round(260 * (window.webContents.getZoomFactor?.() || 1)), Math.max(0, workArea.y + workArea.height - bounds.y - bounds.height))
  if (extra <= 0) return
  window.setBounds({ ...bounds, height: bounds.height + extra })
  expandedWindows.set(window, { height: bounds.height, expandedHeight: window.getBounds().height })
}
module.exports = { setDrawerExpanded }
