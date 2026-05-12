import { useEffect, useRef } from 'react'

export default function LoadMoreSentinel({
  hasMore,
  isLoading,
  onIntersect,
  label
}: {
  hasMore: boolean
  isLoading: boolean
  onIntersect: () => void
  label?: string
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!hasMore || isLoading) return
    const el = ref.current
    if (!el) return
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) onIntersect()
      },
      { rootMargin: '200px 0px 200px 0px' }
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [hasMore, isLoading, onIntersect])

  if (!hasMore && !isLoading) return null
  return (
    <div ref={ref} className="px-4 py-4 text-center text-[11px] text-muted">
      {isLoading ? (
        <span className="inline-flex items-center gap-2">
          <span className="tb-pulse inline-block w-1.5 h-1.5 rounded-full bg-accent" />
          {label ?? 'Loading more…'}
        </span>
      ) : (
        '…'
      )}
    </div>
  )
}
