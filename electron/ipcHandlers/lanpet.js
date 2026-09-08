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
    error: { code, message: '랜펫을 사용할 수 없어요. 로그인하거나 잠시 후 다시 시도해 주세요.' },
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
    if (!isTrustedSender(ctx, event)) return { ok: false, code: 'UNTRUSTED_SENDER', message: '이 창에서는 랜펫을 사용할 수 없어요.' }
    if (!hasOpenSession(ctx)) return { ok: false, code: 'SESSION_CLOSED', message: '다시 로그인해 주세요.' }
    if (!commandIsValid(command)) return { ok: false, code: 'INVALID_COMMAND', message: '랜펫 요청이 올바르지 않아요.' }
    const sessionDatabase = ctx.state.database
    const sessionPeerId = ctx.state.peerId
    try {
      const result = await connectedService(ctx).command(command)
      // 비동기 명령 도중 로그아웃했다면 이전 계정의 스냅샷을 반환하지 않는다.
      if (!hasOpenSession(ctx) || ctx.state.database !== sessionDatabase || ctx.state.peerId !== sessionPeerId) {
        return { ok: false, code: 'SESSION_CLOSED', message: '다시 로그인해 주세요.' }
      }
      return result
    } catch {
      return { ok: false, code: 'LANPET_UNAVAILABLE', message: '랜펫 활동을 마치지 못했어요. 다시 시도해 주세요.' }
    }
  })
}

module.exports = { registerLanpetHandlers, isTrustedSender, commandIsValid }
