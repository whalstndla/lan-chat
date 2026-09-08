import React from 'react'

export default function LanpetAvatar({ stage = 'seed', appearanceId = '', resting = false, small = false }) {
  const mature = stage === 'grown'
  const young = stage === 'seed' || stage === 'egg'
  const family = appearanceId.split('-')[1] || 'balanced'
  const alternate = appearanceId.endsWith('-b')
  const social = appearanceId.endsWith('-social')
  const coatColors = { calm: '#b2c9c7', active: '#e0b67b', balanced: '#c5d88e' }
  const coat = social ? '#d6bdd5' : coatColors[family] || coatColors.balanced

  return (
    <svg
      className={`lanpet-avatar ${resting ? 'is-resting' : ''} ${small ? 'is-small' : ''}`}
      viewBox="0 0 200 180"
      aria-hidden="true"
      focusable="false"
    >
      <ellipse cx="100" cy="156" rx="43" ry="7" fill="currentColor" opacity=".12" />
      <g className="lanpet-creature">
        {!young && <>
          <g transform={alternate ? 'translate(200 0) scale(-1 1)' : undefined}><path d="M98 65C99 41 119 29 139 35C137 54 121 63 98 65Z" fill="#668c43" stroke="#243b2b" strokeWidth="4" />
          <path d="M100 64C95 47 78 40 63 45C67 60 81 66 100 64Z" fill="#a8c675" stroke="#243b2b" strokeWidth="4" /></g>
        </>}
        {mature && <>
          <path d="M143 106Q174 84 171 113Q169 137 145 139" fill="#91b85e" stroke="#243b2b" strokeWidth="4" />
          <path d="M57 106Q26 84 29 113Q31 137 55 139" fill="#91b85e" stroke="#243b2b" strokeWidth="4" />
        </>}
        <path d="M62 127L58 149Q66 159 82 149L83 139M117 139L118 149Q134 159 142 149L138 127" fill="#d5ad60" stroke="#243b2b" strokeWidth="4" strokeLinejoin="round" />
        <path d="M52 113C52 86 71 62 100 62S148 86 148 113C148 140 127 151 100 151S52 140 52 113Z" fill={young ? '#edce90' : coat} stroke="#243b2b" strokeWidth="4" />
        <path d="M65 91C76 73 101 69 119 81" fill="none" stroke="#fff7d0" strokeWidth="5" strokeLinecap="round" opacity=".65" />
        <ellipse cx="73" cy="121" rx="9" ry="5" fill="#d99665" opacity=".65" />
        <ellipse cx="127" cy="121" rx="9" ry="5" fill="#d99665" opacity=".65" />
        {resting ? <path d="M78 109L86 112L78 114M122 109L114 112L122 114" fill="none" stroke="#243b2b" strokeWidth="3.5" strokeLinecap="round" /> : <g className="lanpet-eyes"><rect x="79" y="105" width="6" height="10" rx="3" fill="#243b2b" /><rect x="115" y="105" width="6" height="10" rx="3" fill="#243b2b" /></g>}
        <path d="M94 119Q100 125 106 119" fill="none" stroke="#243b2b" strokeWidth="3" strokeLinecap="round" />
        {young && <path d="M65 89L77 95L88 87L101 95L113 87L126 95L137 90" fill="none" stroke="#b48b4f" strokeWidth="3" />}
        {alternate && !young && <g fill="#668c43" opacity=".7"><circle cx="96" cy="137" r="3" /><circle cx="105" cy="138" r="3" /><circle cx="114" cy="135" r="3" /></g>}
        {social && <path d="M98 133L100 129L102 133L107 134L103 137L104 142L100 139L96 142L97 137L93 134Z" fill="#eac877" stroke="#765a47" strokeWidth="1.5" />}
        {mature && <g fill="#ecc375" stroke="#243b2b" strokeWidth="2"><circle cx="105" cy="42" r="9" /><circle cx="118" cy="42" r="9" /><circle cx="111" cy="31" r="9" /><circle cx="111" cy="43" r="5" fill="#9c713d" /></g>}
      </g>
      {resting && <text x="145" y="63" fill="#668c43" fontFamily="monospace" fontSize="20">z z</text>}
    </svg>
  )
}
