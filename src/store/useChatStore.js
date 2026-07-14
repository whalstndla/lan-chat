// src/store/useChatStore.js
import { create } from 'zustand'

// localStorage에서 뮤트 상태 복원
function loadMutedRooms() {
  try {
    const saved = localStorage.getItem('mutedRooms')
    return saved ? JSON.parse(saved) : {}
  } catch {
    return {}
  }
}

// localStorage에 뮤트 상태 저장
function saveMutedRooms(mutedRooms) {
  try {
    localStorage.setItem('mutedRooms', JSON.stringify(mutedRooms))
  } catch {
    // localStorage 접근 실패 시 무시
  }
}

// localStorage에서 북마크 상태 복원 — 피어 전파 없는 로컬 전용 기능(#34)
function loadBookmarks() {
  try {
    const saved = localStorage.getItem('bookmarks')
    return saved ? JSON.parse(saved) : {}
  } catch {
    return {}
  }
}

// localStorage에 북마크 상태 저장
function saveBookmarksToStorage(bookmarks) {
  try {
    localStorage.setItem('bookmarks', JSON.stringify(bookmarks))
  } catch {
    // localStorage 접근 실패 시 무시
  }
}

// 채팅방 식별 키 계산 — mutedRooms/ChatWindow 에서 쓰는 규약과 동일(전체 채팅은 'global',
// DM 은 peerId 그대로). 방별 draft 저장/복원 키로 재사용.
export function getRoomKey(room) {
  if (!room) return 'global'
  return room.type === 'global' ? 'global' : room.peerId
}

// 현재 보고 있는 채팅방 타입
// { type: 'global' } 또는 { type: 'dm', peerId: 'xxx', nickname: '홍길동' }
const useChatStore = create((set, get) => ({
  currentRoom: { type: 'global' },
  globalMessages: [],
  dmMessages: {}, // { peerId: [메시지...] }
  unreadCounts: {}, // { peerId: 숫자 }
  // { roomKey: timestamp | null } — 방(전체채팅='global', DM=peerId)별 마지막으로 읽은
  // 지점. 안읽음 구분선 위치 계산에 사용되며, DB(room_read_state 테이블)에 영속돼
  // 재시작 후에도 유지된다(#39). 부팅 시 get-room-read-state IPC 응답으로 하이드레이션.
  lastReadTimestamps: {},
  typingUsers: {}, // { peerId: { nickname, timestamp } }
  mutedRooms: loadMutedRooms(), // { roomKey: boolean } — 채팅방별 알림 뮤트 상태
  drafts: {}, // { roomKey: markdown } — 방 전환 시 작성 중이던 메시지를 보존하기 위한 임시 저장소
  cachedFileUrls: {}, // { messageId: 'file://...' } — WebSocket으로 수신한 파일 캐시 경로
  // { messageId: 'notFound' | 'tooLarge' | 'timeout' | ... } — file-request 실패 통보.
  // 렌더러가 'loading' 에서 'failed' 로 즉시 전환하기 위해 사용.
  fileLoadErrors: {},
  // { messageId: { emoji: [peerId, ...] } } — 메시지별 이모지 리액션. 히스토리 로드 시
  // 배치 하이드레이션(setReactions) 되고, 실시간 토글/수신은 updateReaction 으로 반영.
  reactions: {},
  // { messageId: { savedAt, roomKey, preview } } — 로컬 전용 북마크(#34). 피어에게 전파되지
  // 않고 이 기기에만 저장되며 localStorage 로 재시작 후에도 유지된다.
  bookmarks: loadBookmarks(),
  // 북마크 목록에서 메시지를 열었을 때, 해당 방으로 전환 후 화면에 이미 로드돼 있으면
  // 스크롤+하이라이트할 대상 messageId. ChatWindow 가 구독해 처리하고 나면 다시 null 로 비운다.
  pendingScrollMessageId: null,

  // 채팅방 뮤트 토글 (roomKey: 'global' 또는 peerId)
  toggleRoomMute: (roomKey) =>
    set((state) => {
      const updated = { ...state.mutedRooms, [roomKey]: !state.mutedRooms[roomKey] }
      saveMutedRooms(updated)
      return { mutedRooms: updated }
    }),

  // 채팅방 뮤트 여부 확인 (액션이 아닌 셀렉터로 사용)
  isRoomMuted: (roomKey) => !!get().mutedRooms[roomKey],

  setCurrentRoom: (room) => set({ currentRoom: room }),

  // 방 전환/blur 시점에 작성 중이던 마크다운을 draft 로 저장. 빈 문자열이면 기존 draft 항목을
  // 제거해(에디터를 비운 채로 방을 떠난 경우) 다음 진입 시 빈 draft 가 복원되지 않게 한다.
  setDraft: (roomKey, markdown) =>
    set((state) => {
      if (!roomKey) return state
      if (!markdown) {
        if (!(roomKey in state.drafts)) return state
        const updated = { ...state.drafts }
        delete updated[roomKey]
        return { drafts: updated }
      }
      if (state.drafts[roomKey] === markdown) return state
      return { drafts: { ...state.drafts, [roomKey]: markdown } }
    }),

  // 전송 성공 시 해당 방의 draft 제거
  clearDraft: (roomKey) =>
    set((state) => {
      if (!roomKey || !(roomKey in state.drafts)) return state
      const updated = { ...state.drafts }
      delete updated[roomKey]
      return { drafts: updated }
    }),

  setGlobalHistory: (messages) => set({ globalMessages: messages }),

  // 이전 메시지를 앞에 추가 (무한 스크롤)
  prependGlobalMessages: (older) =>
    set((state) => {
      const existingIds = new Set(state.globalMessages.map(m => m.id))
      const unique = older.filter(m => !existingIds.has(m.id))
      return { globalMessages: [...unique, ...state.globalMessages] }
    }),

  prependDMMessages: (peerId, older) =>
    set((state) => {
      const existing = state.dmMessages[peerId] || []
      const existingIds = new Set(existing.map(m => m.id))
      const unique = older.filter(m => !existingIds.has(m.id))
      return {
        dmMessages: { ...state.dmMessages, [peerId]: [...unique, ...existing] },
      }
    }),

  addGlobalMessage: (message) =>
    set((state) => {
      const updated = [...state.globalMessages, message]
      // 최근 500개만 유지 (메모리 누수 방지)
      return { globalMessages: updated.length > 500 ? updated.slice(-500) : updated }
    }),

  setDMHistory: (peerId, messages) =>
    set((state) => ({
      dmMessages: { ...state.dmMessages, [peerId]: messages },
    })),

  addDMMessage: (peerId, message) =>
    set((state) => {
      const existing = state.dmMessages[peerId] || []
      const appended = [...existing, message]
      // Phase 4: 메모리 누적 방지 — 최근 500개만 유지 (globalMessages 와 동일 정책)
      const trimmed = appended.length > 500 ? appended.slice(-500) : appended
      return {
        dmMessages: { ...state.dmMessages, [peerId]: trimmed },
      }
    }),

  // 부팅/재로그인 시 DB 에서 조회한 상대별 안읽은 개수를 일괄 반영 (사이드바 배지 복원)
  setUnreadCounts: (counts) =>
    set((state) => ({
      unreadCounts: { ...state.unreadCounts, ...counts },
    })),

  incrementUnread: (peerId) =>
    set((state) => ({
      unreadCounts: {
        ...state.unreadCounts,
        [peerId]: (state.unreadCounts[peerId] || 0) + 1,
      },
    })),

  resetUnread: (peerId) =>
    set((state) => ({
      unreadCounts: {
        ...state.unreadCounts,
        [peerId]: 0,
      },
    })),

  // 부팅 시 DB(room_read_state)에서 조회한 방별 마지막 읽은 지점을 일괄 반영(#39).
  // 기존 값과 병합 — 이미 이번 세션에서 계산된 값(예: 처음 방 진입 캡처)을 덮어쓰지 않도록
  // 호출 시점(로그인 초기, initialize 이전)에 주의해야 한다.
  setLastReadTimestamps: (timestamps) =>
    set((state) => ({
      lastReadTimestamps: { ...state.lastReadTimestamps, ...timestamps },
    })),

  // 방 진입/이탈 시 마지막 읽은 지점 하나를 갱신 — 호출자가 동시에 DB 에도 영속화한다.
  setLastReadTimestamp: (roomKey, timestamp) =>
    set((state) => ({
      lastReadTimestamps: { ...state.lastReadTimestamps, [roomKey]: timestamp },
    })),

  setCachedFileUrl: (messageId, localPath) =>
    set((state) => {
      // 캐시 URL 도착 시 같은 messageId 의 기존 실패 상태는 해제 (재시도 회복 케이스).
      if (!state.fileLoadErrors[messageId]) {
        return { cachedFileUrls: { ...state.cachedFileUrls, [messageId]: localPath } }
      }
      const updatedErrors = { ...state.fileLoadErrors }
      delete updatedErrors[messageId]
      return {
        cachedFileUrls: { ...state.cachedFileUrls, [messageId]: localPath },
        fileLoadErrors: updatedErrors,
      }
    }),

  setFileLoadError: (messageId, reason) =>
    set((state) => ({
      fileLoadErrors: { ...state.fileLoadErrors, [messageId]: reason || 'unknown' },
    })),

  // 리액션 배치 하이드레이션 — get-reactions IPC 응답({messageId: [{peer_id, emoji}, ...]})을
  // 스토어 형식({messageId: {emoji: [peerId, ...]}})으로 변환해 기존 상태에 병합
  setReactions: (reactionRowsByMessageId) =>
    set((state) => {
      const merged = { ...state.reactions }
      for (const [messageId, rows] of Object.entries(reactionRowsByMessageId || {})) {
        const grouped = {}
        for (const row of rows) {
          if (!grouped[row.emoji]) grouped[row.emoji] = []
          grouped[row.emoji].push(row.peer_id)
        }
        merged[messageId] = grouped
      }
      return { reactions: merged }
    }),

  // 리액션 실시간 갱신 — 내 토글 응답(toggleReaction 결과) 또는 상대방 리액션 브로드캐스트
  // 수신(reaction-updated) 시 호출되어 해당 메시지의 이모지별 반응자 목록을 갱신
  updateReaction: (messageId, emoji, peerId, action) =>
    set((state) => {
      const messageReactions = { ...(state.reactions[messageId] || {}) }
      const reactors = [...(messageReactions[emoji] || [])]
      if (action === 'add') {
        if (!reactors.includes(peerId)) reactors.push(peerId)
      } else if (action === 'remove') {
        const idx = reactors.indexOf(peerId)
        if (idx !== -1) reactors.splice(idx, 1)
      }
      if (reactors.length === 0) delete messageReactions[emoji]
      else messageReactions[emoji] = reactors
      return { reactions: { ...state.reactions, [messageId]: messageReactions } }
    }),

  // 메시지 북마크 토글(#34) — 이미 북마크돼 있으면 제거, 아니면 추가. roomKey/preview 는
  // 추가할 때만 사용되고(목록에서 방/미리보기 표시용), 제거 시에는 무시해도 안전하다.
  toggleBookmark: (messageId, roomKey, preview) =>
    set((state) => {
      const updated = { ...state.bookmarks }
      if (updated[messageId]) {
        delete updated[messageId]
      } else {
        updated[messageId] = { savedAt: Date.now(), roomKey, preview }
      }
      saveBookmarksToStorage(updated)
      return { bookmarks: updated }
    }),

  isBookmarked: (messageId) => !!get().bookmarks[messageId],

  setPendingScrollMessageId: (messageId) => set({ pendingScrollMessageId: messageId }),

  clearPendingScrollMessageId: () => set({ pendingScrollMessageId: null }),

  setTyping: (peerId, nickname, to) =>
    set((state) => ({
      typingUsers: {
        ...state.typingUsers,
        // to: null이면 전체채팅, to가 있으면 해당 DM
        [peerId]: { nickname, timestamp: Date.now(), to: to || null },
      },
    })),

  // 특정 발신자의 typing 상태를 즉시 제거 — 상대가 메시지를 전송해 typing-stop 신호를
  // 보내온 경우, 3초 만료를 기다리지 않고 즉시 "입력 중" 표시를 지우기 위해 사용
  clearTyping: (peerId) =>
    set((state) => {
      if (!(peerId in state.typingUsers)) return state
      const updated = { ...state.typingUsers }
      delete updated[peerId]
      return { typingUsers: updated }
    }),

  clearExpiredTyping: () =>
    set((state) => {
      const now = Date.now()
      const entries = Object.entries(state.typingUsers)
      // 만료된 항목 없으면 상태 변경하지 않음
      if (entries.every(([, v]) => now - v.timestamp < 3000)) return state
      const filtered = {}
      for (const [key, value] of entries) {
        if (now - value.timestamp < 3000) filtered[key] = value
      }
      return { typingUsers: filtered }
    }),

  removeGlobalMessage: (messageId) =>
    set((state) => ({
      globalMessages: state.globalMessages.filter((message) => message.id !== messageId),
    })),

  removeDMMessage: (peerId, messageId) =>
    set((state) => ({
      dmMessages: {
        ...state.dmMessages,
        [peerId]: (state.dmMessages[peerId] || []).filter((message) => message.id !== messageId),
      },
    })),

  // DM 메시지 읽음 처리 — 상대방이 읽었을 때 read 플래그 설정
  markMessagesAsRead: (peerId, messageIds) =>
    set((state) => ({
      dmMessages: {
        ...state.dmMessages,
        [peerId]: (state.dmMessages[peerId] || []).map(msg =>
          messageIds.includes(msg.id) ? { ...msg, read: true } : msg
        ),
      },
    })),

  // pending 플래그 제거 (오프라인 메시지 전송 완료 시)
  clearPendingMessages: (peerId, messageIds) =>
    set((state) => ({
      dmMessages: {
        ...state.dmMessages,
        [peerId]: (state.dmMessages[peerId] || []).map(msg =>
          messageIds.includes(msg.id) ? { ...msg, pending: false } : msg
        ),
      },
    })),

  // 글로벌 메시지 내용 수정
  editGlobalMessage: (messageId, newContent, editedAt) =>
    set((state) => ({
      globalMessages: state.globalMessages.map(msg =>
        msg.id === messageId ? { ...msg, content: newContent, edited_at: editedAt } : msg
      ),
    })),

  // DM 메시지 내용 수정
  editDMMessage: (peerId, messageId, newContent, editedAt) =>
    set((state) => ({
      dmMessages: {
        ...state.dmMessages,
        [peerId]: (state.dmMessages[peerId] || []).map(msg =>
          msg.id === messageId ? { ...msg, content: newContent, edited_at: editedAt } : msg
        ),
      },
    })),

  // 로그아웃 시 채팅 상태 초기화. 북마크는 메시지 히스토리(globalMessages/dmMessages)와 함께
  // 사라지는 로컬 데이터로 취급해 localStorage 도 함께 비운다 — 그렇지 않으면 이미 사라진
  // 메시지를 가리키는 북마크가 남거나, 같은 기기에서 다른 계정으로 재로그인 시 이전 사용자의
  // 북마크가 그대로 노출되는 문제가 생긴다.
  resetAll: () => {
    saveBookmarksToStorage({})
    set({
      currentRoom: { type: 'global' },
      globalMessages: [],
      dmMessages: {},
      unreadCounts: {},
      lastReadTimestamps: {},
      typingUsers: {},
      reactions: {},
      drafts: {},
      bookmarks: {},
      pendingScrollMessageId: null,
    })
  },
}))

export default useChatStore
