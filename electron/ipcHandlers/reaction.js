// electron/ipcHandlers/reaction.js
// 이모지 리액션 관련 IPC 핸들러 — 토글, 일괄 조회

const { ipcMain } = require('electron')
const { addReaction, removeReaction, getReactions, getReactionsByMessageIds } = require('../storage/queries')
const { sendPeerMessage, broadcastPeerMessage } = require('../utils/appUtils')

function registerReactionHandlers(ctx) {
  // 이모지 리액션 토글 — 이미 존재하면 제거, 없으면 추가
  ipcMain.handle('toggle-reaction', (_, { messageId, emoji, targetPeerId }) => {
    const existing = getReactions(ctx.state.database, messageId)
      .find(r => r.peer_id === ctx.state.peerId && r.emoji === emoji)
    const action = existing ? 'remove' : 'add'
    if (action === 'add') addReaction(ctx.state.database, { messageId, peerId: ctx.state.peerId, emoji })
    else removeReaction(ctx.state.database, { messageId, peerId: ctx.state.peerId, emoji })

    const reactionMessage = {
      type: 'reaction', messageId, fromId: ctx.state.peerId, emoji, action, timestamp: Date.now(),
    }
    if (targetPeerId) sendPeerMessage(ctx, targetPeerId, reactionMessage)
    else broadcastPeerMessage(ctx, reactionMessage)
    return { action }
  })

  // 여러 메시지의 리액션 일괄 조회 — { messageId: [row, ...] } 형태 반환
  ipcMain.handle('get-reactions', (_, messageIds) => {
    return getReactionsByMessageIds(ctx.state.database, messageIds)
  })
}

module.exports = { registerReactionHandlers }
