/**
 * KpiDoughnutChart
 * ─────────────────
 * Recharts PieChart (donut): segments for GST compliant vs non-compliant,
 * or any other named segments.
 *
 * Props:
 *   data     – [{name: string, value: number, color: string}]
 *   height   – chart area height in px (default 200)
 *   loading  – shows skeleton when true
 *   title    – optional text shown in the centre hole
 *   subtitle – optional smaller text below title
 *
 * Accessibility: figure with aria-label + role="img" on the SVG container.
 */
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts'

// ── Custom tooltip ────────────────────────────────────────────────────────────
function CustomTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const { name, value, color } = payload[0].payload
  const total = payload[0].payload._total ?? value
  const pct = total > 0 ? Math.round((value / total) * 100) : 0
  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-lg px-3 py-2 text-xs">
      <span style={{ color }} className="font-bold">{name}</span>
      <p className="text-gray-600 mt-0.5">
        {value} invoice{value !== 1 ? 's' : ''} ({pct}%)
      </p>
    </div>
  )
}

// ── Custom legend ────────────────────────────────────────────────────────────
function CustomLegend({ payload }) {
  if (!payload?.length) return null
  return (
    <ul className="flex flex-col gap-1 mt-2" role="list">
      {payload.map((entry, i) => (
        <li key={i} className="flex items-center justify-between text-xs gap-2">
          <span className="flex items-center gap-1.5 min-w-0">
            <span
              aria-hidden="true"
              className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
              style={{ background: entry.color }}
            />
            <span className="text-gray-600 truncate">{entry.value}</span>
          </span>
          <span className="font-semibold text-gray-700 tabular-nums flex-shrink-0">
            {entry.payload.value}
          </span>
        </li>
      ))}
    </ul>
  )
}

// ── Centre label (rendered as absolute overlay) ──────────────────────────────
function CentreLabel({ title, subtitle, cx, cy }) {
  if (!title) return null
  return (
    <text>
      <tspan
        x={cx}
        y={subtitle ? cy - 6 : cy + 5}
        textAnchor="middle"
        fill="#111827"
        fontSize={20}
        fontWeight={700}
      >
        {title}
      </tspan>
      {subtitle && (
        <tspan
          x={cx}
          y={cy + 14}
          textAnchor="middle"
          fill="#6B7280"
          fontSize={10}
        >
          {subtitle}
        </tspan>
      )}
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
      <p className="text-xs font-medium text-gray-400">No compliance data yet</p>
      <p className="text-xs text-gray-300 mt-0.5">Process invoices to see breakdown</p>
    </div>
  )
}

export default function KpiDoughnutChart({
  data = [],
  height = 200,
  loading = false,
  title,
  subtitle,
}) {
  if (loading) return <Skeleton height={height} />

  const hasData = data.some(d => d.value > 0)
  if (!hasData) return <Empty height={height} />

  const total = data.reduce((s, d) => s + (d.value ?? 0), 0)

  // Inject _total so tooltip can show % without extra context
  const enriched = data.map(d => ({ ...d, _total: total }))

  // Centre label defaults to total count
  const centreTitle    = title    ?? String(total)
  const centreSubtitle = subtitle ?? 'invoices'

  return (
    <figure
      aria-label={`Doughnut chart: ${data.map(d => `${d.name} ${d.value}`).join(', ')}`}
      className="w-full"
    >
      <ResponsiveContainer width="100%" height={height}>
        <PieChart role="img" aria-label="Donut chart showing KPI breakdown">
          <Pie
            data={enriched}
            cx="50%"
            cy="46%"
            innerRadius="54%"
            outerRadius="76%"
            paddingAngle={3}
            dataKey="value"
            startAngle={90}
            endAngle={-270}
            isAnimationActive
            animationDuration={700}
            label={<CentreLabel title={centreTitle} subtitle={centreSubtitle} />}
            labelLine={false}
          >
            {enriched.map((entry, i) => (
              <Cell key={i} fill={entry.color} stroke="transparent" />
            ))}
          </Pie>

          <Tooltip content={<CustomTooltip />} />

          <Legend
            content={<CustomLegend />}
            verticalAlign="bottom"
            align="center"
          />
        </PieChart>
      </ResponsiveContainer>
    </figure>
  )
}
