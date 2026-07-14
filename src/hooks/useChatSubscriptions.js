// 인증 완료 후 채팅/피어 관련 모든 IPC 이벤트 구독을 모은 hook.
// App.jsx 의 거대한 useEffect 에서 분리 (Phase 3).

import { useEffect } from 'react'
import useChatStore from '../store/useChatStore'
import usePeerStore from '../store/usePeerStore'
import useUserStore from '../store/useUserStore'
import useNotificationSound from './useNotificationSound'

// authStatus 가 'authenticated' 이고 peerId 가 준비되면 모든 구독 + 피어 발견 시작.
// 반환값: cleanup 함수 (App 에서 useEffect cleanup 으로 사용)
export default function useChatSubscriptions({ authStatus, authenticatedNickname, setPatchNotesHighlight, setShowPatchNotes }) {
  const { play: playNotification } = useNotificationSound()

  useEffect(() => {
    if (authStatus !== 'authenticated' || !authenticatedNickname) return

    const initChat = async () => {
      const { peerId, nickname, profileImageUrl } = await window.electronAPI.getMyInfo()
      useUserStore.getState().initialize(peerId, nickname, profileImageUrl)

      const history = await window.electronAPI.getGlobalHistory()
      useChatStore.getState().setGlobalHistory(history)

      // 리액션 하이드레이션 — 화면에 로드된 메시지 ID들의 리액션을 배치 조회해 병합
      if (history.length > 0) {
        const reactionRows = await window.electronAPI.getReactions(history.map(m => m.id))
        useChatStore.getState().setReactions(reactionRows)
      }

      const dmPeers = await window.electronAPI.getDMPeers()
      usePeerStore.getState().setPastDMPeers(dmPeers)

      const versionInfo = await window.electronAPI.getAppVersionInfo()
      if (versionInfo.updatedFromVersion) {
        setPatchNotesHighlight(versionInfo.currentVersion)
        setShowPatchNotes(true)
      }

      const notificationSettings = await window.electronAPI.getNotificationSettings()
      useUserStore.getState().setNotificationSettings(notificationSettings)

      // StrictMode 중복 방지 — 기존 리스너 정리 후 새로 등록
      window.electronAPI.unsubscribeAll()

      // 이벤트 구독 — 피어 발견 시작 전에 등록해야 race condition 방지
      window.electronAPI.subscribeToMessages((message) => {
        if (message.type === 'message') {
          useChatStore.getState().addGlobalMessage(message)
        } else if (message.type === 'dm') {
          const senderId = message.fromId === peerId
            ? (message.to || message.to_id)
            : (message.fromId || message.from_id)
          if (!senderId) return
          useChatStore.getState().addDMMessage(senderId, message)

          const senderPeer = usePeerStore.getState().onlinePeers.find(p => p.peerId === senderId)
          if (senderPeer) {
            usePeerStore.getState().addPastDMPeer({ peerId: senderId, nickname: senderPeer.nickname })
          }

          const { currentRoom } = useChatStore.getState()
          if (currentRoom.type === 'dm' && currentRoom.peerId === senderId) {
            window.electronAPI.sendReadReceipt(senderId, [message.id]).catch(() => {})
          } else {
            const isMuted = !!useChatStore.getState().mutedRooms[senderId]
            if (!isMuted) useChatStore.getState().incrementUnread(senderId)
          }
        } else if (message.type === 'delete-message') {
          if (message.to) {
            const dmPeerId = message.fromId === peerId ? message.to : message.fromId
            useChatStore.getState().removeDMMessage(dmPeerId, message.messageId)
          } else {
            useChatStore.getState().removeGlobalMessage(message.messageId)
          }
        }
      })

      window.electronAPI.onTypingEvent((data) => {
        useChatStore.getState().setTyping(data.fromId, data.from, data.to || null)
      })

      window.electronAPI.onFileCached(({ messageId }) => {
        // 디스크 파일은 ciphertext 라 file:// 직접 표시 불가. lanchat:// 핸들러를 통해
        // 메모리에서 복호화해 응답한다. cache buster 로 첫 시도(lanchat://<id>) 와 다른
        // string 을 만들어 React 가 새로 fetch 하도록 강제.
        const url = `lanchat://file/${encodeURIComponent(messageId)}?ws=${Date.now()}`
        useChatStore.getState().setCachedFileUrl(messageId, url)
      })

      // 파일 요청 실패 (송신측 명시적 에러 또는 retry 소진) → 렌더러 즉시 failed 전환.
      window.electronAPI.onFileRequestError(({ messageId, reason }) => {
        useChatStore.getState().setFileLoadError(messageId, reason)
      })

      window.electronAPI.onPeerNicknameChanged(({ peerId: changedPeerId, nickname: newNickname }) => {
        usePeerStore.getState().updatePeerNickname(changedPeerId, newNickname)
        const { currentRoom, setCurrentRoom } = useChatStore.getState()
        if (currentRoom.type === 'dm' && currentRoom.peerId === changedPeerId) {
          setCurrentRoom({ ...currentRoom, nickname: newNickname })
        }
      })

      window.electronAPI.onPeerProfileUpdated(({ peerId: updatedPeerId, profileImageUrl: updatedImageUrl }) => {
        usePeerStore.getState().updatePeer(updatedPeerId, { profileImageUrl: updatedImageUrl })
      })

      window.electronAPI.onPeerStatusChanged(({ peerId: statusPeerId, statusType, statusMessage }) => {
        usePeerStore.getState().updatePeer(statusPeerId, { statusType, statusMessage })
      })

      window.electronAPI.onPendingMessagesFlushed(({ targetPeerId, messageIds }) => {
        useChatStore.getState().clearPendingMessages(targetPeerId, messageIds)
      })

      window.electronAPI.onReadReceipt(({ fromId, messageIds }) => {
        useChatStore.getState().markMessagesAsRead(fromId, messageIds)
      })

      window.electronAPI.subscribeToPeerDiscovery(usePeerStore.getState().addPeer)

      window.electronAPI.subscribeToPeerLeft((leftPeerId) => {
        const peer = usePeerStore.getState().onlinePeers.find(p => p.peerId === leftPeerId)
        if (peer) {
          usePeerStore.getState().addPastDMPeer({ peerId: peer.peerId, nickname: peer.nickname })
        }
        usePeerStore.getState().removePeer(leftPeerId)
      })

      window.electronAPI.onPlayNotificationSound(() => {
        playNotification()
      })

      window.electronAPI.onNavigateToRoom((room) => {
        useChatStore.getState().setCurrentRoom(room)
      })

      // 이모지 리액션 — 상대방이 추가/제거한 리액션을 스토어에 실시간 반영
      window.electronAPI.onReactionUpdated(({ messageId, peerId, emoji, action }) => {
        useChatStore.getState().updateReaction(messageId, emoji, peerId, action)
      })

      window.electronAPI.onMessageEdited(({ messageId, fromId, newContent, editedAt, to }) => {
        const { editGlobalMessage, editDMMessage } = useChatStore.getState()
        if (to) editDMMessage(fromId, messageId, newContent, editedAt)
        else editGlobalMessage(messageId, newContent, editedAt)
      })

      // 피어 발견 시작 — 구독 등록 후 시작해야 race condition 방지
      await window.electronAPI.startPeerDiscovery()
    }

    initChat()

    const typingCleanupInterval = setInterval(() => {
      useChatStore.getState().clearExpiredTyping()
    }, 1000)

    return () => {
      window.electronAPI.unsubscribeAll()
      clearInterval(typingCleanupInterval)
    }
  }, [authStatus, authenticatedNickname, playNotification, setPatchNotesHighlight, setShowPatchNotes])
}
