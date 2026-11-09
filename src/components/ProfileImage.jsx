import React from 'react'

export default function ProfileImage({ src, ...props }) {
  // 주소가 바뀌면 실패했던 DOM을 교체하고, 재로딩 성공 시 숨김 상태도 해제한다.
  return (
    <img
      {...props}
      key={src}
      src={src}
      onError={event => { event.currentTarget.style.display = 'none' }}
      onLoad={event => { event.currentTarget.style.display = '' }}
    />
  )
}
