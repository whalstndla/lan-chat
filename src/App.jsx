// src/App.jsx
import React, { useEffect } from 'react'
import useAuthStore from './store/useAuthStore'
import SetupScreen from './components/SetupScreen'
import LoginScreen from './components/LoginScreen'

export default function App() {
  const { 인증상태, 인증된닉네임, 인증상태변경 } = useAuthStore()

  // 앱 시작 시 프로필 존재 여부로 첫 화면 결정
  useEffect(() => {
    const 인증확인 = async () => {
      const 프로필있음 = await window.electronAPI.프로필존재확인()
      인증상태변경(프로필있음 ? 'login' : 'setup')
    }
    인증확인()
  }, [])

  // 인증 완료 후 피어 발견 시작
  useEffect(() => {
    if (인증상태 !== 'authenticated' || !인증된닉네임) return
    window.electronAPI.피어발견시작()
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

  // 'authenticated' → 채팅 레이아웃 (Task 13에서 구현)
  return (
    <div className="flex h-screen bg-vsc-bg text-vsc-text overflow-hidden">
      <div className="flex items-center justify-center w-full">
        <p className="text-vsc-muted text-sm">채팅 UI 준비 중... ({인증된닉네임})</p>
      </div>
    </div>
  )
}
