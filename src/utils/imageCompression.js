// src/utils/imageCompression.js
// 이미지 전송 전 리사이즈/재인코딩 유틸(#47) — 스크린샷을 여러 장 붙여넣거나 선택해 보낼 때
// 원본 바이트 그대로 전송하면 트래픽/디스크/전송 프리즈가 커지는 문제를 완화한다.
//
// 판정/계산은 순수 함수로 분리해 Jest(node 환경, canvas/Image 없음)에서 단위 테스트 가능하게
// 하고, 실제 Canvas 실행이 필요한 부분(compressImageFile)만 브라우저(Electron renderer) 전용으로
// 남긴다.

// 리사이즈 기준 — 장변이 이 값을 넘으면 축소한다.
export const DEFAULT_MAX_DIMENSION = 2048

// JPEG 재인코딩 품질(0~1).
export const DEFAULT_JPEG_QUALITY = 0.85

// 압축 파이프라인에 태울 이미지 타입인지 판정(순수 함수).
// - SVG: XSS 위험으로 이미 'file'(첨부) 취급 경로(getFileContentType, MessageInput.jsx)와
//   일관되게 압축 대상에서도 제외한다.
// - GIF: 애니메이션 GIF 는 Canvas 리사이즈 시 첫 프레임만 남아 움직임이 사라진다. 프레임 수를
//   바이트 단위로 파싱해 애니메이션 여부만 가려낼 수도 있지만, 정지 GIF 라 해도 재인코딩하려면
//   Canvas.toBlob 이 지원하지 않는 GIF 포맷을 벗어나 JPEG/PNG 로 강제 변환해야 해서 사용자가
//   의도하지 않은 포맷 변경이 생긴다. 그래서 GIF 는 애니메이션 여부와 무관하게 압축 파이프라인
//   에서 전부 제외하고 원본 그대로 전송한다(보수적이지만 안전한 선택 — 이유는 최종 보고에 명시).
export function isCompressibleImageType(mimeType) {
  if (!mimeType || typeof mimeType !== 'string') return false
  if (!mimeType.startsWith('image/')) return false
  if (mimeType === 'image/svg+xml') return false
  if (mimeType === 'image/gif') return false
  return true
}

// 원본 (width, height) 을 장변 기준 maxDimension 이하로 축소한 목표 치수 계산(순수 함수).
// 이미 기준 이하이면 축소하지 않는다(scaled: false, 원본 치수 그대로 반환) — 작은 이미지를
// 불필요하게 다시 인코딩해 화질을 낮추지 않기 위함.
export function calculateResizedDimensions(width, height, maxDimension = DEFAULT_MAX_DIMENSION) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { width: 0, height: 0, scaled: false }
  }
  const longSide = Math.max(width, height)
  if (longSide <= maxDimension) {
    return { width: Math.round(width), height: Math.round(height), scaled: false }
  }
  const scale = maxDimension / longSide
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    scaled: true,
  }
}

// 리사이즈 결과에 투명 픽셀(알파 채널 사용)이 있는지에 따라 출력 포맷을 고른다(순수 함수).
// 투명도가 필요하면 PNG(무손실, 알파 보존), 아니면 용량이 훨씬 작은 JPEG 을 사용한다.
export function pickOutputMimeType(hasAlpha) {
  return hasAlpha ? 'image/png' : 'image/jpeg'
}

// Canvas 에서 읽은 RGBA 픽셀 배열(Uint8ClampedArray 등)에 알파 채널 사용 여부 검사(순수 함수).
// canvas/DOM 의존 없이 숫자 배열만 검사하도록 분리해 테스트 가능하게 한다.
export function detectAlphaUsage(rgbaData) {
  for (let i = 3; i < rgbaData.length; i += 4) {
    if (rgbaData[i] < 255) return true
  }
  return false
}

// 압축이 실제로 이득인지 판정(순수 함수) — 리사이즈도 안 됐고(scaled=false) 포맷 변경도 없는데
// 재인코딩 결과가 원본보다 크거나 같으면 압축 의미가 없으므로 원본 유지를 권장한다.
export function isCompressionWorthwhile({ scaled, outputType, originalType, compressedSize, originalSize }) {
  if (scaled) return true
  if (outputType !== originalType) return true
  return compressedSize < originalSize
}

function loadImageElement(objectUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('이미지 디코딩 실패'))
    image.src = objectUrl
  })
}

// 실제 Canvas 실행이 필요한 부분 — Jest(node) 환경에는 Image/Canvas 가 없어 여기는 단위
// 테스트 대상이 아니다(수동 검증 시나리오로 대체). 실패 시 null 반환 → 호출부는 항상 원본
// 파일로 안전하게 폴백한다(HEIC 변환 실패 시 폴백하는 기존 sendFile 패턴과 동일한 철학).
export async function compressImageFile(file, { maxDimension = DEFAULT_MAX_DIMENSION, quality = DEFAULT_JPEG_QUALITY } = {}) {
  if (!file || !isCompressibleImageType(file.type)) return null

  let objectUrl
  try {
    objectUrl = URL.createObjectURL(file)
    const image = await loadImageElement(objectUrl)
    const originalWidth = image.naturalWidth || image.width
    const originalHeight = image.naturalHeight || image.height
    const { width, height, scaled } = calculateResizedDimensions(originalWidth, originalHeight, maxDimension)
    if (width === 0 || height === 0) return null

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) return null
    context.drawImage(image, 0, 0, width, height)

    const imageData = context.getImageData(0, 0, width, height)
    const hasAlpha = detectAlphaUsage(imageData.data)
    const outputType = pickOutputMimeType(hasAlpha)

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, outputType, quality))
    if (!blob) return null

    if (!isCompressionWorthwhile({ scaled, outputType, originalType: file.type, compressedSize: blob.size, originalSize: file.size })) {
      return null
    }

    const baseName = (file.name || 'image').replace(/\.[^./\\]+$/, '')
    const extension = outputType === 'image/png' ? 'png' : 'jpg'
    return new File([blob], `${baseName}.${extension}`, { type: outputType, lastModified: Date.now() })
  } catch (err) {
    console.warn('[이미지 압축 실패]', err?.message || err)
    return null
  } finally {
    if (objectUrl) URL.revokeObjectURL(objectUrl)
  }
}
