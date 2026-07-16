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

    // 로그아웃/컴포넌트 해제 뒤 이전 세션의 비동기 초기화가 store 를 다시 채우거나
    // IPC 구독과 피어 탐색을 재등록하지 못하도록 각 await 경계에서 확인한다.
    let isSubscriptionCancelled = false

    // 창이 백그라운드 상태였던 동안 보류된 read receipt 를 포커스 복귀 시점에 일괄 발송.
    // 현재 보고 있는 방이 DM 이 아니면 아무 것도 하지 않는다.
    const handleWindowFocus = () => {
      const { currentRoom } = useChatStore.getState()
      if (currentRoom.type !== 'dm') return
      const peerId = currentRoom.peerId
      useChatStore.getState().resetUnread(peerId)
      window.electronAPI.getUnreadDMIds(peerId)
        .then(unreadIds => {
          if (isSubscriptionCancelled) return
          if (unreadIds.length > 0) {
            window.electronAPI.sendReadReceipt(peerId, unreadIds).catch(() => {})
          }
        })
        .catch(() => {})
    }
    window.addEventListener('focus', handleWindowFocus)

    const initChat = async () => {
      const { peerId, nickname, profileImageUrl } = await window.electronAPI.getMyInfo()
      if (isSubscriptionCancelled) return

      // 방별 마지막 읽은 지점 복원(#39) — myPeerId 를 설정(initialize)하기 전에 먼저
      // 하이드레이션해야 한다. ChatWindow 의 "첫 진입 시 lastRead 캡처" 로직이 myPeerId
      // 변경으로 재실행될 때, 이미 스토어에 DB 값이 채워져 있어야 null 로 덮어쓰지 않는다.
      const roomReadState = await window.electronAPI.getRoomReadState()
      if (isSubscriptionCancelled) return
      useChatStore.getState().setLastReadTimestamps(roomReadState)

      useUserStore.getState().initialize(peerId, nickname, profileImageUrl)

      const history = await window.electronAPI.getGlobalHistory()
      if (isSubscriptionCancelled) return
      useChatStore.getState().setGlobalHistory(history)

      // 리액션 하이드레이션 — 화면에 로드된 메시지 ID들의 리액션을 배치 조회해 병합
      if (history.length > 0) {
        const reactionRows = await window.electronAPI.getReactions(history.map(m => m.id))
        if (isSubscriptionCancelled) return
        useChatStore.getState().setReactions(reactionRows)
      }

      const dmPeers = await window.electronAPI.getDMPeers()
      if (isSubscriptionCancelled) return
      usePeerStore.getState().setPastDMPeers(dmPeers)

      // 안읽은 개수 복원 — DB 의 read=0 카운트를 사이드바 배지에 반영 (재시작 시 0으로 보이던 문제)
      const unreadCounts = await window.electronAPI.getUnreadCounts()
      if (isSubscriptionCancelled) return
      useChatStore.getState().setUnreadCounts(unreadCounts)

      const versionInfo = await window.electronAPI.getAppVersionInfo()
      if (isSubscriptionCancelled) return
      if (versionInfo.updatedFromVersion) {
        setPatchNotesHighlight(versionInfo.currentVersion)
        setShowPatchNotes(true)
      }

      const notificationSettings = await window.electronAPI.getNotificationSettings()
      if (isSubscriptionCancelled) return
      useUserStore.getState().setNotificationSettings(notificationSettings)

      // 뮤트된 채팅방 집합을 main 에 동기화 — 소리/OS알림 억제 판정 기준이 된다(#4).
      // 이후 토글은 ChatWindow 의 뮤트 버튼에서 즉시 재동기화한다.
      const mutedRooms = useChatStore.getState().mutedRooms
      window.electronAPI.setMutedRooms(Object.keys(mutedRooms).filter((roomKey) => mutedRooms[roomKey]))

      // StrictMode 중복 방지 — 기존 리스너 정리 후 새로 등록
      window.electronAPI.unsubscribeAll()

      // 이벤트 구독 — 피어 발견 시작 전에 등록해야 race condition 방지
      window.electronAPI.subscribeToMessages((message) => {
        if (message.type === 'message') {
          useChatStore.getState().addGlobalMessage(message)

          // 전체채팅 안읽음 배지(#39) — DM 과 동일한 판정: 지금 전체채팅을 보고 있고
          // 창이 포커스 상태면 이미 읽은 것으로 간주해 배지를 증가시키지 않는다.
          // (내가 보낸 메시지는 send-global-message 응답으로만 반영되고 이 이벤트로
          // 되돌아오지 않으므로 별도의 isMyMessage 체크는 필요 없다.)
          const { currentRoom } = useChatStore.getState()
          const isActivelyViewingGlobal = currentRoom.type === 'global' && document.hasFocus()
          if (!isActivelyViewingGlobal) {
            useChatStore.getState().incrementUnread('global')
          }
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
            // 뮤트된 방이라도 안읽음 배지는 항상 증가한다 — 뮤트는 소리/OS알림만
            // 억제하도록 재정의됐다(#4). 소리/OS알림 억제는 main 프로세스가 판정한다.
            useChatStore.getState().incrementUnread(senderId)
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

      // #31 히스토리 동기화 — 연결 시 상대에게서 받은 과거 전체채팅 메시지 배치를 병합.
      // mergeGlobalMessages 가 id 중복 제거 + timestamp 정렬로 올바른 순서에 끼워 넣는다.
      window.electronAPI.onGlobalHistorySynced((messages) => {
        useChatStore.getState().mergeGlobalMessages(messages)
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

      // 청크 전송 진행률(#44/#45/#49) — 말풍선 스피너를 퍼센트로 갱신.
      window.electronAPI.onFileProgress(({ messageId, received, total }) => {
        useChatStore.getState().setFileTransferProgress(messageId, received, total)
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

      // 유휴 자동 자리비움/복원 등 main 프로세스가 스스로 내 상태를 바꾼 경우 반영(#41)
      window.electronAPI.onMyStatusChanged(({ statusType, statusMessage }) => {
        useUserStore.getState().setMyStatus(statusType, statusMessage)
      })

      window.electronAPI.onPendingMessagesFlushed(({ targetPeerId, messageIds }) => {
        useChatStore.getState().clearPendingMessages(targetPeerId, messageIds)
      })

      // TOFU 키 변경 경고(#59) — 상대 공개키가 고정 키와 달라지면 경고 대상에 표시하고,
      // 정상 키로 복귀(resolved)하면 해제한다. 실제 신뢰 승인은 경고 모달에서 처리한다.
      window.electronAPI.onPeerKeyChanged((data) => {
        if (!data?.peerId) return
        if (data.resolved) {
          usePeerStore.getState().clearKeyChanged(data.peerId)
        } else {
          usePeerStore.getState().markKeyChanged(data.peerId, data.nickname, data.fingerprint)
        }
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
        // 떠난 피어의 키 변경 경고도 함께 정리 — 재연결 시 hello 로 다시 판정된다(#59).
        usePeerStore.getState().clearKeyChanged(leftPeerId)
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
      if (isSubscriptionCancelled) return
      await window.electronAPI.startPeerDiscovery()
    }

    initChat()

    const typingCleanupInterval = setInterval(() => {
      useChatStore.getState().clearExpiredTyping()
    }, 1000)

    return () => {
      isSubscriptionCancelled = true
      window.electronAPI.unsubscribeAll()
      clearInterval(typingCleanupInterval)
      window.removeEventListener('focus', handleWindowFocus)
    }
  }, [authStatus, authenticatedNickname, setPatchNotesHighlight, setShowPatchNotes])
}
