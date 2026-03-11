// src/components/SettingsPanel.jsx
import React, { useState, useRef } from 'react'
import { X, LogOut, Camera, Check } from 'lucide-react'
import useAuthStore from '../store/useAuthStore'
import useUserStore from '../store/useUserStore'
import usePeerStore from '../store/usePeerStore'
import useChatStore from '../store/useChatStore'

export default function SettingsPanel({ onClose }) {
  const { setAuthStatus } = useAuthStore()
  const { myNickname, myProfileImageUrl, updateMyNickname, updateMyProfileImageUrl, reset: resetUser } = useUserStore()
  const { clearAllPeers } = usePeerStore()
  const { resetAll } = useChatStore()

  const [nicknameInput, setNicknameInput] = useState(myNickname || '')
  const [isSaving, setIsSaving] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const fileInputRef = useRef(null)

  async function handleNicknameSave() {
    const trimmed = nicknameInput.trim()
    if (!trimmed || trimmed === myNickname) return
    setIsSaving(true)
    const result = await window.electronAPI.updateNickname(trimmed)
    setIsSaving(false)
    if (result.success) {
      updateMyNickname(trimmed)
      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 2000)
    }
  }

  async function handleImageSelect(event) {
    const file = event.target.files?.[0]
    if (!file) return
    const buffer = await file.arrayBuffer()
    const result = await window.electronAPI.saveProfileImage(new Uint8Array(buffer))
    if (result.url) {
      // 캐시 무효화를 위해 타임스탬프 추가
      updateMyProfileImageUrl(`${result.url}?t=${Date.now()}`)
    }
    // 파일 입력 초기화 (같은 파일 재선택 가능)
    event.target.value = ''
  }

  async function handleLogout() {
    await window.electronAPI.logout()
    clearAllPeers()
    resetAll()
    resetUser()
    setAuthStatus('login')
  }

  return (
    <div className="flex flex-col h-full">
      {/* 헤더 */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-vsc-border">
        <span className="text-vsc-muted text-xs uppercase tracking-wider">설정</span>
        <button
          onClick={onClose}
          className="cursor-pointer p-0.5 rounded text-vsc-muted hover:text-vsc-text hover:bg-vsc-hover transition-colors"
        >
          <X size={13} />
        </button>
      </div>

      {/* 프로필 이미지 */}
      <div className="flex flex-col items-center py-5 gap-1">
        <div
          onClick={() => fileInputRef.current?.click()}
          className="relative cursor-pointer group"
        >
          <div className="w-16 h-16 rounded-full overflow-hidden bg-vsc-border flex items-center justify-center">
            {myProfileImageUrl ? (
              <img
                src={myProfileImageUrl}
                alt="프로필"
                className="w-full h-full object-cover"
                onError={(e) => { e.target.style.display = 'none' }}
              />
            ) : null}
            {/* 이미지 없을 때 이니셜 표시 */}
            <span
              className="text-xl font-bold text-vsc-accent absolute"
              style={{ display: myProfileImageUrl ? 'none' : 'block' }}
            >
              {myNickname?.[0]?.toUpperCase() || '?'}
            </span>
          </div>
          <div className="absolute inset-0 rounded-full bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
            <Camera size={16} className="text-white" />
          </div>
        </div>
        <span className="text-vsc-muted text-xs mt-1">클릭하여 변경</span>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleImageSelect}
        />
      </div>

      {/* 닉네임 편집 */}
      <div className="px-3 space-y-1">
        <label className="text-vsc-muted text-xs block">닉네임</label>
        <div className="flex gap-1">
          <input
            value={nicknameInput}
            onChange={e => setNicknameInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleNicknameSave()}
            className="flex-1 bg-vsc-panel border border-vsc-border rounded px-2 py-1 text-xs text-vsc-text outline-none focus:border-vsc-accent"
          />
          <button
            onClick={handleNicknameSave}
            disabled={isSaving || !nicknameInput.trim() || nicknameInput.trim() === myNickname}
            className="cursor-pointer px-2 py-1 rounded bg-vsc-accent text-vsc-bg text-xs font-semibold hover:opacity-80 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity flex items-center gap-1"
          >
            {saveSuccess ? <Check size={12} /> : '저장'}
          </button>
        </div>
      </div>

      {/* 로그아웃 버튼 */}
      <div className="mt-auto px-3 pb-3">
        <button
          onClick={handleLogout}
          className="cursor-pointer w-full flex items-center justify-center gap-2 px-3 py-1.5 rounded text-xs text-red-400 hover:bg-vsc-hover transition-colors"
        >
          <LogOut size={13} />
          로그아웃
        </button>
      </div>
    </div>
  )
}
