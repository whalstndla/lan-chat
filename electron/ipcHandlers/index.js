// electron/ipcHandlers/index.js
// 모든 IPC 핸들러를 한 곳에서 등록하는 진입점

const { registerAuthHandlers } = require('./auth')
const { registerUserHandlers } = require('./user')
const { registerPeerHandlers } = require('./peer')
const { registerMessageHandlers } = require('./message')
const { registerReadStatusHandlers } = require('./readStatus')
const { registerFileHandlers } = require('./file')
const { registerHistoryHandlers } = require('./history')
const { registerReactionHandlers } = require('./reaction')
const { registerSettingsHandlers } = require('./settings')
const { registerDataHandlers } = require('./data')
const { registerAppHandlers } = require('./app')

function registerAllIpcHandlers(ctx) {
  registerAuthHandlers(ctx)
  registerUserHandlers(ctx)
  registerPeerHandlers(ctx)
  registerMessageHandlers(ctx)
  registerReadStatusHandlers(ctx)
  registerFileHandlers(ctx)
  registerHistoryHandlers(ctx)
  registerReactionHandlers(ctx)
  registerSettingsHandlers(ctx)
  registerDataHandlers(ctx)
  registerAppHandlers(ctx)
}

module.exports = { registerAllIpcHandlers }
