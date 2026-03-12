// src/components/SettingsPanel.jsx
import React, { useState, useRef } from 'react'
import { X, LogOut, Camera, Check, Volume2, Play } from 'lucide-react'
import useAuthStore from '../store/useAuthStore'
import useUserStore from '../store/useUserStore'
import usePeerStore from '../store/usePeerStore'
import useChatStore from '../store/useChatStore'
import useNotificationSound from '../hooks/useNotificationSound'

export default function SettingsPanel({ onClose }) {
  const { setAuthStatus } = useAuthStore()
  const { myNickname, myProfileImageUrl, updateMyNickname, updateMyProfileImageUrl, reset: resetUser } = useUserStore()
  const { clearAllPeers } = usePeerStore()
  const { resetAll } = useChatStore()

  const notificationSound = useUserStore(state => state.notificationSound)
  const notificationVolume = useUserStore(state => state.notificationVolume)
  const { setNotificationSettings } = useUserStore()
  const { play: playNotification } = useNotificationSound()

  const [nicknameInput, setNicknameInput] = useState(myNickname || '')
  const [isSaving, setIsSaving] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const fileInputRef = useRef(null)
  const soundFileInputRef = useRef(null)

  const SOUND_OPTIONS = [
    { value: 'notification1', label: '소리 1' },
    { value: 'notification2', label: '소리 2' },
    { value: 'notification3', label: '소리 3' },
    { value: 'notification4', label: '소리 4' },
    { value: 'custom',        label: '직접 업로드' },
  ]

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

  async function handleSoundChange(newSound) {
    setNotificationSettings({ sound: newSound, volume: notificationVolume })
    await window.electronAPI.saveNotificationSettings({ sound: newSound, volume: notificationVolume })
  }

  async function handleVolumeChange(newVolume) {
    setNotificationSettings({ sound: notificationSound, volume: newVolume })
    await window.electronAPI.saveNotificationSettings({ sound: notificationSound, volume: newVolume })
  }

  async function handleCustomSoundUpload(event) {
    const file = event.target.files?.[0]
    if (!file) return
    const extension = file.name.split('.').pop().toLowerCase()
    const buffer = await file.arrayBuffer()
    const newBuffer = new Uint8Array(buffer)
    await window.electronAPI.saveCustomNotificationSound(buffer, extension)
    setNotificationSettings({ sound: 'custom', volume: notificationVolume, customSoundBuffer: newBuffer })
    await window.electronAPI.saveNotificationSettings({ sound: 'custom', volume: notificationVolume })
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
    <div className="flex flex-col h-full overflow-hidden">
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

      {/* 스크롤 가능한 콘텐츠 영역 */}
      <div className="flex-1 overflow-y-auto">

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

      {/* 알림 설정 */}
      <div className="px-3 mt-4 space-y-3">
        <label className="text-vsc-muted text-xs block">알림 소리</label>

        {/* 소리 선택 */}
        <div className="flex flex-col gap-1">
          {SOUND_OPTIONS.map(option => (
            <div key={option.value} className="flex items-center gap-2">
              <button
                onClick={() => option.value !== 'custom' && handleSoundChange(option.value)}
                className={`flex-1 text-left px-2 py-1 rounded text-xs transition-colors cursor-pointer ${
                  notificationSound === option.value
                    ? 'bg-vsc-selected text-vsc-text'
                    : 'text-vsc-muted hover:bg-vsc-hover hover:text-vsc-text'
                }`}
              >
                {option.label}
              </button>
              {option.value === 'custom' ? (
                <button
                  onClick={() => soundFileInputRef.current?.click()}
                  className="cursor-pointer px-2 py-1 rounded text-xs bg-vsc-panel border border-vsc-border text-vsc-muted hover:text-vsc-text transition-colors"
                >
                  파일 선택
                </button>
              ) : (
                <button
                  onClick={() => { handleSoundChange(option.value); setTimeout(playNotification, 50) }}
                  title="미리듣기"
                  className="cursor-pointer p-1 rounded text-vsc-muted hover:text-vsc-text hover:bg-vsc-hover transition-colors"
                >
                  <Play size={11} />
                </button>
              )}
            </div>
          ))}
          <input
            ref={soundFileInputRef}
            type="file"
            accept="audio/*"
            className="hidden"
            onChange={handleCustomSoundUpload}
          />
        </div>

        {/* 볼륨 슬라이더 */}
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <label className="text-vsc-muted text-xs flex items-center gap-1">
              <Volume2 size={11} />
              볼륨
            </label>
            <span className="text-vsc-muted text-xs">{Math.round(notificationVolume * 100)}%</span>
          </div>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={notificationVolume}
            onChange={e => handleVolumeChange(Number(e.target.value))}
            className="w-full accent-vsc-accent cursor-pointer"
          />
        </div>
      </div>

      </div>{/* 스크롤 영역 끝 */}

      {/* 로그아웃 버튼 */}
      <div className="px-3 pb-3 border-t border-vsc-border pt-2">
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
