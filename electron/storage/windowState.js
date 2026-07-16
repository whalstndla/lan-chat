// electron/storage/windowState.js
// 창 크기/위치 기억(#71) — userData 의 작은 평문 JSON 파일(window-state.json)에 bounds 를 저장/복원한다.
// 암호화 DB(better-sqlite3-multiple-ciphers)에 넣지 않는 이유: 로그인(비밀번호 입력) 이전
// 부팅 시점에도 창을 먼저 띄워야 하므로, 마스터키 없이도 읽을 수 있어야 한다.
// last-version.json(electron/utils/appUtils.js) 과 동일한 단순 저장 패턴을 따른다 —
// 비critical 설정 파일이라 원자적 쓰기(tmp + rename)까지는 필요하지 않다.
const fs = require('fs')
const path = require('path')

const WINDOW_STATE_FILENAME = 'window-state.json'

// main.js 의 기존 BrowserWindow 생성 옵션과 동일한 기본값 — 단일 출처로 여기서만 관리한다.
const DEFAULT_WIDTH = 1000
const DEFAULT_HEIGHT = 700
const MIN_WIDTH = 700
const MIN_HEIGHT = 500

function windowStatePath(appDataPath) {
  return path.join(appDataPath, WINDOW_STATE_FILENAME)
}

// 저장된 bounds 를 읽는다 — 파일 없음/파싱 실패/형식 이상 시 null (호출부가 기본값으로 폴백).
function loadWindowState(appDataPath) {
  try {
    const raw = fs.readFileSync(windowStatePath(appDataPath), 'utf8')
    const parsed = JSON.parse(raw)
    const { x, y, width, height } = parsed || {}
    if (![x, y, width, height].every((value) => Number.isFinite(value))) return null
    return { x, y, width, height }
  } catch {
    return null
  }
}

// 현재 bounds 를 저장 — 실패해도 무시(다음 실행이 기본 위치로 뜰 뿐 치명적이지 않음).
function saveWindowState(appDataPath, bounds) {
  try {
    fs.writeFileSync(windowStatePath(appDataPath), JSON.stringify(bounds))
  } catch { /* 저장 실패 무시 */ }
}

// 두 사각형이 겹치는 영역이 있는지 확인하는 순수 함수.
function rectsOverlap(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x &&
    a.y < b.y + b.height && a.y + a.height > b.y
}

// 저장된 bounds 가 "현재 연결된 디스플레이 중 하나에서라도 보이는 위치"인지 검증한다.
// 외장 모니터 분리 등으로 저장 당시의 좌표가 화면 밖일 수 있어, 복원 전 반드시 확인해야 한다.
// displays 는 Electron screen.getAllDisplays() 결과 형태: [{ bounds: { x, y, width, height } }, ...]
function isBoundsVisibleOnDisplays(bounds, displays) {
  if (!bounds || !Array.isArray(displays) || displays.length === 0) return false
  return displays.some((display) => display?.bounds && rectsOverlap(bounds, display.bounds))
}

// 저장된 창 상태를 검증해서 반환한다. 저장값이 없거나 화면 밖이면 null(호출부가 기본 옵션 사용).
// 최소 크기(minWidth/minHeight)보다 작게 저장돼 있으면 최소 크기로 보정한다.
function resolveWindowState(appDataPath, displays) {
  const stored = loadWindowState(appDataPath)
  if (!stored) return null
  if (!isBoundsVisibleOnDisplays(stored, displays)) return null
  return {
    x: stored.x,
    y: stored.y,
    width: Math.max(stored.width, MIN_WIDTH),
    height: Math.max(stored.height, MIN_HEIGHT),
  }
}

module.exports = {
  WINDOW_STATE_FILENAME,
  DEFAULT_WIDTH,
  DEFAULT_HEIGHT,
  MIN_WIDTH,
  MIN_HEIGHT,
  windowStatePath,
  loadWindowState,
  saveWindowState,
  isBoundsVisibleOnDisplays,
  resolveWindowState,
}
