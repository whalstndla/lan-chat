// src/store/useChatStore.js
import { create } from 'zustand'

// 현재 보고 있는 채팅방 타입
// { type: 'global' } 또는 { type: 'dm', peerId: 'xxx', nickname: '홍길동' }
const useChatStore = create((set) => ({
  currentRoom: { type: 'global' },
  globalMessages: [],
  dmMessages: {}, // { peerId: [메시지...] }
  unreadCounts: {}, // { peerId: 숫자 }
  typingUsers: {}, // { peerId: { nickname, timestamp } }

  setCurrentRoom: (room) => set({ currentRoom: room }),

  setGlobalHistory: (messages) => set({ globalMessages: messages }),

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

  setTyping: (peerId, nickname) =>
    set((state) => ({
      typingUsers: {
        ...state.typingUsers,
        [peerId]: { nickname, timestamp: Date.now() },
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
