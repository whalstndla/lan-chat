// src/App.jsx
import React, { useEffect } from 'react'
import useAuthStore from './store/useAuthStore'
import useUserStore from './store/useUserStore'
import usePeerStore from './store/usePeerStore'
import useChatStore from './store/useChatStore'
import SetupScreen from './components/SetupScreen'
import LoginScreen from './components/LoginScreen'
import Sidebar from './components/Sidebar'
import ChatWindow from './components/ChatWindow'

export default function App() {
  const { 인증상태, 인증된닉네임, 인증상태변경 } = useAuthStore()
  const { 초기화 } = useUserStore()
  const { 피어추가, 피어제거 } = usePeerStore()
  const { 전체채팅기록설정, 전체채팅메시지추가, DM메시지추가 } = useChatStore()
  const 나의피어아이디 = useUserStore(상태 => 상태.나의피어아이디)

  // 앱 시작 시 프로필 존재 여부로 첫 화면 결정
  useEffect(() => {
    const 인증확인 = async () => {
      const 프로필있음 = await window.electronAPI.프로필존재확인()
      인증상태변경(프로필있음 ? 'login' : 'setup')
    }
    인증확인()
  }, [])

  // 인증 완료 후 채팅 초기화
  useEffect(() => {
    if (인증상태 !== 'authenticated' || !인증된닉네임) return

    const 채팅초기화 = async () => {
      const { 피어아이디, 닉네임 } = await window.electronAPI.내정보조회()
      초기화(피어아이디, 닉네임)

      // 이전 채팅 기록 불러오기
      const 기록 = await window.electronAPI.전체채팅기록조회()
      전체채팅기록설정(기록)

      // 피어 발견 시작
      await window.electronAPI.피어발견시작()

      // 이벤트 구독
      window.electronAPI.메시지수신구독((메시지) => {
        if (메시지.type === 'message') {
          전체채팅메시지추가(메시지)
        } else if (메시지.type === 'dm') {
          const 상대방아이디 = 메시지.fromId === 피어아이디 ? 메시지.to : 메시지.fromId
          DM메시지추가(상대방아이디, 메시지)
        }
      })

      window.electronAPI.피어발견구독(피어추가)
      window.electronAPI.피어퇴장구독(피어제거)
    }

    채팅초기화()

    return () => window.electronAPI.모든구독해제()
  }, [인증상태])

  if (인증상태 === 'loading') {
    return (
      <div className="flex h-screen bg-vsc-bg items-center justify-center">
        <p className="text-vsc-muted text-sm">로딩 중...</p>
      </div>
    )
  }

  if (인증상태 === 'setup') return <SetupScreen />
  if (인증상태 === 'login') return <LoginScreen />

  // 'authenticated' → 채팅 레이아웃
  if (!나의피어아이디) {
    return (
      <div className="flex h-screen bg-vsc-bg items-center justify-center">
        <p className="text-vsc-muted text-sm">초기화 중...</p>
      </div>
    )
  }

  return (
    <div className="flex h-screen bg-vsc-bg text-vsc-text overflow-hidden">
      <Sidebar />
      <ChatWindow />
    </div>
  )
}
