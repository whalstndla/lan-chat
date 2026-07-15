// file-chunk-start 수신 핸들러 (#44/#45/#49) — 청크 전송 조립 상태 초기화.
// 실제 로직은 fileChunkTransfer 모듈에 있다.

const { handleFileChunkStart } = require('../../fileChunkTransfer')

module.exports = function fileChunkStartHandler({ message, ctx }) {
  handleFileChunkStart(ctx, message)
}
