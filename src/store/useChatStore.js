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

// 현재 보고 있는 채팅방 타입
// { type: 'global' } 또는 { type: 'dm', peerId: 'xxx', nickname: '홍길동' }
const useChatStore = create((set, get) => ({
  currentRoom: { type: 'global' },
  globalMessages: [],
  dmMessages: {}, // { peerId: [메시지...] }
  unreadCounts: {}, // { peerId: 숫자 }
  typingUsers: {}, // { peerId: { nickname, timestamp } }
  mutedRooms: loadMutedRooms(), // { roomKey: boolean } — 채팅방별 알림 뮤트 상태
  cachedFileUrls: {}, // { messageId: 'file://...' } — WebSocket으로 수신한 파일 캐시 경로

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
    set((state) => ({
      dmMessages: {
        ...state.dmMessages,
        [peerId]: [...(state.dmMessages[peerId] || []), message],
      },
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

  setCachedFileUrl: (messageId, localPath) =>
    set((state) => ({
      cachedFileUrls: { ...state.cachedFileUrls, [messageId]: localPath },
    })),

  setTyping: (peerId, nickname, to) =>
    set((state) => ({
      typingUsers: {
        ...state.typingUsers,
        // to: null이면 전체채팅, to가 있으면 해당 DM
        [peerId]: { nickname, timestamp: Date.now(), to: to || null },
      },
    })),

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

  // 로그아웃 시 채팅 상태 초기화
  resetAll: () => set({
    currentRoom: { type: 'global' },
    globalMessages: [],
    dmMessages: {},
    unreadCounts: {},
    typingUsers: {},
  }),
}))

export default useChatStore
