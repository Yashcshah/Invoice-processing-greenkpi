/**
 * ConfidenceBar
 *
 * Animated horizontal bar showing ML extraction confidence (0.0 – 1.0).
 * The fill colour shifts from blue → green as confidence rises, giving an
 * instant visual cue without the user needing to read a number.
 *
 * Usage:
 *   <ConfidenceBar value={0.87} />
 *   <ConfidenceBar value={0.42} showLabel />
 *   <ConfidenceBar value={0.95} showLabel className="w-32" />
 *
 * Accessibility: the outer element carries role="meter" with aria-valuenow,
 * aria-valuemin, aria-valuemax, and aria-label so assistive technologies
 * can announce the exact percentage.
 */

import { useMemo } from 'react'

/**
 * Map a 0-1 confidence score to a Tailwind fill class.
 *   ≥ 0.85  → blue-600   (high confidence)
 *   ≥ 0.65  → blue-500   (good)
 *   ≥ 0.45  → blue-400   (medium)
 *   < 0.45  → blue-300   (low)
 */
function fillClass(value) {
  if (value >= 0.85) return 'bg-blue-600'
  if (value >= 0.65) return 'bg-blue-500'
  if (value >= 0.45) return 'bg-blue-400'
  return 'bg-blue-300'
}

export default function ConfidenceBar({ value = 0, showLabel = false, className = '' }) {
  // Clamp to [0, 1]
  const clamped = Math.min(1, Math.max(0, value ?? 0))
  const pct     = Math.round(clamped * 100)
  const fill    = useMemo(() => fillClass(clamped), [clamped])

  return (
    <div className={['flex items-center gap-2', className].join(' ')}>
      {/* Track */}
      <div
        role="meter"
        aria-label={`Confidence score: ${pct}%`}
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        className="flex-1 h-2 bg-blue-100 rounded-full overflow-hidden"
      >
        {/* Fill */}
        <div
          aria-hidden="true"
          className={[
            'h-full rounded-full',
            'transition-all duration-700 ease-out',
            fill,
          ].join(' ')}
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* Optional numeric label */}
      {showLabel && (
        <span
          aria-hidden="true"
          className="text-xs font-medium text-gray-500 tabular-nums w-8 text-right shrink-0"
        >
          {pct}%
        </span>
      )}
    </div>
  )
}
