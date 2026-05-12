import { useEffect, useState } from 'react'
import { FireLogo } from './FireLogo'

export default function Splash({ onDone }: { onDone: () => void }) {
  const [fadingOut, setFadingOut] = useState(false)

  useEffect(() => {
    const fadeT = setTimeout(() => setFadingOut(true), 1200)
    const doneT = setTimeout(onDone, 1700)
    return () => {
      clearTimeout(fadeT)
      clearTimeout(doneT)
    }
  }, [onDone])

  return (
    <div
      className={
        'fixed inset-0 z-[100] flex flex-col items-center justify-center bg-bg transition-opacity duration-500 ' +
        (fadingOut ? 'opacity-0' : 'opacity-100')
      }
    >
      <div className="tb-splash-logo">
        <FireLogo size={96} flicker />
      </div>
    </div>
  )
}
