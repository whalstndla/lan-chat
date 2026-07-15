// tests/storage/windowState.test.js
const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  loadWindowState,
  saveWindowState,
  isBoundsVisibleOnDisplays,
  resolveWindowState,
  MIN_WIDTH,
  MIN_HEIGHT,
} = require('../../electron/storage/windowState')

describe('창 위치/크기 기억(windowState)', () => {
  let tmpDir

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lan-chat-window-state-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('저장한 bounds 를 그대로 읽어온다', () => {
    const bounds = { x: 100, y: 50, width: 900, height: 600 }
    saveWindowState(tmpDir, bounds)
    expect(loadWindowState(tmpDir)).toEqual(bounds)
  })

  it('파일이 없으면 null 반환', () => {
    expect(loadWindowState(tmpDir)).toBeNull()
  })

  it('손상된 JSON 이면 null 반환', () => {
    fs.writeFileSync(path.join(tmpDir, 'window-state.json'), '{not valid json')
    expect(loadWindowState(tmpDir)).toBeNull()
  })

  it('일부 필드가 숫자가 아니면 null 반환', () => {
    fs.writeFileSync(path.join(tmpDir, 'window-state.json'), JSON.stringify({ x: 0, y: 0, width: 'wide', height: 600 }))
    expect(loadWindowState(tmpDir)).toBeNull()
  })

  describe('isBoundsVisibleOnDisplays', () => {
    const primaryDisplay = { bounds: { x: 0, y: 0, width: 1920, height: 1080 } }

    it('디스플레이 안에 완전히 들어오면 보임', () => {
      expect(isBoundsVisibleOnDisplays({ x: 100, y: 100, width: 800, height: 600 }, [primaryDisplay])).toBe(true)
    })

    it('디스플레이와 일부만 겹쳐도 보임', () => {
      expect(isBoundsVisibleOnDisplays({ x: 1800, y: 100, width: 800, height: 600 }, [primaryDisplay])).toBe(true)
    })

    it('모든 디스플레이 밖이면 안 보임(외장 모니터 분리 시나리오)', () => {
      // 예: 외장 모니터(1920~3840 영역)에 있던 창 — 외장 모니터 제거 후 primary(0~1920)만 남은 상태
      expect(isBoundsVisibleOnDisplays({ x: 2000, y: 100, width: 800, height: 600 }, [primaryDisplay])).toBe(false)
    })

    it('디스플레이 목록이 비어있으면 안 보임', () => {
      expect(isBoundsVisibleOnDisplays({ x: 0, y: 0, width: 800, height: 600 }, [])).toBe(false)
    })

    it('음수 좌표(왼쪽/위쪽 모니터 분리)도 정확히 판정', () => {
      expect(isBoundsVisibleOnDisplays({ x: -1000, y: 0, width: 800, height: 600 }, [primaryDisplay])).toBe(false)
    })
  })

  describe('resolveWindowState', () => {
    const displays = [{ bounds: { x: 0, y: 0, width: 1920, height: 1080 } }]

    it('저장값이 없으면 null', () => {
      expect(resolveWindowState(tmpDir, displays)).toBeNull()
    })

    it('저장값이 화면 안이면 그대로 복원', () => {
      saveWindowState(tmpDir, { x: 100, y: 100, width: 900, height: 600 })
      expect(resolveWindowState(tmpDir, displays)).toEqual({ x: 100, y: 100, width: 900, height: 600 })
    })

    it('저장값이 모든 디스플레이 밖이면 null (모니터 분리 후 기본값 폴백)', () => {
      saveWindowState(tmpDir, { x: 5000, y: 5000, width: 900, height: 600 })
      expect(resolveWindowState(tmpDir, displays)).toBeNull()
    })

    it('최소 크기보다 작게 저장돼 있으면 최소 크기로 보정', () => {
      saveWindowState(tmpDir, { x: 100, y: 100, width: 300, height: 200 })
      const resolved = resolveWindowState(tmpDir, displays)
      expect(resolved.width).toBe(MIN_WIDTH)
      expect(resolved.height).toBe(MIN_HEIGHT)
    })
  })
})
