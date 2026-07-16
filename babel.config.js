module.exports = {
  presets: [
    ['@babel/preset-env', { targets: { node: 'current' } }],
    // renderer(jsdom) 테스트에서 .jsx 파일을 변환하기 위해 추가.
    // runtime: 'automatic' — React 19 의 새 JSX 트랜스폼 사용, 파일마다 import React 불필요.
    ['@babel/preset-react', { runtime: 'automatic' }],
  ],
}
