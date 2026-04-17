// electron/ipcHandlers/user.js
// 사용자 정보 관련 IPC 핸들러 — 내 정보, 닉네임 변경, 프로필 이미지, 상태 변경

const { ipcMain } = require('electron')
const path = require('path')
const fs = require('fs')
const { getProfile, updateNickname, updateProfileImage, updateStatus } = require('../storage/profile')
const { republishService } = require('../peer/discovery')
const { getFilePort } = require('../peer/fileServer')
const { buildMyProfileImageUrl, getMyAdvertisedAddresses, broadcastPeerMessage, getCurrentNicknameSafely } = require('../utils/appUtils')

function registerUserHandlers(ctx) {
  const profileFolderPath = path.join(ctx.config.appDataPath, 'profile')

  // 내 정보 조회 (프로필 닉네임 우선)
  ipcMain.handle('get-my-info', () => ({
    peerId: ctx.state.peerId,
    nickname: getCurrentNicknameSafely(ctx),
    profileImageUrl: buildMyProfileImageUrl(ctx),
  }))

  // 닉네임 변경
  ipcMain.handle('update-nickname', async (_, newNickname) => {
    if (!newNickname?.trim()) return { success: false, error: '닉네임을 입력해주세요.' }
    if (newNickname.trim().length > 30) return { success: false, error: '닉네임은 30자 이하여야 합니다.' }
    try {
      updateNickname(ctx.state.database, newNickname.trim())
      await republishService({
        nickname: newNickname.trim(),
        peerId: ctx.state.peerId,
        wsPort: ctx.state.wsServerInfo?.port ?? 0,
        filePort: getFilePort(),
        advertisedAddresses: getMyAdvertisedAddresses(ctx),
      })
      broadcastPeerMessage(ctx, {
        type: 'nickname-changed',
        fromId: ctx.state.peerId,
        nickname: newNickname.trim(),
        timestamp: Date.now(),
      })
      return { success: true }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  // 프로필 이미지 저장 — 항상 avatar.png로 저장
  ipcMain.handle('save-profile-image', (_, imageBuffer) => {
    try {
      const imageName = 'avatar.png'
      const savePath = path.join(profileFolderPath, imageName)
      fs.writeFileSync(savePath, Buffer.from(new Uint8Array(imageBuffer)))
      updateProfileImage(ctx.state.database, imageName)
      const url = `http://${ctx.state.localIP}:${getFilePort()}/profile/${imageName}`
      return { success: true, url }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  // 상태 변경 — 허용된 타입만 저장 후 브로드캐스트
  ipcMain.handle('update-status', (_, { statusType, statusMessage }) => {
    const allowedTypes = ['online', 'away', 'busy', 'dnd']
    if (!allowedTypes.includes(statusType)) return
    updateStatus(ctx.state.database, { statusType, statusMessage: (statusMessage || '').slice(0, 100) })
    broadcastPeerMessage(ctx, {
      type: 'status-changed', fromId: ctx.state.peerId,
      statusType, statusMessage: statusMessage || '', timestamp: Date.now(),
    })
  })
}

module.exports = { registerUserHandlers }
