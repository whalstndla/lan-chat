// tests/utils/autoLaunch.test.js
const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  loadAutoLaunchPreference,
  saveAutoLaunchPreference,
  shouldStartHiddenThisLaunch,
  applyAutoLaunchSettings,
  isAutoLaunchSupported,
  HIDDEN_LAUNCH_ARG,
} = require('../../electron/utils/autoLaunch')

describe('로그인 시 자동 시작(autoLaunch)', () => {
  let tmpDir

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lan-chat-auto-launch-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('저장된 선호도가 없으면 기본값(모두 off)', () => {
    expect(loadAutoLaunchPreference(tmpDir)).toEqual({ openAtLogin: false, startHidden: false })
  })

  it('저장한 선호도를 그대로 읽어온다', () => {
    saveAutoLaunchPreference(tmpDir, { openAtLogin: true, startHidden: true })
    expect(loadAutoLaunchPreference(tmpDir)).toEqual({ openAtLogin: true, startHidden: true })
  })

  it('손상된 JSON 이면 기본값으로 폴백', () => {
    fs.writeFileSync(path.join(tmpDir, 'auto-launch.json'), '{broken')
    expect(loadAutoLaunchPreference(tmpDir)).toEqual({ openAtLogin: false, startHidden: false })
  })

  describe('shouldStartHiddenThisLaunch', () => {
    const fakeApp = (wasOpenedAsHidden) => ({
      getLoginItemSettings: () => ({ wasOpenedAsHidden }),
    })
    const originalArgv = process.argv

    afterEach(() => {
      process.argv = originalArgv
    })

    it('자동시작/숨김 선호도 중 하나라도 꺼져있으면 false', () => {
      expect(shouldStartHiddenThisLaunch(fakeApp(false), { openAtLogin: false, startHidden: true })).toBe(false)
      expect(shouldStartHiddenThisLaunch(fakeApp(false), { openAtLogin: true, startHidden: false })).toBe(false)
    })

    it('커스텀 플래그(--hidden)가 argv 에 있으면 true — 플랫폼 무관 공통 경로', () => {
      process.argv = [...originalArgv, HIDDEN_LAUNCH_ARG]
      expect(shouldStartHiddenThisLaunch(fakeApp(false), { openAtLogin: true, startHidden: true })).toBe(true)
    })

    it('macOS wasOpenedAsHidden 이 true 이면 true (macOS 12 이하 호환 경로)', () => {
      expect(shouldStartHiddenThisLaunch(fakeApp(true), { openAtLogin: true, startHidden: true })).toBe(true)
    })

    it('둘 다 신호가 없으면 false', () => {
      expect(shouldStartHiddenThisLaunch(fakeApp(false), { openAtLogin: true, startHidden: true })).toBe(false)
    })
  })

  describe('applyAutoLaunchSettings / isAutoLaunchSupported', () => {
    it('지원 플랫폼(macOS/Windows)에서는 setLoginItemSettings 를 호출한다', () => {
      if (!isAutoLaunchSupported()) return // Linux 등 미지원 플랫폼에서는 스킵
      const calls = []
      const fakeApp = { setLoginItemSettings: (settings) => calls.push(settings) }
      applyAutoLaunchSettings(fakeApp, { openAtLogin: true, startHidden: true })
      expect(calls).toHaveLength(1)
      expect(calls[0].openAtLogin).toBe(true)
      expect(calls[0].args).toEqual([HIDDEN_LAUNCH_ARG])
    })

    it('startHidden 이 꺼져있으면 args 가 비어있다', () => {
      if (!isAutoLaunchSupported()) return
      const calls = []
      const fakeApp = { setLoginItemSettings: (settings) => calls.push(settings) }
      applyAutoLaunchSettings(fakeApp, { openAtLogin: true, startHidden: false })
      expect(calls[0].args).toEqual([])
    })

    it('미지원 플랫폼에서는 setLoginItemSettings 를 호출하지 않는다', () => {
      if (isAutoLaunchSupported()) return // macOS/Windows 에서는 스킵 (지원 플랫폼)
      const calls = []
      const fakeApp = { setLoginItemSettings: (settings) => calls.push(settings) }
      applyAutoLaunchSettings(fakeApp, { openAtLogin: true, startHidden: true })
      expect(calls).toHaveLength(0)
    })
  })
})
