// 실제 Electron·preload·IPC·암호화 DB를 사용하되 테스트 프로필과 발견 광고를 격리한다.
const { app } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const readline = require('node:readline')

// 테스트 프로세스 안에서만 시간을 조절한다. OS 시계와 제품 코드는 변경하지 않는다.
const realDateNow = Date.now.bind(Date)
let clockOffset = 0
Date.now = () => realDateNow() + clockOffset

const profileDirectory = process.argv[2]
if (!profileDirectory || !path.isAbsolute(profileDirectory)) throw new Error('A temporary profile directory is required.')
fs.mkdirSync(profileDirectory, { recursive: true })
app.setPath('userData', profileDirectory)
app.setAppPath(path.resolve(__dirname, '../..'))

// 회사 LAN의 실제 사용자에게 QA 계정이 광고되거나 채팅이 동기화되지 않게 한다.
const discovery = require('../../electron/peer/discovery')
discovery.startPeerDiscovery = async () => {}
discovery.stopPeerDiscovery = async () => {}
discovery.republishService = async () => {}
const broadcast = require('../../electron/peer/broadcastDiscovery')
broadcast.startBroadcastDiscovery = () => {}
broadcast.stopBroadcastDiscovery = () => {}

let context
const contextModule = require('../../electron/context')
const createAppContext = contextModule.createAppContext
contextModule.createAppContext = (configuration) => {
  context = createAppContext(configuration)
  return context
}

let mainWindow
function respond(payload) {
  process.stdout.write(`LANPET_QA:${JSON.stringify(payload)}\n`)
}

app.on('browser-window-created', (_, window) => {
  if (mainWindow) return
  mainWindow = window
  window.webContents.once('did-finish-load', () => respond({ ready: true }))
  window.webContents.on('render-process-gone', (_, details) => respond({ rendererGone: details.reason }))
})

const input = readline.createInterface({ input: process.stdin })
input.on('line', async (line) => {
  let request
  try {
    request = JSON.parse(line)
    let result
    if (request.operation === 'evaluate') {
      result = await mainWindow.webContents.executeJavaScript(request.expression, true)
    } else if (request.operation === 'capture') {
      const screenshot = await mainWindow.webContents.capturePage()
      fs.writeFileSync(request.path, screenshot.toPNG())
      result = { path: request.path }
    } else if (request.operation === 'resize') {
      mainWindow.setSize(request.width, request.height)
      if (Number.isInteger(request.x) && Number.isInteger(request.y)) mainWindow.setPosition(request.x, request.y)
      result = true
    } else if (request.operation === 'bounds') {
      const bounds = mainWindow.getBounds()
      result = { ...bounds, workArea: require('electron').screen.getDisplayMatching(bounds).workArea }
    } else if (request.operation === 'zoom') {
      mainWindow.webContents.setZoomFactor(request.factor)
      result = true
    } else if (request.operation === 'peerInfo') {
      result = { peerId: context.state.peerId, wsPort: context.state.wsServerInfo?.port }
    } else if (request.operation === 'clock') {
      if (Number.isFinite(request.timestamp)) clockOffset = request.timestamp - realDateNow()
      else if (Number.isFinite(request.advanceMs)) clockOffset += request.advanceMs
      else throw new Error('A clock timestamp or advanceMs is required.')
      await mainWindow.webContents.executeJavaScript(`(() => {
        window.__lanpetQaRealNow = window.__lanpetQaRealNow || Date.now.bind(Date);
        Date.now = () => window.__lanpetQaRealNow() + ${clockOffset};
      })()`)
      result = { timestamp: Date.now(), clockOffset }
    } else if (request.operation === 'key') {
      // 입력 큐가 처리되기 전에 다음 클릭이 앞서가 Escape가 새 창을 닫지 않게 한다.
      await mainWindow.webContents.executeJavaScript(`(() => {
        window.__lanpetQaKeyDelivered = new Promise(resolve => document.addEventListener('keyup', () => resolve(true), { once: true, capture: true }));
        return true;
      })()`)
      mainWindow.webContents.sendInputEvent({ type: 'keyDown', keyCode: request.key, modifiers: request.modifiers || [] })
      mainWindow.webContents.sendInputEvent({ type: 'keyUp', keyCode: request.key, modifiers: request.modifiers || [] })
      await mainWindow.webContents.executeJavaScript('window.__lanpetQaKeyDelivered')
      result = true
    } else if (request.operation === 'quit') {
      respond({ id: request.id, result: true })
      app.quit()
      return
    } else {
      throw new Error('Unsupported harness operation.')
    }
    respond({ id: request.id, result })
  } catch (error) {
    respond({ id: request?.id, error: error.message })
  }
})

require('../../electron/main')
