// electron/preload.js
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  // 인증
  checkProfileExists: () => ipcRenderer.invoke('check-profile-exists'),
  register: (data) => ipcRenderer.invoke('register', data),
  login: (data) => ipcRenderer.invoke('login', data),
  checkAutoLogin: () => ipcRenderer.invoke('check-auto-login'),
  logout: () => ipcRenderer.invoke('logout'),

  // 내 정보
  getMyInfo: () => ipcRenderer.invoke('get-my-info'),

  // 프로필 관리
  updateNickname: (nickname) => ipcRenderer.invoke('update-nickname', nickname),
  saveProfileImage: (imageBuffer) => ipcRenderer.invoke('save-profile-image', imageBuffer),

  // 피어 발견
  startPeerDiscovery: () => ipcRenderer.invoke('start-peer-discovery'),

  // 메시지 전송
  sendGlobalMessage: (payload) => ipcRenderer.invoke('send-global-message', payload),
  sendDM: (payload) => ipcRenderer.invoke('send-dm', payload),

  // 기록 조회
  getGlobalHistory: () => ipcRenderer.invoke('get-global-history'),
  getDMHistory: (peerId1, peerId2) => ipcRenderer.invoke('get-dm-history', { peerId1, peerId2 }),

  // 파일 저장 — ArrayBuffer를 Uint8Array로 변환 후 전송 (IPC 직렬화 안전)
  saveFile: (fileBuffer, fileName) => ipcRenderer.invoke('save-file', { fileBuffer: new Uint8Array(fileBuffer), fileName }),

  // 타이핑 인디케이터 전송
  sendTyping: (targetPeerId) => ipcRenderer.invoke('send-typing', targetPeerId),

  // 메시지 삭제
  deleteMessage: (messageId, targetPeerId) => ipcRenderer.invoke('delete-message', { messageId, targetPeerId }),

  // 이벤트 구독
  subscribeToMessages: (callback) => ipcRenderer.on('message-received', (_, message) => callback(message)),
  subscribeToPeerDiscovery: (callback) => ipcRenderer.on('peer-discovered', (_, peerInfo) => callback(peerInfo)),
  subscribeToPeerLeft: (callback) => ipcRenderer.on('peer-left', (_, peerId) => callback(peerId)),
  onTypingEvent: (callback) => ipcRenderer.on('typing-event', (_, data) => callback(data)),
  onPeerNicknameChanged: (callback) => ipcRenderer.on('peer-nickname-changed', (_, data) => callback(data)),
  onPeerProfileUpdated: (callback) => ipcRenderer.on('peer-profile-updated', (_, data) => callback(data)),
  onPendingMessagesFlushed: (callback) => ipcRenderer.on('pending-messages-flushed', (_, data) => callback(data)),

  // 이벤트 구독 해제
  unsubscribeAll: () => {
    ipcRenderer.removeAllListeners('message-received')
    ipcRenderer.removeAllListeners('peer-discovered')
    ipcRenderer.removeAllListeners('peer-left')
    ipcRenderer.removeAllListeners('typing-event')
    ipcRenderer.removeAllListeners('peer-nickname-changed')
    ipcRenderer.removeAllListeners('peer-profile-updated')
    ipcRenderer.removeAllListeners('pending-messages-flushed')
  },

  // 자동 업데이트
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  onUpdateAvailable: (callback) => ipcRenderer.on('update-available', () => callback()),
  onDownloadProgress: (callback) => ipcRenderer.on('update-download-progress', (_, percent) => callback(percent)),
  onUpdateNotAvailable: (callback) => ipcRenderer.on('update-not-available', () => callback()),
  onUpdateDownloaded: (callback) => ipcRenderer.on('update-downloaded', () => callback()),
  onUpdateError: (callback) => ipcRenderer.on('update-error', (_, message) => callback(message)),
  installUpdate: () => ipcRenderer.invoke('install-update'),
})
