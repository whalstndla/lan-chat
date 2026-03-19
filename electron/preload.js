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
  updatePassword: (data) => ipcRenderer.invoke('update-password', data),

  // 피어 발견
  startPeerDiscovery: () => ipcRenderer.invoke('start-peer-discovery'),

  // 메시지 전송
  sendGlobalMessage: (payload) => ipcRenderer.invoke('send-global-message', payload),
  sendDM: (payload) => ipcRenderer.invoke('send-dm', payload),

  // 기록 조회
  getGlobalHistory: () => ipcRenderer.invoke('get-global-history'),
  getDMHistory: (peerId1, peerId2) => ipcRenderer.invoke('get-dm-history', { peerId1, peerId2 }),
  getDMPeers: () => ipcRenderer.invoke('get-dm-peers'),

  // 데이터 관리
  clearAllMessages: () => ipcRenderer.invoke('clear-all-messages'),
  clearAllDMs: () => ipcRenderer.invoke('clear-all-dms'),

  // 파일 저장 — ArrayBuffer를 Uint8Array로 변환 후 전송 (IPC 직렬화 안전)
  saveFile: (fileBuffer, fileName) => ipcRenderer.invoke('save-file', { fileBuffer: new Uint8Array(fileBuffer), fileName }),

  // 타이핑 인디케이터 전송
  sendTyping: (targetPeerId) => ipcRenderer.invoke('send-typing', targetPeerId),

  // 읽음 확인
  getUnreadDMIds: (senderPeerId) => ipcRenderer.invoke('get-unread-dm-ids', senderPeerId),
  sendReadReceipt: (targetPeerId, messageIds) => ipcRenderer.invoke('send-read-receipt', { targetPeerId, messageIds }),

  // 읽음 확인 수신 이벤트
  onReadReceipt: (callback) => {
    ipcRenderer.removeAllListeners('read-receipt')
    ipcRenderer.on('read-receipt', (_, data) => callback(data))
  },

  // 메시지 삭제
  deleteMessage: (messageId, targetPeerId) => ipcRenderer.invoke('delete-message', { messageId, targetPeerId }),

  // 이벤트 구독 — 중복 등록 방지를 위해 기존 리스너 제거 후 재등록
  subscribeToMessages: (callback) => {
    ipcRenderer.removeAllListeners('message-received')
    ipcRenderer.on('message-received', (_, message) => callback(message))
  },
  subscribeToPeerDiscovery: (callback) => {
    ipcRenderer.removeAllListeners('peer-discovered')
    ipcRenderer.on('peer-discovered', (_, peerInfo) => callback(peerInfo))
  },
  subscribeToPeerLeft: (callback) => {
    ipcRenderer.removeAllListeners('peer-left')
    ipcRenderer.on('peer-left', (_, peerId) => callback(peerId))
  },
  onTypingEvent: (callback) => {
    ipcRenderer.removeAllListeners('typing-event')
    ipcRenderer.on('typing-event', (_, data) => callback(data))
  },
  onPeerNicknameChanged: (callback) => {
    ipcRenderer.removeAllListeners('peer-nickname-changed')
    ipcRenderer.on('peer-nickname-changed', (_, data) => callback(data))
  },
  onPeerProfileUpdated: (callback) => {
    ipcRenderer.removeAllListeners('peer-profile-updated')
    ipcRenderer.on('peer-profile-updated', (_, data) => callback(data))
  },
  onPendingMessagesFlushed: (callback) => {
    ipcRenderer.removeAllListeners('pending-messages-flushed')
    ipcRenderer.on('pending-messages-flushed', (_, data) => callback(data))
  },

  // 이벤트 구독 해제
  unsubscribeAll: () => {
    ipcRenderer.removeAllListeners('message-received')
    ipcRenderer.removeAllListeners('peer-discovered')
    ipcRenderer.removeAllListeners('peer-left')
    ipcRenderer.removeAllListeners('typing-event')
    ipcRenderer.removeAllListeners('peer-nickname-changed')
    ipcRenderer.removeAllListeners('peer-profile-updated')
    ipcRenderer.removeAllListeners('pending-messages-flushed')
    ipcRenderer.removeAllListeners('read-receipt')
    ipcRenderer.removeAllListeners('play-notification-sound')
    ipcRenderer.removeAllListeners('update-available')
    ipcRenderer.removeAllListeners('update-download-progress')
    ipcRenderer.removeAllListeners('update-not-available')
    ipcRenderer.removeAllListeners('update-downloaded')
    ipcRenderer.removeAllListeners('update-error')
  },

  // 외부 링크 열기
  openExternal: (url) => ipcRenderer.invoke('open-external', url),

  // 패치노트
  getChangelog: () => ipcRenderer.invoke('get-changelog'),
  getAppVersionInfo: () => ipcRenderer.invoke('get-app-version-info'),

  // 알림 설정
  getNotificationSettings: () => ipcRenderer.invoke('get-notification-settings'),
  saveNotificationSettings: (settings) => ipcRenderer.invoke('save-notification-settings', settings),
  saveCustomNotificationSound: (buffer, extension) =>
    ipcRenderer.invoke('save-custom-notification-sound', { buffer: new Uint8Array(buffer), extension }),

  // 알림 소리 재생 이벤트
  onPlayNotificationSound: (callback) => {
    ipcRenderer.removeAllListeners('play-notification-sound')
    ipcRenderer.on('play-notification-sound', () => callback())
  },

  // 자동 업데이트
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  onUpdateAvailable: (callback) => {
    ipcRenderer.removeAllListeners('update-available')
    ipcRenderer.on('update-available', () => callback())
  },
  onDownloadProgress: (callback) => {
    ipcRenderer.removeAllListeners('update-download-progress')
    ipcRenderer.on('update-download-progress', (_, percent) => callback(percent))
  },
  onUpdateNotAvailable: (callback) => {
    ipcRenderer.removeAllListeners('update-not-available')
    ipcRenderer.on('update-not-available', () => callback())
  },
  onUpdateDownloaded: (callback) => {
    ipcRenderer.removeAllListeners('update-downloaded')
    ipcRenderer.on('update-downloaded', () => callback())
  },
  onUpdateError: (callback) => {
    ipcRenderer.removeAllListeners('update-error')
    ipcRenderer.on('update-error', (_, message) => callback(message))
  },
  installUpdate: () => ipcRenderer.invoke('install-update'),
})
