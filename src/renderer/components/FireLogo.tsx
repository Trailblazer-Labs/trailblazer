import { cn } from '../lib/cn'

export function FireLogo({
  size = 28,
  className,
  flicker = false
}: {
  size?: number
  className?: string
  flicker?: boolean
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn(flicker && 'tb-flicker', className)}
      aria-hidden
    >
      <defs>
        <linearGradient id="tb-outer" x1="16" y1="1" x2="16" y2="31" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#FFBE6B" />
          <stop offset="0.55" stopColor="#F2733A" />
          <stop offset="1" stopColor="#C2421A" />
        </linearGradient>
        <linearGradient id="tb-inner" x1="16" y1="10" x2="16" y2="29" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#FFEFB8" />
          <stop offset="0.6" stopColor="#FFB04A" />
          <stop offset="1" stopColor="#F26A1F" />
        </linearGradient>
        <radialGradient id="tb-core" cx="16" cy="24" r="6" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.95" />
          <stop offset="1" stopColor="#FFE9A8" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* outer flame — chunky bell shape */}
      <path
        d="M16 1.5
           C 13 6, 10 8.5, 9 12
           C 8 15, 9 17, 10 18
           C 8 18.5, 5.5 21, 5.5 24
           C 5.5 28.5, 10 30.5, 16 30.5
           C 22 30.5, 26.5 28.5, 26.5 24
           C 26.5 20.5, 23.5 17.5, 20.5 16
           C 22 13, 21 9.5, 18 6
           C 17.5 8.5, 16.5 9.5, 15.5 9.5
           C 14 9.5, 14.5 6, 16 1.5 Z"
        fill="url(#tb-outer)"
      />

      {/* inner flame — bold curl */}
      <path
        d="M16 11
           C 13.5 14, 11.5 16.5, 11.5 20
           C 11.5 25, 13.5 28, 16 28
           C 18.5 28, 20.5 25, 20.5 21
           C 20.5 18, 18.5 16.5, 17.5 14
           C 17.2 16, 16.7 16.8, 16 16.8
           C 15.2 16.8, 15.4 14, 16 11 Z"
        fill="url(#tb-inner)"
      />

      {/* hot core glow */}
      <ellipse cx="16" cy="24" rx="4.2" ry="3" fill="url(#tb-core)" />
    </svg>
  )
}
