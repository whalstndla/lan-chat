// tests/utils/clipboard.test.js
// copyToClipboard 순수 로직 단위 테스트 — navigator.clipboard 를 모킹해 성공/실패 분기 검증.
import { copyToClipboard } from '../../src/utils/clipboard'

describe('copyToClipboard', () => {
  afterEach(() => {
    delete global.navigator
    jest.restoreAllMocks()
  })

  it('navigator.clipboard.writeText 성공 시 true 를 반환한다', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined)
    global.navigator = { clipboard: { writeText } }

    const result = await copyToClipboard('복사할 텍스트')

    expect(result).toBe(true)
    expect(writeText).toHaveBeenCalledWith('복사할 텍스트')
  })

  it('writeText 실패 시 false 를 반환하고 콘솔 경고를 남긴다', async () => {
    const writeText = jest.fn().mockRejectedValue(new Error('클립보드 접근 거부'))
    global.navigator = { clipboard: { writeText } }
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})

    const result = await copyToClipboard('텍스트')

    expect(result).toBe(false)
    expect(warnSpy).toHaveBeenCalled()
  })

  it('text 가 없으면 빈 문자열로 복사를 시도한다', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined)
    global.navigator = { clipboard: { writeText } }

    await copyToClipboard(undefined)

    expect(writeText).toHaveBeenCalledWith('')
  })
})
