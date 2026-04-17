/**
 * KpiDoughnutChart
 *
 * Lightweight SVG doughnut chart for Green KPI breakdown.
 * No external chart library — pure SVG so it works offline and loads instantly.
 * Replace with Recharts <PieChart> / Chart.js doughnut when richer interactions
 * are needed; the prop contract stays the same.
 *
 * Props:
 *   segments – array of { label, value, color } — values are proportional (not %)
 *   size     – SVG width/height in px (default 120)
 *   thickness – stroke width (default 18)
 *   centerLabel – string shown in the centre hole (default: total)
 *   centerSub   – smaller text below centerLabel (default: 'invoices')
 */
export default function KpiDoughnutChart({
  segments = [],
  size = 120,
  thickness = 18,
  centerLabel,
  centerSub = 'invoices',
}) {
  const r          = (size / 2) - thickness / 2 - 2
  const circumf    = 2 * Math.PI * r
  const total      = segments.reduce((s, seg) => s + (seg.value ?? 0), 0)
  const cx         = size / 2
  const cy         = size / 2

  // Empty state
  if (total === 0 || segments.length === 0) {
    return (
      <div
        style={{ width: size, height: size }}
        className="flex flex-col items-center justify-center rounded-full border-4 border-dashed border-gray-200 mx-auto"
        aria-label="KPI doughnut chart — no data"
      >
        <p className="text-[10px] text-gray-300 font-medium text-center px-2">No data</p>
      </div>
    )
  }

  const displayLabel = centerLabel ?? String(total)
  let offset = 0

  return (
    <figure
      aria-label={`KPI doughnut chart — total ${total} invoices`}
      className="flex flex-col items-center gap-3"
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-hidden="true"
        style={{ transform: 'rotate(-90deg)' }}
      >
        {/* Track */}
        <circle
          cx={cx} cy={cy} r={r}
          fill="none"
          stroke="#EFF6FF"
          strokeWidth={thickness}
        />

        {/* Segments */}
        {segments.map((seg, i) => {
          const segLen  = (seg.value / total) * circumf
          const dash    = `${segLen} ${circumf - segLen}`
          const segOffset = circumf - offset
          offset += segLen

          return (
            <circle
              key={i}
              cx={cx} cy={cy} r={r}
              fill="none"
              stroke={seg.color ?? '#3B82F6'}
              strokeWidth={thickness}
              strokeDasharray={dash}
              strokeDashoffset={-offset + segLen}
              strokeLinecap="butt"
              aria-label={`${seg.label}: ${seg.value}`}
            >
              <title>{seg.label}: {seg.value}</title>
            </circle>
          )
        })}
      </svg>

      {/* Centre label — rendered outside SVG so it sits on top */}
      <div
        style={{
          position: 'absolute',
          width: size - thickness * 2 - 8,
          textAlign: 'center',
          pointerEvents: 'none',
        }}
        aria-hidden="true"
      >
        <span className="text-base font-bold text-gray-900 leading-none">{displayLabel}</span>
        <span className="block text-[10px] text-gray-400">{centerSub}</span>
      </div>

      {/* Legend */}
      <ul className="flex flex-col gap-1 w-full" role="list">
        {segments.map((seg, i) => (
          <li key={i} className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="w-2 h-2 rounded-full shrink-0"
                style={{ background: seg.color ?? '#3B82F6' }}
              />
              <span className="text-gray-600 truncate max-w-[100px]">{seg.label}</span>
            </span>
            <span className="font-semibold text-gray-700 tabular-nums">{seg.value}</span>
          </li>
        ))}
      </ul>
    </figure>
  )
}
