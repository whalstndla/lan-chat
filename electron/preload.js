// electron/preload.js
// sandbox: false 환경에서만 동작 (main.js webPreferences에 sandbox: false 필수)
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
  // 수동 피어 연결(#33) — mDNS/UDP 브로드캐스트 발견이 막힌 망에서 IP 직접 입력으로 연결
  connectManualPeer: (params) => ipcRenderer.invoke('connect-manual-peer', params),

  // 메시지 전송
  sendGlobalMessage: (payload) => ipcRenderer.invoke('send-global-message', payload),
  sendDM: (payload) => ipcRenderer.invoke('send-dm', payload),

  // 기록 조회
  getGlobalHistory: (params) => ipcRenderer.invoke('get-global-history', params),
  getDMHistory: (peerId1, peerId2, limit, offset) => ipcRenderer.invoke('get-dm-history', { peerId1, peerId2, limit, offset }),
  getDMPeers: () => ipcRenderer.invoke('get-dm-peers'),

  // 데이터 관리
  clearAllMessages: () => ipcRenderer.invoke('clear-all-messages'),
  clearAllDMs: () => ipcRenderer.invoke('clear-all-dms'),

  // 채팅 내보내기(#74) — { scope: 'global'|'dm', peerId?, format: 'txt'|'json' }
  exportChatHistory: (params) => ipcRenderer.invoke('export-chat-history', params),

  // 저장소 사용량 조회 + 캐시 비우기(#74) — 캐시 비우기는 메시지/DB 를 지우지 않고
  // file_cache/ 표시용 캐시 파일만 정리한다(다음 열람 시 온라인이면 자동 재요청).
  getStorageUsage: () => ipcRenderer.invoke('get-storage-usage'),
  clearFileCache: () => ipcRenderer.invoke('clear-file-cache'),

  // 기본 다운로드 폴더 설정(#74) — 미지정 시 OS 기본 다운로드 폴더 사용
  getDownloadFolder: () => ipcRenderer.invoke('get-download-folder'),
  setDownloadFolder: () => ipcRenderer.invoke('set-download-folder'),

  // 파일 저장 — ArrayBuffer를 Uint8Array로 변환 후 전송 (IPC 직렬화 안전)
  saveFile: (fileBuffer, fileName) => ipcRenderer.invoke('save-file', { fileBuffer: new Uint8Array(fileBuffer), fileName }),

  // 타이핑 인디케이터 전송
  sendTyping: (targetPeerId) => ipcRenderer.invoke('send-typing', targetPeerId),

  // 상태 변경
  updateStatus: (data) => ipcRenderer.invoke('update-status', data),
  onPeerStatusChanged: (callback) => {
    ipcRenderer.removeAllListeners('peer-status-changed')
    ipcRenderer.on('peer-status-changed', (_, data) => callback(data))
  },
  // 내 상태가 main 프로세스에 의해 자동으로 바뀌었을 때(유휴 자동 자리비움/복원) 통보(#41)
  onMyStatusChanged: (callback) => {
    ipcRenderer.removeAllListeners('my-status-changed')
    ipcRenderer.on('my-status-changed', (_, data) => callback(data))
  },

  // 읽음 확인
  getUnreadDMIds: (senderPeerId) => ipcRenderer.invoke('get-unread-dm-ids', senderPeerId),
  // 상대별 안읽은 DM 개수 일괄 조회 — 부팅 시 사이드바 배지 복원용
  getUnreadCounts: () => ipcRenderer.invoke('get-unread-counts'),
  sendReadReceipt: (targetPeerId, messageIds) => ipcRenderer.invoke('send-read-receipt', { targetPeerId, messageIds }),
  // 방별 마지막 읽은 지점(#39) — 안읽음 구분선을 재시작 후에도 유지하기 위한 영속 저장
  getRoomReadState: () => ipcRenderer.invoke('get-room-read-state'),
  setRoomReadTimestamp: (roomKey, timestamp) => ipcRenderer.invoke('set-room-read-timestamp', { roomKey, timestamp }),

  // 읽음 확인 수신 이벤트
  onReadReceipt: (callback) => {
    ipcRenderer.removeAllListeners('read-receipt')
    ipcRenderer.on('read-receipt', (_, data) => callback(data))
  },

  // 메시지 삭제
  deleteMessage: (messageId, targetPeerId) => ipcRenderer.invoke('delete-message', { messageId, targetPeerId }),

  // 메시지 수정
  editMessage: (data) => ipcRenderer.invoke('edit-message', data),
  onMessageEdited: (callback) => {
    ipcRenderer.removeAllListeners('message-edited')
    ipcRenderer.on('message-edited', (_, data) => callback(data))
  },

  // 메시지 전문 검색
  searchMessages: (params) => ipcRenderer.invoke('search-messages', params),
  // DM 전체 기간 검색 — main 에서 복호화하며 검색(#35)
  searchDMMessages: (params) => ipcRenderer.invoke('search-dm-messages', params),
  // 검색 결과 점프용 — 특정 타임스탬프보다 최신인 메시지 개수 조회(#36)
  getGlobalMessageRank: (timestamp) => ipcRenderer.invoke('get-global-message-rank', { timestamp }),
  getDMMessageRank: (peerId, timestamp) => ipcRenderer.invoke('get-dm-message-rank', { peerId, timestamp }),

  // 파일 영구 캐시 URL 조회 — 원본 URL이 만료된 경우 로컬 캐시로 폴백
  getCachedFileUrl: (messageId) => ipcRenderer.invoke('get-cached-file-url', messageId),

  // 파일 다운로드 — 복호화된 원본을 "다른 이름으로 저장" 다이얼로그로 저장
  downloadFile: (messageId) => ipcRenderer.invoke('download-file', messageId),

  // 저장된 파일을 OS 파일 탐색기에서 보여주기 ("폴더에서 보기")
  showItemInFolder: (filePath) => ipcRenderer.invoke('show-item-in-folder', filePath),

  // 이벤트 구독 — 중복 등록 방지를 위해 기존 리스너 제거 후 재등록
  subscribeToMessages: (callback) => {
    ipcRenderer.removeAllListeners('message-received')
    ipcRenderer.on('message-received', (_, message) => callback(message))
  },
  // #31 전체채팅 히스토리 동기화 — 연결 시 상대에게서 받은 과거 전체채팅 메시지 배치.
  onGlobalHistorySynced: (callback) => {
    ipcRenderer.removeAllListeners('global-history-synced')
    ipcRenderer.on('global-history-synced', (_, messages) => callback(messages))
  },
  subscribeToPeerDiscovery: (callback) => {
    ipcRenderer.removeAllListeners('peer-discovered')
    ipcRenderer.on('peer-discovered', (_, peerInfo) => callback(peerInfo))
  },
  onPeerConnecting: (callback) => {
    ipcRenderer.removeAllListeners('peer-connecting')
    ipcRenderer.on('peer-connecting', (_, peerId) => callback(peerId))
    // 구독 해제 함수 반환 — 호출부(Sidebar.jsx)가 언마운트 시 실제로 리스너를 정리할 수 있도록
    return () => ipcRenderer.removeAllListeners('peer-connecting')
  },
  onFileCached: (callback) => {
    ipcRenderer.removeAllListeners('file-cached')
    ipcRenderer.on('file-cached', (_, data) => callback(data))
  },
  // 파일 요청 실패 통보 — 송신측에서 명시적 error 응답을 받았거나 retry 가 모두 소진된 경우.
  // 렌더러는 loading → failed 로 즉시 전환.
  onFileRequestError: (callback) => {
    ipcRenderer.removeAllListeners('file-request-error')
    ipcRenderer.on('file-request-error', (_, data) => callback(data))
  },
  // 청크 전송 진행률(#44/#45/#49) — { messageId, received, total }. 말풍선에 % 표시.
  onFileProgress: (callback) => {
    ipcRenderer.removeAllListeners('file-progress')
    ipcRenderer.on('file-progress', (_, data) => callback(data))
  },
  // 진행 중인 파일 전송 취소 — 송신측 루프 중단 + 로컬 부분 폐기.
  cancelFileTransfer: (messageId) => ipcRenderer.invoke('cancel-file-transfer', messageId),
  subscribeToPeerLeft: (callback) => {
    ipcRenderer.removeAllListeners('peer-left')
    ipcRenderer.on('peer-left', (_, peerId) => callback(peerId))
  },
  onTypingEvent: (callback) => {
    ipcRenderer.removeAllListeners('typing-event')
    ipcRenderer.on('typing-event', (_, data) => callback(data))
  },
  // 타이핑 정지 — 상대가 메시지를 실제로 전송하면 즉시 정지 신호를 보내
  // 최대 3초간 남아있던 "입력 중" 유령 표시를 바로 지운다.
  onTypingStop: (callback) => {
    ipcRenderer.removeAllListeners('typing-stop')
    ipcRenderer.on('typing-stop', (_, data) => callback(data))
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

  // TOFU 키 변경 경고(#59) — 상대 공개키가 고정 키와 달라졌을 때 통보.
  // data: { peerId, nickname, fingerprint } (변경 감지) 또는 { peerId, resolved: true } (정상 복귀로 해제).
  onPeerKeyChanged: (callback) => {
    ipcRenderer.removeAllListeners('peer-key-changed')
    ipcRenderer.on('peer-key-changed', (_, data) => callback(data))
  },
  // 키 변경을 사용자가 명시적으로 신뢰 — 고정 키/세션 맵을 새 키로 교체
  trustPeerKey: (peerId) => ipcRenderer.invoke('trust-peer-key', { peerId }),

  // 알림 클릭 시 채팅방 이동
  onNavigateToRoom: (callback) => {
    ipcRenderer.removeAllListeners('navigate-to-room')
    ipcRenderer.on('navigate-to-room', (_, room) => callback(room))
  },

  // 이모지 리액션
  toggleReaction: (data) => ipcRenderer.invoke('toggle-reaction', data),
  getReactions: (messageIds) => ipcRenderer.invoke('get-reactions', messageIds),
  onReactionUpdated: (callback) => {
    ipcRenderer.removeAllListeners('reaction-updated')
    ipcRenderer.on('reaction-updated', (_, data) => callback(data))
  },

  // 이벤트 구독 해제 — 채팅/피어 관련 채널만 해제한다.
  // update-* 채널은 App.jsx 마운트 시 1회만 등록되어 앱 수명 전체 동안 유지되어야 하므로
  // (로그인 이후에도 "업데이트 확인" 버튼이 동작해야 함) 여기서 제외한다.
  unsubscribeAll: () => {
    ipcRenderer.removeAllListeners('message-received')
    ipcRenderer.removeAllListeners('global-history-synced')
    ipcRenderer.removeAllListeners('peer-discovered')
    ipcRenderer.removeAllListeners('peer-left')
    ipcRenderer.removeAllListeners('typing-event')
    ipcRenderer.removeAllListeners('typing-stop')
    ipcRenderer.removeAllListeners('peer-nickname-changed')
    ipcRenderer.removeAllListeners('peer-profile-updated')
    ipcRenderer.removeAllListeners('pending-messages-flushed')
    ipcRenderer.removeAllListeners('peer-key-changed')
    ipcRenderer.removeAllListeners('peer-connecting')
    ipcRenderer.removeAllListeners('file-cached')
    ipcRenderer.removeAllListeners('file-request-error')
    ipcRenderer.removeAllListeners('file-progress')
    ipcRenderer.removeAllListeners('read-receipt')
    ipcRenderer.removeAllListeners('navigate-to-room')
    ipcRenderer.removeAllListeners('reaction-updated')
    ipcRenderer.removeAllListeners('message-edited')
    ipcRenderer.removeAllListeners('peer-status-changed')
    ipcRenderer.removeAllListeners('my-status-changed')
    ipcRenderer.removeAllListeners('play-notification-sound')
  },

  // 외부 링크 열기
  openExternal: (url) => ipcRenderer.invoke('open-external', url),

  // 이미지 클립보드 복사
  copyImageToClipboard: (imageUrl) => ipcRenderer.invoke('copy-image-to-clipboard', imageUrl),

  // 링크 프리뷰 OG 메타데이터 가져오기
  fetchLinkPreview: (url) => ipcRenderer.invoke('fetch-link-preview', url),

  // 패치노트
  getChangelog: () => ipcRenderer.invoke('get-changelog'),
  getAppVersionInfo: () => ipcRenderer.invoke('get-app-version-info'),

  // 알림 설정
  getNotificationSettings: () => ipcRenderer.invoke('get-notification-settings'),
  saveNotificationSettings: (settings) => ipcRenderer.invoke('save-notification-settings', settings),
  saveCustomNotificationSound: (buffer, extension) =>
    ipcRenderer.invoke('save-custom-notification-sound', { buffer: new Uint8Array(buffer), extension }),

  // 뮤트된 채팅방 목록을 main 에 동기화 — 소리/OS알림 억제 판정용 (배지는 항상 유지)
  setMutedRooms: (roomKeys) => ipcRenderer.invoke('set-muted-rooms', roomKeys),

  // 링크 미리보기(외부 서버 OG 요청) 사용 여부 — SSRF/프라이버시 옵션(#66)
  getLinkPreviewEnabled: () => ipcRenderer.invoke('get-link-preview-enabled'),
  setLinkPreviewEnabled: (enabled) => ipcRenderer.invoke('set-link-preview-enabled', enabled),

  // 로그인 시 자동 시작(#71) — { supported, openAtLogin, startHidden } 형태로 상태 조회/변경
  getAutoLaunchSettings: () => ipcRenderer.invoke('get-auto-launch-settings'),
  setAutoLaunchSettings: (settings) => ipcRenderer.invoke('set-auto-launch-settings', settings),

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
