// 인증 완료 후 채팅/피어 관련 모든 IPC 이벤트 구독을 모은 hook.
// App.jsx 의 거대한 useEffect 에서 분리 (Phase 3).

import { useEffect, useRef } from 'react'
import useChatStore from '../store/useChatStore'
import usePeerStore from '../store/usePeerStore'
import useUserStore from '../store/useUserStore'
import useNotificationSound from './useNotificationSound'

// authStatus 가 'authenticated' 이고 peerId 가 준비되면 모든 구독 + 피어 발견 시작.
// 반환값: cleanup 함수 (App 에서 useEffect cleanup 으로 사용)
export default function useChatSubscriptions({ authStatus, authenticatedNickname, setPatchNotesHighlight, setShowPatchNotes }) {
  const { play: playNotification } = useNotificationSound()
  // playNotification 은 알림 볼륨(notificationVolume)이 바뀔 때마다 재생성되는 함수라
  // 아래 구독 useEffect의 의존성에 그대로 넣으면 볼륨 슬라이더 조작만으로 effect가
  // 재실행되어 initChat()이 다시 돌며 P2P 연결 전체가 종료·재탐색된다. ref로 최신 함수만
  // 참조하고 effect 의존성에서는 제외한다.
  const playNotificationRef = useRef(playNotification)
  useEffect(() => {
    playNotificationRef.current = playNotification
  }, [playNotification])

  useEffect(() => {
    if (authStatus !== 'authenticated' || !authenticatedNickname) return

    // 창이 백그라운드 상태였던 동안 보류된 read receipt 를 포커스 복귀 시점에 일괄 발송.
    // 현재 보고 있는 방이 DM 이 아니면 아무 것도 하지 않는다.
    const handleWindowFocus = () => {
      const { currentRoom } = useChatStore.getState()
      if (currentRoom.type !== 'dm') return
      const peerId = currentRoom.peerId
      useChatStore.getState().resetUnread(peerId)
      window.electronAPI.getUnreadDMIds(peerId)
        .then(unreadIds => {
          if (unreadIds.length > 0) {
            window.electronAPI.sendReadReceipt(peerId, unreadIds).catch(() => {})
          }
        })
        .catch(() => {})
    }
    window.addEventListener('focus', handleWindowFocus)

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

      // 안읽은 개수 복원 — DB 의 read=0 카운트를 사이드바 배지에 반영 (재시작 시 0으로 보이던 문제)
      const unreadCounts = await window.electronAPI.getUnreadCounts()
      useChatStore.getState().setUnreadCounts(unreadCounts)

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

          // 창이 백그라운드(비포커스)면 방을 보고 있어도 실제로 읽은 게 아니므로
          // read receipt 를 보내지 않는다 — document.hasFocus() 로 확인.
          // 포커스가 없어 보류된 메시지는 창 포커스 복귀 시 일괄 발송된다(아래 handleWindowFocus).
          const { currentRoom } = useChatStore.getState()
          if (currentRoom.type === 'dm' && currentRoom.peerId === senderId && document.hasFocus()) {
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

      // 상대가 메시지를 전송해 typing-stop 을 보내오면 3초 만료를 기다리지 않고 즉시 해제
      window.electronAPI.onTypingStop(({ fromId }) => {
        useChatStore.getState().clearTyping(fromId)
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
        playNotificationRef.current()
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
      window.removeEventListener('focus', handleWindowFocus)
    }
  }, [authStatus, authenticatedNickname, setPatchNotesHighlight, setShowPatchNotes])
}
