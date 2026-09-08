import React, { useState } from 'react'
import { Leaf } from 'lucide-react'
import LanpetPanel from './LanpetPanel'
import './Lanpet.css'

export default function LanpetLauncher() {
  const [open, setOpen] = useState(false)
  return <>
    <button className="lanpet-launcher" onClick={() => setOpen(true)} aria-haspopup="dialog"><Leaf size={13} aria-hidden="true" />랜펫</button>
    {open && <LanpetPanel onClose={() => setOpen(false)} />}
  </>
}
