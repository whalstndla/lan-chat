// src/App.jsx
import React, { useEffect, useState } from 'react'
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
function TitleBar({ nickname, updateState }) {
  const handleUpdateClick = () => {
    if (updateState === 'downloaded') {
      window.electronAPI.installUpdate()
    }
  }

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

      {/* 업데이트 버튼 — 드래그 영역 안에서 클릭 가능하도록 pointer-events 복원 */}
      {updateState === 'available' && (
        <div style={{ WebkitAppRegion: 'no-drag' }} className="flex items-center gap-1.5 select-none">
          <span className="text-vsc-muted text-xs">업데이트 다운로드 중...</span>
        </div>
      )}
      {updateState === 'downloaded' && (
        <div style={{ WebkitAppRegion: 'no-drag' }}>
          <button
            onClick={handleUpdateClick}
            className="text-xs px-2 py-0.5 rounded bg-blue-600 hover:bg-blue-500 text-white transition-colors cursor-pointer select-none"
          >
            지금 업데이트
          </button>
        </div>
      )}
    </div>
  )
}

export default function App() {
  const { authStatus, authenticatedNickname, setAuthStatus } = useAuthStore()
  const { initialize } = useUserStore()
  const { addPeer, removePeer } = usePeerStore()
  const { setGlobalHistory, addGlobalMessage, addDMMessage, incrementUnread } = useChatStore()
  const myPeerId = useUserStore(state => state.myPeerId)
  // 'idle' | 'available' | 'downloaded'
  const [updateState, setUpdateState] = useState('idle')

  // 앱 시작 시 프로필 존재 여부로 첫 화면 결정
  useEffect(() => {
    const checkAuth = async () => {
      const hasProfile = await window.electronAPI.checkProfileExists()
      setAuthStatus(hasProfile ? 'login' : 'setup')
    }
    checkAuth()
  }, [])

  // 자동 업데이트 이벤트 구독
  useEffect(() => {
    window.electronAPI.onUpdateAvailable(() => setUpdateState('available'))
    window.electronAPI.onUpdateDownloaded(() => setUpdateState('downloaded'))
  }, [])

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
        }
      })

      window.electronAPI.subscribeToPeerDiscovery(addPeer)
      window.electronAPI.subscribeToPeerLeft(removePeer)
    }

    initChat()

    return () => window.electronAPI.unsubscribeAll()
  }, [authStatus])

  if (authStatus === 'loading') {
    return (
      <div className="flex flex-col h-screen bg-vsc-bg">
        <TitleBar updateState={updateState} />
        <div className="flex-1 flex items-center justify-center">
          <p className="text-vsc-muted text-sm">로딩 중...</p>
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
        <TitleBar nickname={authenticatedNickname} updateState={updateState} />
        <div className="flex-1 flex items-center justify-center">
          <p className="text-vsc-muted text-sm">초기화 중...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-screen bg-vsc-bg text-vsc-text overflow-hidden">
      {/* macOS 타이틀 바 (트래픽 라이트 안전 영역) */}
      <TitleBar nickname={authenticatedNickname} />
      {/* 사이드바 + 채팅창 */}
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <ChatWindow />
      </div>
    </div>
  )
}
