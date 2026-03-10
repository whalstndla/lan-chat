// src/components/SetupScreen.jsx
import React, { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import logoImage from '../assets/logo.png'
import useAuthStore from '../store/useAuthStore'

export default function SetupScreen() {
  const [nickname, setNickname] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showPasswordConfirm, setShowPasswordConfirm] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const { completeAuth } = useAuthStore()

  async function handleRegister() {
    setErrorMessage('')

    if (!nickname.trim() || !username.trim() || !password) {
      setErrorMessage('모든 항목을 입력해주세요.')
      return
    }
    if (password !== passwordConfirm) {
      setErrorMessage('비밀번호가 일치하지 않습니다.')
      return
    }
    if (password.length < 4) {
      setErrorMessage('비밀번호는 4자 이상이어야 합니다.')
      return
    }

    setIsLoading(true)
    const result = await window.electronAPI.register({ username: username.trim(), nickname: nickname.trim(), password })
    setIsLoading(false)

    if (result.success) {
      completeAuth(nickname.trim())
    } else {
      setErrorMessage(result.error)
    }
  }

  return (
    <div className="flex flex-col h-screen bg-vsc-bg">
      {/* macOS 드래그 영역 */}
      <div style={{ WebkitAppRegion: 'drag', height: '38px' }} className="shrink-0" />

      <div className="flex flex-1 items-center justify-center">
        <div className="w-80 bg-vsc-sidebar border border-vsc-border rounded-lg p-6">
          <div className="flex items-center gap-2 mb-1">
            <img src={logoImage} alt="LAN Chat" className="w-8 h-8 object-contain" />
            <h1 className="text-vsc-text text-lg font-semibold">LAN Chat</h1>
          </div>
          <p className="text-vsc-muted text-xs mb-5">처음 실행되었습니다. 프로필을 설정해주세요.</p>

          <div className="space-y-3">
            <div>
              <label htmlFor="setup-nickname" className="text-vsc-muted text-xs block mb-1">
                닉네임 <span className="text-vsc-muted">(채팅에서 표시됨)</span>
              </label>
              <input
                id="setup-nickname"
                autoComplete="nickname"
                value={nickname}
                onChange={e => setNickname(e.target.value)}
                placeholder="홍길동"
                className="w-full bg-vsc-panel border border-vsc-border rounded px-3 py-2 text-sm text-vsc-text outline-none focus:border-vsc-accent"
              />
            </div>
            <div>
              <label htmlFor="setup-username" className="text-vsc-muted text-xs block mb-1">
                아이디 <span className="text-vsc-muted">(로컬 로그인용)</span>
              </label>
              <input
                id="setup-username"
                autoComplete="username"
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder="hong"
                className="w-full bg-vsc-panel border border-vsc-border rounded px-3 py-2 text-sm text-vsc-text outline-none focus:border-vsc-accent"
              />
            </div>
            <div>
              <label htmlFor="setup-password" className="text-vsc-muted text-xs block mb-1">비밀번호</label>
              <div className="relative">
                <input
                  id="setup-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
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
            <div>
              <label htmlFor="setup-password-confirm" className="text-vsc-muted text-xs block mb-1">비밀번호 확인</label>
              <div className="relative">
                <input
                  id="setup-password-confirm"
                  type={showPasswordConfirm ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={passwordConfirm}
                  onChange={e => setPasswordConfirm(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleRegister()}
                  className="w-full bg-vsc-panel border border-vsc-border rounded px-3 py-2 pr-9 text-sm text-vsc-text outline-none focus:border-vsc-accent"
                />
                <button
                  type="button"
                  onClick={() => setShowPasswordConfirm(prev => !prev)}
                  aria-label={showPasswordConfirm ? '비밀번호 확인 숨기기' : '비밀번호 확인 보기'}
                  className="cursor-pointer absolute right-2.5 top-1/2 -translate-y-1/2 text-vsc-muted hover:text-vsc-text transition-colors duration-150"
                >
                  {showPasswordConfirm ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>
          </div>

          {errorMessage && (
            <p role="alert" className="text-red-400 text-xs mt-3">{errorMessage}</p>
          )}

          <button
            onClick={handleRegister}
            disabled={isLoading}
            className="cursor-pointer w-full mt-4 bg-vsc-accent text-vsc-bg font-semibold py-2 rounded text-sm hover:opacity-80 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
          >
            {isLoading ? '설정 중...' : '시작하기'}
          </button>

          <p className="text-vsc-muted text-xs mt-3 text-center">아이디와 비밀번호는 이 PC에만 저장됩니다.</p>
        </div>
      </div>
    </div>
  )
}
