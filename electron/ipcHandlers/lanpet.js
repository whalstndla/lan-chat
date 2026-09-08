const { ipcMain } = require('electron')
const { getLanpetService } = require('../lanpet/service')

const COMMAND_TYPES = new Set(['create', 'care', 'grow', 'settings', 'delete', 'invite', 'respond', 'action', 'end'])
const MAX_COMMAND_BYTES = 16 * 1024
const bridgedServices = new WeakSet()

function connectedService(ctx) {
  const service = getLanpetService(ctx)
  if (bridgedServices.has(service)) return service
  bridgedServices.add(service)
  const sessionDatabase = ctx.state.database
  const sessionPeerId = ctx.state.peerId
  let scheduled = false
  service.subscribe(() => {
    if (scheduled) return
    scheduled = true
    // 중첩 트랜잭션이 끝난 뒤 확정된 스냅샷만 전송하고 같은 턴의 변경을 합친다.
    queueMicrotask(() => {
      scheduled = false
      if (!hasOpenSession(ctx) || ctx.state.database !== sessionDatabase || ctx.state.peerId !== sessionPeerId) return
      const mainWindow = ctx.state.mainWindow
      if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return
      try {
        mainWindow.webContents.send('lanpet:changed', service.getSnapshot())
      } catch { /* 잠금·종료와 경합하면 이전 계정의 이벤트를 보내지 않는다. */ }
    })
  })
  return service
}

// 인증된 주 창의 최상위 프레임만 펫 데이터와 명령에 접근할 수 있다.
function isTrustedSender(ctx, event) {
  const mainWindow = ctx.state.mainWindow
  if (!mainWindow || mainWindow.isDestroyed()) return false
  const webContents = mainWindow.webContents
  return !webContents.isDestroyed()
    && event?.sender === webContents
    && !!event.senderFrame
    && event.senderFrame === webContents.mainFrame
}

function hasOpenSession(ctx) {
  return !!ctx.state.database && !!ctx.state.peerId && !!ctx.state.masterKey && !ctx.state.isSessionClosing
}

function commandIsValid(command) {
  if (!command || typeof command !== 'object' || Array.isArray(command)) return false
  if (!COMMAND_TYPES.has(command.type)) return false
  try {
    return Buffer.byteLength(JSON.stringify(command), 'utf8') <= MAX_COMMAND_BYTES
  } catch {
    return false
  }
}

function unavailableSnapshot(code) {
  return {
    enabled: false,
    sharingEnabled: false,
    isWorkingTime: false,
    pet: null,
    peers: [],
    invitations: [],
    sessions: [],
    history: [],
    inventory: [],
    error: { code, message: 'Lanpet is unavailable. Please sign in or try again.' },
  }
}

function registerLanpetHandlers(ctx) {
  ipcMain.handle('lanpet:get-snapshot', (event) => {
    if (!isTrustedSender(ctx, event)) return unavailableSnapshot('UNTRUSTED_SENDER')
    if (!hasOpenSession(ctx)) return unavailableSnapshot('SESSION_CLOSED')
    try {
      return connectedService(ctx).getSnapshot()
    } catch {
      // 펫 초기화나 마이그레이션 실패가 기존 채팅 초기화를 중단하지 않게 한다.
      return unavailableSnapshot('LANPET_UNAVAILABLE')
    }
  })

  ipcMain.handle('lanpet:command', async (event, command) => {
    if (!isTrustedSender(ctx, event)) return { ok: false, code: 'UNTRUSTED_SENDER', message: 'This window cannot access Lanpet.' }
    if (!hasOpenSession(ctx)) return { ok: false, code: 'SESSION_CLOSED', message: 'Please sign in again.' }
    if (!commandIsValid(command)) return { ok: false, code: 'INVALID_COMMAND', message: 'This Lanpet command is invalid.' }
    const sessionDatabase = ctx.state.database
    const sessionPeerId = ctx.state.peerId
    try {
      const result = await connectedService(ctx).command(command)
      // 비동기 명령 도중 로그아웃했다면 이전 계정의 스냅샷을 반환하지 않는다.
      if (!hasOpenSession(ctx) || ctx.state.database !== sessionDatabase || ctx.state.peerId !== sessionPeerId) {
        return { ok: false, code: 'SESSION_CLOSED', message: 'Please sign in again.' }
      }
      return result
    } catch {
      return { ok: false, code: 'LANPET_UNAVAILABLE', message: 'Lanpet could not finish this action. Please try again.' }
    }
  })
}

module.exports = { registerLanpetHandlers, isTrustedSender, commandIsValid }
