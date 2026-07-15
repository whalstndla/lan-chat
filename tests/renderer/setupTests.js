// tests/renderer/setupTests.js
// jsdom 프로젝트 전용 setupFilesAfterEnv — @testing-library/jest-dom 매처(toBeInTheDocument 등)를
// 모든 렌더러 테스트에서 사용할 수 있도록 전역 등록한다.
require('@testing-library/jest-dom')
