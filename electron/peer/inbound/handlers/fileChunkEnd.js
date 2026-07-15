// file-chunk-end 수신 핸들러 (#44/#45/#49) — 완료 backstop (보통 마지막 청크에서 이미 조립됨).
// 실제 로직은 fileChunkTransfer 모듈에 있다.

const { handleFileChunkEnd } = require('../../fileChunkTransfer')

module.exports = function fileChunkEndHandler({ message, ctx }) {
  handleFileChunkEnd(ctx, message)
}
