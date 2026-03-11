// src/App.jsx
import React, { useEffect, useRef, useState } from 'react'
import logoImage from './assets/logo.png'
import useAuthStore from './store/useAuthStore'
import useUserStore from './store/useUserStore'
import usePeerStore from './store/usePeerStore'
import useChatStore from './store/useChatStore'
import SetupScreen from './components/SetupScreen'
import LoginScreen from './components/LoginScreen'
import Sidebar from './components/Sidebar'
import ChatWindow from './components/ChatWindow'

// macOS hiddenInset 타이틀바: 트래픽 라이트(80×38px) 안전 영역 + 드래그 핸들
function TitleBar({ nickname, updateState, onCheckUpdate }) {
  const handleRightButtonClick = () => {
    if (updateState === 'downloaded') {
      window.electronAPI.installUpdate()
    } else if (updateState === 'idle' || updateState === 'not-available' || updateState === 'error') {
      onCheckUpdate()
    }
  }

  const rightButtonLabel = {
    idle: '업데이트 확인',
    checking: '확인 중...',
    available: '다운로드 중...',
    downloaded: '지금 업데이트',
    'not-available': '최신 버전',
    error: '재시도',
  }[updateState] ?? '업데이트 확인'

  const rightButtonStyle = {
    downloaded: 'bg-blue-600 hover:bg-blue-500 text-white',
    'not-available': 'bg-transparent text-vsc-muted cursor-default',
    checking: 'bg-transparent text-vsc-muted cursor-default',
    available: 'bg-transparent text-vsc-muted cursor-default',
  }[updateState] ?? 'bg-transparent hover:bg-vsc-border text-vsc-muted hover:text-vsc-text'

  const isDisabled = updateState === 'checking' || updateState === 'available' || updateState === 'not-available'

  return (
    <div
      style={{ WebkitAppRegion: 'drag', height: '38px' }}
      className="shrink-0 bg-vsc-sidebar border-b border-vsc-border flex items-center justify-between pr-3"
    >
      {/* 좌측: 트래픽 라이트 안전 영역(pl-20) 후 앱 타이틀 */}
      <div className="flex items-center gap-2 pl-20 select-none">
        <img src={logoImage} alt="LAN Chat" className="w-4 h-4 object-contain shrink-0" />
        <span className="text-vsc-text text-xs font-semibold">LAN Chat</span>
        {nickname && <span className="text-vsc-muted text-xs">— {nickname}</span>}
      </div>

      {/* 우측: 업데이트 버튼 */}
      <div style={{ WebkitAppRegion: 'no-drag' }}>
        <button
          onClick={handleRightButtonClick}
          disabled={isDisabled}
          className={`text-xs px-2 py-0.5 rounded transition-colors select-none ${rightButtonStyle} ${isDisabled ? 'cursor-default' : 'cursor-pointer'}`}
        >
          {rightButtonLabel}
        </button>
      </div>
    </div>
  )
}

export default function App() {
  const { authStatus, authenticatedNickname, setAuthStatus } = useAuthStore()
  const { initialize } = useUserStore()
  const { addPeer, removePeer } = usePeerStore()
  const { setGlobalHistory, addGlobalMessage, addDMMessage, incrementUnread, setTyping, clearExpiredTyping, removeGlobalMessage, removeDMMessage } = useChatStore()
  const myPeerId = useUserStore(state => state.myPeerId)
  // 'idle' | 'checking' | 'available' | 'downloaded' | 'not-available' | 'error'
  const [updateState, setUpdateState] = useState('idle')
  const [downloadPercent, setDownloadPercent] = useState(0)
  const updateDownloadedRef = useRef(false)

  // 업데이트 확인 완료 후 인증 화면으로 진행
  const proceedToAuth = async () => {
    const hasProfile = await window.electronAPI.checkProfileExists()
    setAuthStatus(hasProfile ? 'login' : 'setup')
  }

  // 앱 시작 시 업데이트 확인 → 완료 후 인증 화면으로 전환
  useEffect(() => {
    setUpdateState('checking')

    window.electronAPI.onUpdateAvailable(() => setUpdateState('available'))
    window.electronAPI.onDownloadProgress((percent) => setDownloadPercent(percent))
    window.electronAPI.onUpdateDownloaded(() => {
      updateDownloadedRef.current = true
      setUpdateState('downloaded')
    })
    window.electronAPI.onUpdateNotAvailable(() => {
      setUpdateState('not-available')
      if (!updateDownloadedRef.current) proceedToAuth()
    })
    window.electronAPI.onUpdateError(() => {
      setUpdateState('error')
      if (!updateDownloadedRef.current) proceedToAuth()
    })

    window.electronAPI.checkForUpdates()
  }, [])

  const handleCheckUpdate = () => {
    setUpdateState('checking')
    window.electronAPI.checkForUpdates()
  }

  const handleSkipUpdate = () => {
    proceedToAuth()
  }

  // 인증 완료 후 채팅 초기화
  useEffect(() => {
    if (authStatus !== 'authenticated' || !authenticatedNickname) return

    const initChat = async () => {
      const { peerId, nickname } = await window.electronAPI.getMyInfo()
      initialize(peerId, nickname)

      // 이전 채팅 기록 불러오기
      const history = await window.electronAPI.getGlobalHistory()
      setGlobalHistory(history)

      // 피어 발견 시작
      await window.electronAPI.startPeerDiscovery()

      // 이벤트 구독
      window.electronAPI.subscribeToMessages((message) => {
        if (message.type === 'message') {
          addGlobalMessage(message)
        } else if (message.type === 'dm') {
          const senderId = message.fromId === peerId ? message.to : message.fromId
          addDMMessage(senderId, message)

          // 현재 보고 있지 않은 DM방이면 안읽은 수 증가
          const { currentRoom } = useChatStore.getState()
          if (!(currentRoom.type === 'dm' && currentRoom.peerId === senderId)) {
            incrementUnread(senderId)
          }
        } else if (message.type === 'delete-message') {
          if (message.to) {
            // DM 메시지 삭제 — 대화 상대방의 peerId 추출
            const dmPeerId = message.fromId === peerId ? message.to : message.fromId
            removeDMMessage(dmPeerId, message.messageId)
          } else {
            removeGlobalMessage(message.messageId)
          }
        }
      })

      window.electronAPI.onTypingEvent((data) => {
        setTyping(data.fromId, data.from)
      })

      window.electronAPI.subscribeToPeerDiscovery(addPeer)
      window.electronAPI.subscribeToPeerLeft(removePeer)
    }

    initChat()

    const typingCleanupInterval = setInterval(clearExpiredTyping, 1000)

    return () => {
      window.electronAPI.unsubscribeAll()
      clearInterval(typingCleanupInterval)
    }
  }, [authStatus])

  if (authStatus === 'loading') {
    const statusText = {
      checking: '업데이트 확인 중...',
      available: `다운로드 중... ${downloadPercent}%`,
      downloaded: '업데이트 준비 완료',
      error: '업데이트 확인 실패',
    }[updateState]

    return (
      <div className="flex flex-col h-screen bg-vsc-bg">
        <TitleBar updateState={updateState} onCheckUpdate={handleCheckUpdate} />
        <div className="flex-1 flex flex-col items-center justify-center gap-4">
          <img src={logoImage} alt="LAN Chat" className="w-12 h-12 object-contain opacity-80" />
          <p className="text-vsc-muted text-sm">{statusText}</p>

          {/* 다운로드 진행 바 */}
          {updateState === 'available' && (
            <div className="w-48 flex flex-col items-center gap-2">
              <div className="w-full h-1 bg-vsc-border rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-500 rounded-full transition-all duration-300"
                  style={{ width: `${downloadPercent}%` }}
                />
              </div>
              <button
                onClick={handleSkipUpdate}
                className="text-xs text-vsc-muted hover:text-vsc-text transition-colors cursor-pointer underline"
              >
                건너뛰기
              </button>
            </div>
          )}

          {updateState === 'downloaded' && (
            <div className="flex gap-2 mt-1">
              <button
                onClick={() => window.electronAPI.installUpdate()}
                className="text-xs px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white transition-colors cursor-pointer"
              >
                지금 업데이트
              </button>
              <button
                onClick={handleSkipUpdate}
                className="text-xs px-3 py-1.5 rounded bg-vsc-border hover:bg-vsc-sidebar text-vsc-muted transition-colors cursor-pointer"
              >
                건너뛰기
              </button>
            </div>
          )}
        </div>
      </div>
    )
  }

  if (authStatus === 'setup') return <SetupScreen />
  if (authStatus === 'login') return <LoginScreen />

  // 'authenticated' → 채팅 레이아웃
  if (!myPeerId) {
    return (
      <div className="flex flex-col h-screen bg-vsc-bg text-vsc-text">
        <TitleBar nickname={authenticatedNickname} updateState={updateState} onCheckUpdate={handleCheckUpdate} />
        <div className="flex-1 flex items-center justify-center">
          <p className="text-vsc-muted text-sm">초기화 중...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-screen bg-vsc-bg text-vsc-text overflow-hidden">
      {/* macOS 타이틀 바 (트래픽 라이트 안전 영역) */}
      <TitleBar nickname={authenticatedNickname} updateState={updateState} onCheckUpdate={handleCheckUpdate} />
      {/* 사이드바 + 채팅창 */}
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <ChatWindow />
      </div>
    </div>
  )
}
