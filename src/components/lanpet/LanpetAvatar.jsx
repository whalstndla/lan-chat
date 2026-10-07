import React, { useEffect, useId, useState } from 'react'

const coats = { fox: '#ffb36f', rabbit: '#ffb6d6', otter: '#75d9d9', cat: '#baa7f2', bird: '#ffe16b', bear: '#a5dc8c' }
const shadows = { fox: '#e67b49', rabbit: '#dc79a7', otter: '#36a8b7', cat: '#8267ce', bird: '#e8ad37', bear: '#65af65' }

export default function LanpetAvatar({ stage = 'seed', appearanceId = '', resting = false, small = false }) {
  const [portrait, setPortrait] = useState(null)
  useEffect(() => {
    let canceled = false
    setPortrait(null)
    if (!window.WebGL2RenderingContext) return undefined
    import('./three/scene').then(({ petPortrait }) => {
      if (!canceled) setPortrait(petPortrait(appearanceId, stage))
    }).catch(() => { /* 그래픽 초기화에 실패하면 같은 종의 가벼운 대체 이미지를 유지한다. */ })
    return () => { canceled = true }
  }, [appearanceId, stage])
  if (portrait) return <img className={`lanpet-avatar pet-three-portrait ${resting ? 'is-resting' : ''} ${small ? 'is-small' : ''}`} src={portrait} alt="" aria-hidden="true" />
  return <FallbackAvatar stage={stage} appearanceId={appearanceId} resting={resting} small={small} />
}

function FallbackAvatar({ stage, appearanceId, resting, small }) {
  const id = useId().replace(/:/g, '')
  const parts = appearanceId.split('-')
  const species = coats[parts[1]] ? parts[1] : 'bear'
  const branch = parts[2]
  const mature = stage === 'grown'
  const coat = coats[species]
  const roundEars = ['otter', 'bear'].includes(species)
  const pointedEars = ['fox', 'cat'].includes(species)
  return <svg className={`lanpet-avatar ${resting ? 'is-resting' : ''} ${small ? 'is-small' : ''}`} viewBox="0 0 200 180" aria-hidden="true" focusable="false">
    <defs>
      <radialGradient id={`${id}coat`} cx="36%" cy="25%" r="80%"><stop stopColor="#fff9e9" /><stop offset=".28" stopColor={coat} /><stop offset="1" stopColor={shadows[species]} /></radialGradient>
      <radialGradient id={`${id}eye`} cx="35%" cy="25%"><stop stopColor="#426b8b" /><stop offset="1" stopColor="#203555" /></radialGradient>
    </defs>
    <ellipse cx="101" cy="162" rx="49" ry="8" fill="#784964" opacity=".15" />
    <g className="lanpet-creature" strokeLinecap="round" strokeLinejoin="round">
      {species === 'fox' && <path d="M140 135Q186 140 173 91Q165 106 148 102" fill={coat} stroke={shadows[species]} strokeWidth="2" />}
      {species === 'otter' && <ellipse cx="147" cy="140" rx="25" ry="10" fill={shadows[species]} transform="rotate(-25 147 140)" />}
      {species === 'cat' && <path d="M145 141Q181 132 162 113" fill="none" stroke={shadows[species]} strokeWidth="12" />}
      <ellipse cx="77" cy="153" rx="18" ry="10" fill={shadows[species]} /><ellipse cx="126" cy="153" rx="18" ry="10" fill={shadows[species]} />
      {roundEars && <g fill={`url(#${id}coat)`} stroke={shadows[species]} strokeWidth="2"><circle cx="57" cy="58" r="20" /><circle cx="144" cy="58" r="20" /><circle cx="57" cy="58" r="10" fill="#ffe7ce" /><circle cx="144" cy="58" r="10" fill="#ffe7ce" /></g>}
      {pointedEars && <g fill={`url(#${id}coat)`} stroke={shadows[species]} strokeWidth="2"><path d="M45 80L45 27Q69 31 81 57M120 57Q137 29 156 27L155 81" /><path d="M54 60L54 40L71 58M130 58L148 40L148 65" fill="#ffdce7" stroke="none" /></g>}
      {species === 'rabbit' && <g fill={`url(#${id}coat)`} stroke={shadows[species]} strokeWidth="2"><ellipse cx="73" cy="44" rx="17" ry="35" transform="rotate(-12 73 44)" /><ellipse cx="129" cy="44" rx="17" ry="35" transform="rotate(12 129 44)" /><path d="M72 23L75 53M130 23L126 53" stroke="#e988b5" strokeWidth="9" /></g>}
      {species === 'bird' && <path d="M88 60Q67 31 88 32Q103 34 100 53Q118 24 128 40Q130 52 112 60" fill={coat} stroke={shadows[species]} strokeWidth="2" />}
      <ellipse cx="47" cy="118" rx="11" ry="22" fill={coat} transform="rotate(30 47 118)" /><ellipse cx="155" cy="118" rx="11" ry="22" fill={coat} transform="rotate(-30 155 118)" />
      <path d="M39 101C39 65 62 47 101 47S163 65 163 101C163 139 144 159 101 159S39 139 39 101Z" fill={`url(#${id}coat)`} stroke={shadows[species]} strokeWidth="1.5" />
      <ellipse cx="101" cy="133" rx="29" ry="19" fill="#fff8e5" opacity=".82" />
      {species === 'fox' && <path d="M49 93Q63 122 91 110Q84 135 64 122ZM153 93Q139 122 111 110Q118 135 138 122Z" fill="#fff4d9" />}
      <ellipse cx="66" cy="72" rx="19" ry="7" fill="white" opacity=".45" transform="rotate(-22 66 72)" />
      <ellipse cx="59" cy="116" rx="11" ry="7" fill="#ed819a" opacity=".65" /><ellipse cx="143" cy="116" rx="11" ry="7" fill="#ed819a" opacity=".65" />
      {resting ? <path d="M72 101Q79 108 86 101M116 101Q123 108 130 101" fill="none" stroke="#263655" strokeWidth="4" /> : <g className="lanpet-eyes"><ellipse cx="78" cy="99" rx="12" ry="16" fill={`url(#${id}eye)`} /><ellipse cx="124" cy="99" rx="12" ry="16" fill={`url(#${id}eye)`} /><g fill="white"><ellipse cx="74" cy="92" rx="5" ry="7" /><ellipse cx="120" cy="92" rx="5" ry="7" /><circle cx="83" cy="107" r="3" /><circle cx="129" cy="107" r="3" /></g></g>}
      {species === 'bird' ? <path d="M92 114L101 108L110 114L101 121Z" fill="#eb9444" /> : <path d="M91 119Q96 126 101 119Q106 126 112 119" fill="none" stroke="#49344a" strokeWidth="2.8" />}
      {stage === 'seed' && <circle cx="101" cy="141" r="4" fill="white" opacity=".75" />}
      {mature && branch === 'care' && <g><path d="M86 55Q75 23 61 43Q68 59 88 57" fill="#66b781" /><g fill="#ff96b9" stroke="#e8799b" strokeWidth="1"><circle cx="99" cy="40" r="11" /><circle cx="116" cy="46" r="11" /><circle cx="107" cy="58" r="11" /><circle cx="91" cy="56" r="11" /><circle cx="103" cy="48" r="7" fill="#ffe975" /></g></g>}
      {mature && branch === 'active' && <g><path d="M50 69Q101 43 153 68L150 80Q101 59 52 81Z" fill="#68cdec" /><path d="M104 57L91 76L102 74L97 88L117 65L105 67Z" fill="#fff475" /><path d="M147 74L172 64L168 90L152 80" fill="#68cdec" /></g>}
      {mature && branch === 'social' && <g fill="#ed78b3" stroke="#cb5896" strokeWidth="1.5"><path d="M96 133Q61 108 70 144Q87 150 100 137Q116 154 133 143Q143 108 105 132Z" /><circle cx="101" cy="135" r="7" fill="#fff3bd" /></g>}
    </g>
    {resting && <text x="151" y="40" fill="#76769e" fontSize="13">쿨쿨</text>}
  </svg>
}
