const { setDrawerExpanded } = require('../../electron/lanpet/drawerWindow')
function makeWindow() {
  let bounds = { x: 30, y: 50, width: 800, height: 600 }
  return { isDestroyed: () => false, isMaximized: () => false, isFullScreen: () => false, webContents: { getZoomFactor: () => 1 }, getBounds: () => ({ ...bounds }), setBounds: value => { bounds = value } }
}
test('expands down within the display and restores once', () => {
  const window = makeWindow()
  setDrawerExpanded(window, true, { y: 0, height: 800 })
  expect(window.getBounds()).toMatchObject({ y: 50, height: 750 })
  setDrawerExpanded(window, true, { y: 0, height: 800 })
  setDrawerExpanded(window, false)
  expect(window.getBounds().height).toBe(600)
})
test('does not overwrite a manual resize or resize a maximized window', () => {
  const window = makeWindow()
  setDrawerExpanded(window, true, { y: 0, height: 1200 })
  window.setBounds({ ...window.getBounds(), height: 950 })
  setDrawerExpanded(window, false)
  expect(window.getBounds().height).toBe(950)
  window.isMaximized = () => true
  setDrawerExpanded(window, true, { y: 0, height: 2000 })
  expect(window.getBounds().height).toBe(950)
})
