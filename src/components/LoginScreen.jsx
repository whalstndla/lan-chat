// src/components/LoginScreen.jsx
import React, { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import logoImage from '../assets/logo.png'
import useAuthStore from '../store/useAuthStore'

export default function LoginScreen() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const { completeAuth } = useAuthStore()

  async function handleLogin() {
    if (!username.trim() || !password) {
      setErrorMessage('아이디와 비밀번호를 입력해주세요.')
      return
    }
    setIsLoading(true)
    setErrorMessage('')

    const result = await window.electronAPI.login({ username: username.trim(), password })
    setIsLoading(false)

    if (result.success) {
      completeAuth(result.nickname)
    } else {
      setErrorMessage(result.error)
    }
  }

  return (
    <div className="flex flex-col h-screen bg-vsc-bg">
      {/* macOS 드래그 영역 */}
      <div style={{ WebkitAppRegion: 'drag', height: '38px' }} className="shrink-0" />

      <div className="flex flex-1 items-center justify-center">
        <div className="w-72 bg-vsc-sidebar border border-vsc-border rounded-lg p-6">
          <div className="flex items-center gap-2 mb-1">
            <img src={logoImage} alt="LAN Chat" className="w-8 h-8 object-contain" />
            <h1 className="text-vsc-text text-lg font-semibold">LAN Chat</h1>
          </div>
          <p className="text-vsc-muted text-xs mb-5">로그인하여 채팅을 시작하세요.</p>

          <div className="space-y-3">
            <div>
              <label htmlFor="login-username" className="text-vsc-muted text-xs block mb-1">아이디</label>
              <input
                id="login-username"
                autoComplete="username"
                value={username}
                onChange={e => setUsername(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleLogin()}
                className="w-full bg-vsc-panel border border-vsc-border rounded px-3 py-2 text-sm text-vsc-text outline-none focus:border-vsc-accent"
              />
            </div>
            <div>
              <label htmlFor="login-password" className="text-vsc-muted text-xs block mb-1">비밀번호</label>
              <div className="relative">
                <input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleLogin()}
                  className="w-full bg-vsc-panel border border-vsc-border rounded px-3 py-2 pr-9 text-sm text-vsc-text outline-none focus:border-vsc-accent"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(prev => !prev)}
                  aria-label={showPassword ? '비밀번호 숨기기' : '비밀번호 보기'}
                  className="cursor-pointer absolute right-2.5 top-1/2 -translate-y-1/2 text-vsc-muted hover:text-vsc-text transition-colors duration-150"
                >
                  {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>
          </div>

          {errorMessage && (
            <p role="alert" className="text-red-400 text-xs mt-3">{errorMessage}</p>
          )}

          <button
            onClick={handleLogin}
            disabled={isLoading}
            className="cursor-pointer w-full mt-4 bg-vsc-accent text-vsc-bg font-semibold py-2 rounded text-sm hover:opacity-80 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
          >
            {isLoading ? '확인 중...' : '로그인'}
          </button>
        </div>
      </div>
    </div>
  )
}
