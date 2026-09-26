import { useEffect, useRef, type CSSProperties } from 'react'

type Props = {
  message: string
  onDone: () => void
}

const COLORS = ['#ffbe0b', '#fb5607', '#ff006e', '#8338ec', '#3a86ff', '#52b788']
const BURSTS = [
  { x: 24, y: 30, delay: 0 },
  { x: 72, y: 24, delay: 220 },
  { x: 51, y: 52, delay: 440 },
]

export function Fireworks({ message, onDone }: Props) {
  const onDoneRef = useRef(onDone)

  useEffect(() => {
    onDoneRef.current = onDone
  }, [onDone])

  useEffect(() => {
    const timeout = window.setTimeout(() => onDoneRef.current(), 3000)
    return () => window.clearTimeout(timeout)
  }, [])

  return (
    <div className="fireworks" role="status" aria-live="polite">
      {BURSTS.flatMap((burst, burstIndex) =>
        Array.from({ length: 16 }, (_, particleIndex) => {
          const angle = (particleIndex / 16) * Math.PI * 2
          const distance = 58 + (particleIndex % 4) * 12
          const style = {
            '--firework-x': `${burst.x}vw`,
            '--firework-y': `${burst.y}vh`,
            '--firework-dx': `${Math.cos(angle) * distance}px`,
            '--firework-dy': `${Math.sin(angle) * distance}px`,
            '--firework-delay': `${burst.delay + (particleIndex % 3) * 22}ms`,
            '--firework-color': COLORS[(particleIndex + burstIndex * 2) % COLORS.length],
          } as CSSProperties
          return <span key={`${burstIndex}-${particleIndex}`} style={style} aria-hidden="true" />
        }),
      )}
      <strong>{message}</strong>
    </div>
  )
}
