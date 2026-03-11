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
    set((state) => ({
      globalMessages: [...state.globalMessages, message],
    })),

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
      const filtered = {}
      for (const [key, value] of Object.entries(state.typingUsers)) {
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
}))

export default useChatStore
