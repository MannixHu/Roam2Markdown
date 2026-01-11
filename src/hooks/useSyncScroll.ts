import { useRef } from 'react'

export const useSyncScroll = () => {
  const leftRef = useRef<HTMLDivElement>(null)
  const rightRef = useRef<HTMLDivElement>(null)
  const isScrollingRef = useRef<'left' | 'right' | null>(null)

  const handleScroll = (side: 'left' | 'right') => (e: React.UIEvent<HTMLDivElement>) => {
    if (isScrollingRef.current && isScrollingRef.current !== side) return

    isScrollingRef.current = side
    const source = e.currentTarget
    const target = side === 'left' ? rightRef.current : leftRef.current

    if (target) {
      const scrollPercentage = source.scrollTop / (source.scrollHeight - source.clientHeight)
      target.scrollTop = scrollPercentage * (target.scrollHeight - target.clientHeight)
    }

    setTimeout(() => {
      isScrollingRef.current = null
    }, 100)
  }

  return {
    leftRef,
    rightRef,
    onScrollLeft: handleScroll('left'),
    onScrollRight: handleScroll('right'),
  }
}
