// tests/utils/imageCompression.test.js
// 이미지 압축(#47) 순수 로직 단위 테스트 — Canvas/Image 는 브라우저 전용이라 이 프로젝트의
// jest(testEnvironment: node) 로는 실행 불가하므로, 압축 대상 판정/치수 계산/포맷 선택/이득
// 판정 같은 순수 함수만 검증한다. compressImageFile(Canvas 실행부)은 수동 검증 시나리오로 대체.
import {
  DEFAULT_MAX_DIMENSION,
  isCompressibleImageType,
  calculateResizedDimensions,
  pickOutputMimeType,
  detectAlphaUsage,
  isCompressionWorthwhile,
} from '../../src/utils/imageCompression'

describe('isCompressibleImageType', () => {
  it('일반 이미지 타입은 압축 대상이다', () => {
    expect(isCompressibleImageType('image/png')).toBe(true)
    expect(isCompressibleImageType('image/jpeg')).toBe(true)
    expect(isCompressibleImageType('image/webp')).toBe(true)
  })

  it('SVG 는 압축 대상에서 제외한다(XSS 이유로 file 취급 경로와 일관)', () => {
    expect(isCompressibleImageType('image/svg+xml')).toBe(false)
  })

  it('GIF 는 애니메이션 여부와 무관하게 압축 대상에서 제외한다', () => {
    expect(isCompressibleImageType('image/gif')).toBe(false)
  })

  it('이미지가 아닌 타입/빈 값은 제외한다', () => {
    expect(isCompressibleImageType('video/mp4')).toBe(false)
    expect(isCompressibleImageType('application/pdf')).toBe(false)
    expect(isCompressibleImageType('')).toBe(false)
    expect(isCompressibleImageType(null)).toBe(false)
    expect(isCompressibleImageType(undefined)).toBe(false)
  })
})

describe('calculateResizedDimensions', () => {
  it('장변이 기준 이하이면 축소하지 않는다', () => {
    expect(calculateResizedDimensions(1920, 1080)).toEqual({ width: 1920, height: 1080, scaled: false })
    expect(calculateResizedDimensions(2048, 2048)).toEqual({ width: 2048, height: 2048, scaled: false })
  })

  it('장변이 기준을 넘으면 비율을 유지하며 축소한다', () => {
    // 가로 4096 x 세로 2048 → 장변 4096 기준 정확히 절반으로 축소
    expect(calculateResizedDimensions(4096, 2048, 2048)).toEqual({ width: 2048, height: 1024, scaled: true })
  })

  it('세로가 더 긴 이미지도 비율을 유지하며 축소한다', () => {
    expect(calculateResizedDimensions(2048, 4096, 2048)).toEqual({ width: 1024, height: 2048, scaled: true })
  })

  it('커스텀 maxDimension 을 지원한다', () => {
    expect(calculateResizedDimensions(1000, 1000, 500)).toEqual({ width: 500, height: 500, scaled: true })
  })

  it('기본 maxDimension 은 2048 이다', () => {
    expect(DEFAULT_MAX_DIMENSION).toBe(2048)
  })

  it('유효하지 않은 치수는 안전하게 처리한다', () => {
    expect(calculateResizedDimensions(0, 100)).toEqual({ width: 0, height: 0, scaled: false })
    expect(calculateResizedDimensions(100, -1)).toEqual({ width: 0, height: 0, scaled: false })
    expect(calculateResizedDimensions(NaN, 100)).toEqual({ width: 0, height: 0, scaled: false })
  })

  it('축소 후에도 최소 1px 은 보장한다', () => {
    const result = calculateResizedDimensions(100000, 1, 2048)
    expect(result.height).toBeGreaterThanOrEqual(1)
  })
})

describe('pickOutputMimeType', () => {
  it('알파 채널이 있으면 PNG 를 선택한다', () => {
    expect(pickOutputMimeType(true)).toBe('image/png')
  })

  it('알파 채널이 없으면 JPEG 를 선택한다', () => {
    expect(pickOutputMimeType(false)).toBe('image/jpeg')
  })
})

describe('detectAlphaUsage', () => {
  it('모든 픽셀의 알파값이 255 이면 알파 미사용으로 판정한다', () => {
    // 2픽셀 RGBA: [255,0,0,255, 0,255,0,255]
    expect(detectAlphaUsage(new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255]))).toBe(false)
  })

  it('알파값이 255 미만인 픽셀이 하나라도 있으면 알파 사용으로 판정한다', () => {
    expect(detectAlphaUsage(new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 128]))).toBe(true)
  })

  it('완전 투명 픽셀도 알파 사용으로 판정한다', () => {
    expect(detectAlphaUsage(new Uint8ClampedArray([0, 0, 0, 0]))).toBe(true)
  })

  it('빈 배열은 알파 미사용으로 판정한다', () => {
    expect(detectAlphaUsage(new Uint8ClampedArray([]))).toBe(false)
  })
})

describe('isCompressionWorthwhile', () => {
  it('리사이즈가 일어났으면(scaled=true) 항상 이득으로 판정한다', () => {
    expect(isCompressionWorthwhile({
      scaled: true, outputType: 'image/jpeg', originalType: 'image/jpeg', compressedSize: 999999, originalSize: 100,
    })).toBe(true)
  })

  it('포맷이 바뀌었으면(예: PNG→JPEG) 항상 이득으로 판정한다', () => {
    expect(isCompressionWorthwhile({
      scaled: false, outputType: 'image/jpeg', originalType: 'image/png', compressedSize: 999999, originalSize: 100,
    })).toBe(true)
  })

  it('리사이즈도 없고 포맷도 같으면 실제로 크기가 줄었을 때만 이득으로 판정한다', () => {
    expect(isCompressionWorthwhile({
      scaled: false, outputType: 'image/jpeg', originalType: 'image/jpeg', compressedSize: 100, originalSize: 200,
    })).toBe(true)
    expect(isCompressionWorthwhile({
      scaled: false, outputType: 'image/jpeg', originalType: 'image/jpeg', compressedSize: 200, originalSize: 200,
    })).toBe(false)
    expect(isCompressionWorthwhile({
      scaled: false, outputType: 'image/jpeg', originalType: 'image/jpeg', compressedSize: 300, originalSize: 200,
    })).toBe(false)
  })
})
