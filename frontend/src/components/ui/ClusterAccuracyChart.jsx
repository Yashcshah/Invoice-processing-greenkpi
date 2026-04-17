/**
 * ClusterAccuracyChart
 *
 * Placeholder bar chart for ML Cluster accuracy.
 * Renders a lightweight inline bar chart using pure CSS/SVG — no chart library
 * needed. Replace the internals with Recharts / Chart.js when a richer chart
 * is required; the prop contract will stay the same.
 *
 * Props:
 *   agents  – array of { cluster_id, cluster_label, accuracy_score, invoice_count }
 *   height  – pixel height of the chart area (default 140)
 */
export default function ClusterAccuracyChart({ agents = [], height = 140 }) {
  if (!agents || agents.length === 0) {
    return (
      <div
        style={{ height }}
        className="flex flex-col items-center justify-center rounded-xl bg-gray-50 border border-dashed border-gray-200"
        aria-label="Cluster accuracy chart — no data"
      >
        <p className="text-xs text-gray-400 font-medium">No cluster data yet</p>
        <p className="text-xs text-gray-300 mt-0.5">Retrain to generate clusters</p>
      </div>
    )
  }

  const MAX_BARS = 6
  const visible = agents.slice(0, MAX_BARS)
  const maxScore = Math.max(...visible.map(a => a.accuracy_score ?? 0), 1)

  return (
    <figure
      aria-label="Bar chart: ML cluster accuracy scores"
      className="w-full"
      style={{ height }}
    >
      <div className="flex items-end justify-between gap-1.5 h-full pb-5 relative">
        {/* Horizontal guide lines */}
        {[100, 75, 50, 25].map(pct => (
          <span
            key={pct}
            aria-hidden="true"
            className="absolute left-0 right-0 border-t border-gray-100"
            style={{ bottom: `calc(${pct}% * (${height - 20}px / ${height}px) + 20px)` }}
          />
        ))}

        {visible.map((agent, i) => {
          const barPct  = ((agent.accuracy_score ?? 0) / maxScore) * 100
          const label   = agent.cluster_label
            ? agent.cluster_label.slice(0, 8)
            : `C${agent.cluster_id}`
          const score   = agent.accuracy_score ?? 0
          const barColor = score >= 80 ? 'bg-blue-500'
                         : score >= 55 ? 'bg-blue-400'
                         : 'bg-blue-300'

          return (
            <div
              key={agent.cluster_id}
              className="flex-1 flex flex-col items-center justify-end gap-0.5 h-full"
              title={`${agent.cluster_label || `Cluster ${agent.cluster_id}`}: ${score}%`}
            >
              {/* Score label */}
              <span className="text-[10px] font-semibold text-blue-600 leading-none mb-0.5">
                {score}%
              </span>

              {/* Bar */}
              <div
                aria-label={`${label}: ${score}%`}
                role="img"
                className={[
                  'w-full rounded-t-md transition-all duration-700',
                  barColor,
                ].join(' ')}
                style={{
                  height: `${barPct}%`,
                  minHeight: '4px',
                  maxHeight: `calc(100% - 28px)`,
                  animationDelay: `${i * 80}ms`,
                }}
              />

              {/* X-axis label */}
              <span className="text-[10px] text-gray-400 truncate w-full text-center leading-none mt-1">
                {label}
              </span>
            </div>
          )
        })}
      </div>
    </figure>
  )
}
