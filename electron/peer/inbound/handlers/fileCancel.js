// file-cancel 수신 핸들러 (#44/#45/#49) — 요청자가 전송을 취소하면 송신 루프가 중단된다.
// 실제 로직은 fileChunkTransfer 모듈에 있다.

const { handleFileCancel } = require('../../fileChunkTransfer')

module.exports = function fileCancelHandler({ message, ctx }) {
  handleFileCancel(ctx, message)
}
