import { useState, useEffect, useRef } from 'react'

interface UseAnimatedNumberOptions {
  duration?: number
  decimals?: number
  easing?: (t: number) => number
}

// Ease out cubic function for smooth deceleration
const easeOutCubic = (t: number): number => {
  return 1 - Math.pow(1 - t, 3)
}

export function useAnimatedNumber(
  targetValue: number,
  options: UseAnimatedNumberOptions = {}
) {
  const {
    duration = 2000,
    decimals = 1,
    easing = easeOutCubic
  } = options

  const [displayValue, setDisplayValue] = useState(targetValue)
  const animationRef = useRef<number | null>(null)
  const startValueRef = useRef(targetValue)
  const startTimeRef = useRef<number | null>(null)

  useEffect(() => {
    // If target hasn't changed, don't animate
    if (targetValue === displayValue) return

    const startValue = displayValue
    startValueRef.current = startValue
    startTimeRef.current = null

    const animate = (currentTime: number) => {
      if (startTimeRef.current === null) {
        startTimeRef.current = currentTime
      }

      const elapsed = currentTime - startTimeRef.current
      const progress = Math.min(elapsed / duration, 1)
      
      // Apply easing function
      const easedProgress = easing(progress)
      
      // Calculate current value
      const currentValue = startValue + (targetValue - startValue) * easedProgress
      
      setDisplayValue(currentValue)

      if (progress < 1) {
        animationRef.current = requestAnimationFrame(animate)
      } else {
        setDisplayValue(targetValue)
        animationRef.current = null
      }
    }

    animationRef.current = requestAnimationFrame(animate)

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current)
      }
    }
  }, [targetValue, duration, easing])

  // Format the display value
  const formattedValue = displayValue.toFixed(decimals)

  return formattedValue
}