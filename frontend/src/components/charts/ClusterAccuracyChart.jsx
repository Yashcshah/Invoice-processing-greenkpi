/**
 * ClusterAccuracyChart
 * ─────────────────────
 * Recharts BarChart: x = cluster label, y = accuracy score (%).
 *
 * Props:
 *   data     – [{name: string, accuracy: number, corrections: number, invoices: number}]
 *   height   – chart height in px (default 200)
 *   loading  – shows skeleton when true
 *
 * Colour logic: bar turns green ≥80%, blue ≥55%, amber below.
 */
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
} from 'recharts'

// ── Bar colour by accuracy ────────────────────────────────────────────────────
function barColor(accuracy) {
  if (accuracy >= 80) return '#22C55E'   // green
  if (accuracy >= 55) return '#3B82F6'   // blue
  return '#F97316'                       // orange (needs attention)
}

// ── Custom tooltip ────────────────────────────────────────────────────────────
function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-lg px-3 py-2 text-xs">
      <p className="font-semibold text-gray-700 mb-1 truncate max-w-[140px]">{label}</p>
      <p style={{ color: barColor(d.accuracy) }} className="font-bold">
        {d.accuracy}% accuracy
      </p>
      <p className="text-gray-400">{d.invoices} inv · {d.corrections} corrections</p>
    </div>
  )
}

// ── Custom bar label (shown above bar) ───────────────────────────────────────
function BarLabel({ x, y, width, value }) {
  if (!value) return null
  return (
    <text
      x={x + width / 2}
      y={y - 4}
      fill="#6B7280"
      textAnchor="middle"
      fontSize={10}
      fontWeight={600}
    >
      {value}%
    </text>
  )
}

function Skeleton({ height }) {
  return <div style={{ height }} className="rounded-xl shimmer-bg" aria-hidden="true" />
}

function Empty({ height }) {
  return (
    <div
      style={{ height }}
      className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-200 bg-gray-50"
    >
      <p className="text-xs font-medium text-gray-400">No cluster data yet</p>
      <p className="text-xs text-gray-300 mt-0.5">Retrain to build cluster agents</p>
    </div>
  )
}

export default function ClusterAccuracyChart({ data = [], height = 200, loading = false }) {
  if (loading) return <Skeleton height={height} />
  if (!data.length) return <Empty height={height} />

  return (
    <figure
      aria-label={`Bar chart: accuracy scores for ${data.length} ML cluster${data.length !== 1 ? 's' : ''}`}
      className="w-full"
    >
      <ResponsiveContainer width="100%" height={height}>
        <BarChart
          data={data}
          margin={{ top: 20, right: 8, left: -24, bottom: 0 }}
          role="img"
          aria-label="Bar chart showing accuracy score per ML cluster"
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" vertical={false} />

          {/* 80% "good" reference line */}
          <ReferenceLine
            y={80}
            stroke="#22C55E"
            strokeDasharray="4 4"
            strokeWidth={1}
            label={{ value: '80%', position: 'insideTopRight', fontSize: 10, fill: '#22C55E' }}
          />

          <XAxis
            dataKey="name"
            tick={{ fontSize: 10, fill: '#9CA3AF' }}
            axisLine={false}
            tickLine={false}
            interval={0}
            // truncate long labels
            tickFormatter={v => (v?.length > 8 ? `${v.slice(0, 7)}…` : v)}
          />
          <YAxis
            domain={[0, 100]}
            tickFormatter={v => `${v}%`}
            tick={{ fontSize: 10, fill: '#9CA3AF' }}
            axisLine={false}
            tickLine={false}
            width={36}
          />

          <Tooltip content={<CustomTooltip />} cursor={{ fill: '#F9FAFB' }} />

          <Bar
            dataKey="accuracy"
            radius={[6, 6, 0, 0]}
            maxBarSize={48}
            label={<BarLabel />}
            isAnimationActive
            animationDuration={700}
          >
            {data.map((entry, i) => (
              <Cell key={i} fill={barColor(entry.accuracy)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </figure>
  )
}
