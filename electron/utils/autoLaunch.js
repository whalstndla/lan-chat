// electron/utils/autoLaunch.js
// 로그인 시 자동 시작(#71) — OS 로그인 아이템 등록/해제 + "숨김으로 시작(트레이)" 옵션 관리.
//
// Electron app.setLoginItemSettings/getLoginItemSettings 는 공식적으로 macOS/Windows 만 지원한다.
// Linux 는 데스크톱 환경마다 자동 시작 방식이 달라 Electron 이 직접 지원하지 않으므로,
// 이 모듈의 모든 네이티브 호출은 미지원 플랫폼에서 안전하게 no-op 처리한다(가드).
//
// "숨김으로 시작" 판정: macOS 12 이하는 openAsHidden/wasOpenedAsHidden 이 동작하지만
// macOS 13+ 는 deprecated 라 항상 무시된다(무해하게 false). 플랫폼에 관계없이 동작하도록
// setLoginItemSettings 의 args 에 우리가 직접 심은 HIDDEN_LAUNCH_ARG 플래그를 부팅 시 확인해
// 실제 숨김 여부를 판정한다.
const fs = require('fs')
const path = require('path')

const AUTO_LAUNCH_PREFERENCE_FILENAME = 'auto-launch.json'
const HIDDEN_LAUNCH_ARG = '--hidden'

// 자동 시작 네이티브 등록이 가능한 플랫폼인지 — Linux 는 항상 false.
function isAutoLaunchSupported() {
  return process.platform === 'darwin' || process.platform === 'win32'
}

function autoLaunchPreferencePath(appDataPath) {
  return path.join(appDataPath, AUTO_LAUNCH_PREFERENCE_FILENAME)
}

// 사용자 선호도(토글 상태) 로드 — 파일 없음/파싱 실패 시 모두 꺼진 기본값.
function loadAutoLaunchPreference(appDataPath) {
  try {
    const raw = fs.readFileSync(autoLaunchPreferencePath(appDataPath), 'utf8')
    const parsed = JSON.parse(raw)
    return {
      openAtLogin: !!parsed?.openAtLogin,
      startHidden: !!parsed?.startHidden,
    }
  } catch {
    return { openAtLogin: false, startHidden: false }
  }
}

// 사용자 선호도 저장 — 실패해도 무시(다음 실행은 기본값으로 폴백할 뿐 치명적이지 않음).
function saveAutoLaunchPreference(appDataPath, preference) {
  try {
    fs.writeFileSync(autoLaunchPreferencePath(appDataPath), JSON.stringify({
      openAtLogin: !!preference?.openAtLogin,
      startHidden: !!preference?.startHidden,
    }))
  } catch { /* 저장 실패 무시 */ }
}

// 실제 OS 로그인 아이템을 등록/해제한다. 미지원 플랫폼(Linux)은 안전하게 아무 것도 하지 않는다.
function applyAutoLaunchSettings(app, { openAtLogin, startHidden }) {
  if (!isAutoLaunchSupported()) return
  const shouldHide = !!openAtLogin && !!startHidden
  app.setLoginItemSettings({
    openAtLogin: !!openAtLogin,
    openAsHidden: shouldHide, // macOS 12 이하에서만 동작 — 13+ 는 deprecated 라 무해하게 무시됨
    args: shouldHide ? [HIDDEN_LAUNCH_ARG] : [],
  })
}

// 이번 실행이 "로그인 자동 시작 + 숨김 시작" 설정에 의한 것인지 판정 — 부팅 시 1회만 호출한다.
// process.argv 의 커스텀 플래그를 우선 확인(모든 플랫폼 공통), macOS 저버전 호환을 위해
// wasOpenedAsHidden 도 보조 신호로 함께 확인한다.
function shouldStartHiddenThisLaunch(app, preference) {
  if (!preference?.openAtLogin || !preference?.startHidden) return false
  if (process.argv.includes(HIDDEN_LAUNCH_ARG)) return true
  try {
    return !!app.getLoginItemSettings().wasOpenedAsHidden
  } catch {
    return false
  }
}

// 설정 패널에 보여줄 현재 상태 — openAtLogin 은 가능하면 OS 에 실제 등록된 값을 신뢰하고
// (사용자가 OS 설정에서 직접 껐을 수도 있으므로), 조회 실패 시에만 저장된 선호도로 폴백한다.
function getAutoLaunchStatus(app, appDataPath) {
  const preference = loadAutoLaunchPreference(appDataPath)
  if (!isAutoLaunchSupported()) {
    return { supported: false, openAtLogin: false, startHidden: false }
  }
  let openAtLogin = preference.openAtLogin
  try {
    openAtLogin = !!app.getLoginItemSettings().openAtLogin
  } catch { /* 조회 실패 시 저장된 선호도 값 사용 */ }
  return { supported: true, openAtLogin, startHidden: preference.startHidden }
}

module.exports = {
  AUTO_LAUNCH_PREFERENCE_FILENAME,
  HIDDEN_LAUNCH_ARG,
  isAutoLaunchSupported,
  autoLaunchPreferencePath,
  loadAutoLaunchPreference,
  saveAutoLaunchPreference,
  applyAutoLaunchSettings,
  shouldStartHiddenThisLaunch,
  getAutoLaunchStatus,
}
