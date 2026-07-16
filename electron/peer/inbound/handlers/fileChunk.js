// file-chunk 수신 핸들러 (#44/#45/#49) — 청크 복호화 후 조립 버퍼에 저장.
// 실제 로직은 fileChunkTransfer 모듈에 있다.

const { handleFileChunk } = require('../../fileChunkTransfer')

module.exports = function fileChunkHandler({ message, ctx }) {
  handleFileChunk(ctx, message)
}
