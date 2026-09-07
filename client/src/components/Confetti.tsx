import { useEffect, useMemo, useState } from 'react';

const COLORS = ['#10b981', '#3b82f6', '#d4a017', '#8b5cf6'];

interface Piece {
  id: number;
  left: number;
  delay: number;
  duration: number;
  color: string;
  rotate: number;
}

/**
 * Fires a short-lived burst of falling confetti pieces whenever `active` flips from
 * false to true (used to celebrate crossing the 85 score threshold).
 */
export function Confetti({ active }: { active: boolean }) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!active) {
      setShow(false);
      return;
    }
    setShow(true);
    const t = setTimeout(() => setShow(false), 2200);
    return () => clearTimeout(t);
  }, [active]);

  const pieces = useMemo<Piece[]>(
    () =>
      Array.from({ length: 24 }, (_, i) => ({
        id: i,
        left: Math.random() * 100,
        delay: Math.random() * 0.4,
        duration: 1.6 + Math.random() * 1,
        color: COLORS[i % COLORS.length],
        rotate: Math.random() * 360,
      })),
    [show]
  );

  if (!show) return null;

  return (
    <div
      aria-hidden="true"
      data-testid="milestone-fireworks"
      style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        overflow: 'hidden',
        zIndex: 9999,
      }}
    >
      {pieces.map((p) => (
        <span
          key={p.id}
          style={{
            position: 'absolute',
            top: '-10px',
            left: `${p.left}%`,
            width: 8,
            height: 14,
            background: p.color,
            borderRadius: 2,
            transform: `rotate(${p.rotate}deg)`,
            animation: `confetti-fall ${p.duration}s ${p.delay}s ease-in forwards`,
          }}
        />
      ))}
      <style>{`
        @keyframes confetti-fall {
          to {
            top: 105vh;
            transform: translateX(${Math.random() > 0.5 ? '' : '-'}40px) rotate(720deg);
            opacity: 0.9;
          }
        }
      `}</style>
    </div>
  );
}
