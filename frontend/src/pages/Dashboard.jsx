import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import axios from 'axios'
import { StatusPill, KpiChip } from '../components/ui'
import {
  ConfidenceTrendChart,
  ClusterAccuracyChart,
  KpiDoughnutChart,
} from '../components/charts'
import {
  FileText,
  Upload,
  CheckCircle,
  Clock,
  AlertTriangle,
  ArrowRight,
  Brain,
  RefreshCw,
  Layers,
  Zap,
  Leaf,
  ShieldCheck,
  DollarSign,
  Eye,
  Sparkles,
  GitBranch,
  ClipboardCheck,
  ScanLine,
} from 'lucide-react'

// ── Pipeline step definitions ────────────────────────────────────────────────
const PIPELINE_STEPS = [
  { id: 'preprocess', label: 'Preprocess', Icon: ScanLine, color: 'bg-blue-400' },
  { id: 'ocr', label: 'OCR', Icon: Eye, color: 'bg-blue-500' },
  { id: 'llm', label: 'LLM', Icon: Sparkles, color: 'bg-indigo-500' },
  { id: 'gnn', label: 'GNN', Icon: GitBranch, color: 'bg-violet-500' },
  { id: 'review', label: 'Review', Icon: ClipboardCheck, color: 'bg-emerald-500' },
]

export default function Dashboard() {
  const [displayStats, setDisplayStats] = useState({
    total: 0,
    processing: 0,
    completed: 0,
    failed: 0,
  })
  const [recentInvoices, setRecentInvoices] = useState([])
  const [loading, setLoading] = useState(true)
  const [mlStats, setMlStats] = useState(null)
  const [mlLoading, setMlLoading] = useState(true)
  const [retraining, setRetraining] = useState(false)
  const [greenStats, setGreenStats] = useState(null)
  const [greenLoading, setGreenLoading] = useState(true)
  const [confidenceTrend, setConfidenceTrend] = useState([])
  const [trendLoading, setTrendLoading] = useState(true)

  const animateCountUp = (to, key, duration = 650) => {
    const startTime = performance.now()

    const step = (now) => {
      const progress = Math.min((now - startTime) / duration, 1)
      const eased = 1 - Math.pow(1 - progress, 3)

      setDisplayStats((prev) => ({
        ...prev,
        [key]: Math.round(to * eased),
      }))

      if (progress < 1) requestAnimationFrame(step)
    }

    requestAnimationFrame(step)
  }

  useEffect(() => {
    fetchDashboardData()
    fetchMlStats()
    fetchGreenStats()
    fetchConfidenceTrend()
  }, [])

  const fetchGreenStats = async () => {
    setGreenLoading(true)
    try {
      const { data } = await axios.get('/api/green-kpi/stats')
      setGreenStats(data)
    } catch {
      // backend may not be running
    } finally {
      setGreenLoading(false)
    }
  }

  const fetchMlStats = async () => {
    setMlLoading(true)
    try {
      const { data } = await axios.get('/api/learning/stats')
      setMlStats(data)
    } catch {
      // silently skip
    } finally {
      setMlLoading(false)
    }
  }

  const fetchConfidenceTrend = async () => {
    setTrendLoading(true)
    try {
      const { data } = await axios.get('/api/green-kpi/confidence-trend?days=30')
      setConfidenceTrend(data.trend ?? [])
    } catch {
      // silently skip
    } finally {
      setTrendLoading(false)
    }
  }

  const handleRetrain = async () => {
    setRetraining(true)
    try {
      await axios.post('/api/learning/retrain')
      setTimeout(async () => {
        await fetchMlStats()
        setRetraining(false)
      }, 3000)
    } catch {
      setRetraining(false)
    }
  }

  const fetchDashboardData = async () => {
    try {
      const { data: invoices, error } = await supabase
        .from('invoices')
        .select('id, status, original_filename, created_at, vendor_name')
        .order('created_at', { ascending: false })
        .limit(5)

      if (error) throw error

      const { data: allInvoices } = await supabase.from('invoices').select('status')

      if (allInvoices) {
        const newStats = {
          total: allInvoices.length,
          processing: allInvoices.filter((i) =>
            ['preprocessing', 'ocr_processing', 'extraction_processing'].includes(i.status)
          ).length,
          completed: allInvoices.filter((i) =>
            ['validated', 'exported', 'extraction_complete'].includes(i.status)
          ).length,
          failed: allInvoices.filter((i) => i.status === 'failed').length,
        }

        animateCountUp(newStats.total, 'total')
        animateCountUp(newStats.processing, 'processing')
        animateCountUp(newStats.completed, 'completed')
        animateCountUp(newStats.failed, 'failed')
      }

      setRecentInvoices(invoices || [])
    } catch (err) {
      console.error('Error fetching dashboard data:', err)
    } finally {
      setLoading(false)
    }
  }

  const gstDoughnutData = greenStats?.total_invoices > 0
    ? [
        {
          name: 'GST Compliant',
          value: greenStats.gst_valid_count ?? 0,
          color: '#22C55E',
        },
        {
          name: 'Non-Compliant',
          value: (greenStats.total_invoices ?? 0) - (greenStats.gst_valid_count ?? 0),
          color: '#EF4444',
        },
      ].filter((s) => s.value > 0)
    : []

  const clusterBarData = (mlStats?.agents ?? []).map((a) => ({
    name: a.cluster_label ?? `C${a.cluster_id}`,
    accuracy: a.accuracy_score,
    invoices: a.invoice_count,
    corrections: a.correction_count,
  }))

  const getStatusDot = (status) => {
    if (['preprocessing', 'ocr_processing', 'extraction_processing'].includes(status)) {
      return 'bg-amber-400 animate-pulse'
    }
    if (['validated', 'exported', 'extraction_complete'].includes(status)) {
      return 'bg-emerald-400'
    }
    if (status === 'failed') return 'bg-rose-400'
    return 'bg-gray-300'
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-56 rounded-2xl shimmer-bg" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-24 rounded-xl shimmer-bg" />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="h-72 rounded-xl shimmer-bg" />
          <div className="h-72 rounded-xl shimmer-bg" />
        </div>
        <div className="h-64 rounded-xl shimmer-bg" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <section
        aria-label="Invoice Processing overview"
        className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-blue-600 to-blue-500 text-white shadow-xl shadow-blue-300/40 animate-slide-up"
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-12 -right-12 w-56 h-56 rounded-full bg-white/10 blur-3xl"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute bottom-0 left-1/3 w-40 h-40 rounded-full bg-blue-400/30 blur-2xl"
        />

        <div className="relative px-6 pt-7 pb-5 flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="flex-1 min-w-0">
            <p className="text-blue-200 text-xs font-semibold uppercase tracking-widest mb-1">
              AI-Powered
            </p>
            <h1 className="text-2xl sm:text-3xl font-bold leading-tight">
              Invoice Processing
            </h1>
            <p className="mt-1 text-blue-100 text-sm max-w-md leading-relaxed">
              Upload invoices and let four AI layers — OCR, LLM, GNN, and ML cluster agents —
              extract fields, validate compliance, and learn from your corrections automatically.
            </p>
          </div>

          <Link
            to="/upload"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-white text-blue-700 rounded-xl font-semibold text-sm
                       hover:bg-blue-50 transition-all duration-150 shadow-lg hover:shadow-xl
                       hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98] flex-shrink-0"
          >
            <Upload className="w-4 h-4" aria-hidden="true" />
            Upload Invoice
          </Link>
        </div>

        <div
          role="list"
          aria-label="Invoice statistics"
          className="relative mx-6 mb-5 grid grid-cols-2 sm:grid-cols-4 gap-px rounded-xl overflow-hidden bg-white/10"
        >
          {[
            { label: 'Total Invoices', value: displayStats.total, icon: FileText, accent: 'text-blue-200' },
            { label: 'In Progress', value: displayStats.processing, icon: Clock, accent: 'text-amber-200' },
            { label: 'Completed', value: displayStats.completed, icon: CheckCircle, accent: 'text-emerald-200' },
            { label: 'Failed', value: displayStats.failed, icon: AlertTriangle, accent: 'text-rose-200' },
          ].map(({ label, value, icon: Icon, accent }) => (
            <div
              key={label}
              role="listitem"
              className="flex items-center gap-3 bg-white/10 backdrop-blur-sm px-4 py-3"
            >
              <Icon className={`w-5 h-5 flex-shrink-0 ${accent}`} aria-hidden="true" />
              <div>
                <p className="text-xl font-bold leading-none">{value}</p>
                <p className="text-xs text-blue-100 mt-0.5">{label}</p>
              </div>
            </div>
          ))}
        </div>

        <div
          aria-label="Processing pipeline: Preprocess, OCR, LLM, GNN, Review"
          className="relative mx-6 mb-6"
        >
          <p className="text-[11px] text-blue-200 uppercase tracking-widest font-semibold mb-3">
            Processing Pipeline
          </p>

          <div className="flex items-center gap-0" role="list">
            {PIPELINE_STEPS.map((step, i) => (
              <div
                key={step.id}
                role="listitem"
                className="flex items-center flex-1 min-w-0"
              >
                <div className="flex flex-col items-center flex-shrink-0">
                  <div
                    className={`w-9 h-9 rounded-full ${step.color} flex items-center justify-center shadow-lg ring-2 ring-white/30`}
                    aria-label={step.label}
                  >
                    <step.Icon className="w-4 h-4 text-white" aria-hidden="true" />
                  </div>
                  <span className="mt-1.5 text-[10px] text-blue-100 font-medium whitespace-nowrap">
                    {step.label}
                  </span>
                </div>

                {i < PIPELINE_STEPS.length - 1 && (
                  <div aria-hidden="true" className="flex-1 flex items-center mx-1 mb-4">
                    <div className="flex-1 h-px bg-white/30" />
                    <svg
                      viewBox="0 0 6 8"
                      className="w-1.5 h-2 text-white/40 flex-shrink-0"
                      fill="currentColor"
                    >
                      <path d="M0 0 L6 4 L0 8 Z" />
                    </svg>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      <div
        role="list"
        aria-label="Invoice count summary"
        className="grid grid-cols-2 lg:grid-cols-4 gap-4"
      >
        {[
          { title: 'Total Invoices', key: 'total', Icon: FileText, gradient: 'from-blue-500 to-blue-600', shadow: 'shadow-blue-200' },
          { title: 'In Progress', key: 'processing', Icon: Clock, gradient: 'from-amber-400 to-orange-500', shadow: 'shadow-amber-200' },
          { title: 'Completed', key: 'completed', Icon: CheckCircle, gradient: 'from-emerald-400 to-green-500', shadow: 'shadow-emerald-200' },
          { title: 'Failed', key: 'failed', Icon: AlertTriangle, gradient: 'from-rose-400 to-red-500', shadow: 'shadow-rose-200' },
        ].map(({ title, key, Icon, gradient, shadow }, i) => (
          <div
            key={title}
            role="listitem"
            style={{ animationDelay: `${i * 70}ms` }}
            className="animate-slide-up card-hover bg-white rounded-xl p-5 border border-gray-100 flex items-center gap-4 shadow-sm"
          >
            <div className={`p-3 rounded-xl bg-gradient-to-br ${gradient} shadow-lg ${shadow} flex-shrink-0`}>
              <Icon className="w-5 h-5 text-white" aria-hidden="true" />
            </div>
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide leading-tight">
                {title}
              </p>
              <p className="text-3xl font-bold text-gray-900 leading-tight tabular-nums">
                {displayStats[key]}
              </p>
            </div>
          </div>
        ))}
      </div>

      <section
        aria-label="Extraction confidence trend"
        className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden animate-slide-up hover:shadow-lg transition-shadow duration-200"
        style={{ animationDelay: '0.12s' }}
      >
        <header className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
              <Zap className="w-4 h-4 text-blue-500" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-gray-900">Confidence Trend</h2>
              <p className="text-[11px] text-gray-400 leading-tight">
                Average extraction confidence per day — last 30 days
              </p>
            </div>
          </div>

          {confidenceTrend.length > 0 && (
            <div className="text-right flex-shrink-0">
              <p className="text-lg font-bold text-blue-600 tabular-nums leading-none">
                {confidenceTrend[confidenceTrend.length - 1]?.avg_confidence ?? '—'}%
              </p>
              <p className="text-[11px] text-gray-400">latest</p>
            </div>
          )}
        </header>

        <div className="px-4 py-4">
          <ConfidenceTrendChart
            data={confidenceTrend}
            height={200}
            loading={trendLoading}
          />
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <article
          aria-label="ML Cluster Agents panel"
          className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden animate-slide-up hover:shadow-lg transition-shadow duration-200"
          style={{ animationDelay: '0.15s' }}
        >
          <header className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-violet-100 flex items-center justify-center flex-shrink-0">
                <Brain className="w-4 h-4 text-violet-600" aria-hidden="true" />
              </div>
              <h2 className="text-sm font-semibold text-gray-900">ML Cluster Agents</h2>
              {mlStats?.is_trained && (
                <span className="px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 text-[11px] font-semibold">
                  Active
                </span>
              )}
            </div>

            <button
              onClick={handleRetrain}
              disabled={retraining}
              aria-label={retraining ? 'Retraining in progress' : 'Retrain ML cluster agents'}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-violet-600
                         border border-violet-200 rounded-lg hover:bg-violet-50 disabled:opacity-50
                         transition-all duration-150 hover:scale-[1.02] active:scale-[0.98]
                         focus-visible:ring-2 focus-visible:ring-violet-400"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${retraining ? 'animate-spin' : ''}`} aria-hidden="true" />
              {retraining ? 'Training…' : 'Retrain'}
            </button>
          </header>

          {mlLoading ? (
            <div className="px-5 py-6 space-y-2">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-4 rounded shimmer-bg" style={{ width: `${70 - i * 15}%` }} />
              ))}
            </div>
          ) : !mlStats?.is_trained || mlStats.total_clusters === 0 ? (
            <div className="px-5 py-10 text-center animate-fade-in">
              <div className="w-12 h-12 rounded-2xl bg-violet-50 flex items-center justify-center mx-auto mb-3">
                <Brain className="w-6 h-6 text-violet-300 animate-float" aria-hidden="true" />
              </div>
              <p className="text-sm font-medium text-gray-600 mb-1">No clusters yet</p>
              <p className="text-xs text-gray-400 max-w-xs mx-auto">
                Process at least 2 invoices then click <span className="font-semibold text-violet-600">Retrain</span> to build the first agents.
              </p>
            </div>
          ) : (
            <div className="px-5 py-4 space-y-4">
              <div
                role="list"
                aria-label="Cluster agent metrics"
                className="grid grid-cols-3 gap-3"
              >
                {[
                  { label: 'Clusters', value: mlStats.total_clusters, Icon: Layers, color: 'text-violet-600', bg: 'bg-violet-50' },
                  { label: 'Avg Accuracy', value: `${mlStats.avg_accuracy}%`, Icon: Zap, color: 'text-emerald-600', bg: 'bg-emerald-50' },
                  { label: 'Corrections', value: mlStats.total_corrections, Icon: CheckCircle, color: 'text-blue-600', bg: 'bg-blue-50' },
                ].map(({ label, value, Icon, color, bg }) => (
                  <div
                    key={label}
                    role="listitem"
                    className={`rounded-xl p-3 ${bg} flex flex-col gap-1`}
                  >
                    <Icon className={`w-4 h-4 ${color}`} aria-hidden="true" />
                    <p className="text-lg font-bold text-gray-900 leading-none tabular-nums">{value}</p>
                    <p className="text-[11px] text-gray-500 leading-tight">{label}</p>
                  </div>
                ))}
              </div>

              <div>
                <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-2">
                  Accuracy by cluster
                </p>
                <ClusterAccuracyChart data={clusterBarData} height={150} loading={mlLoading} />
              </div>

              <ul aria-label="Top cluster agents" className="space-y-1.5">
                {mlStats.agents.slice(0, 3).map((agent, i) => (
                  <li
                    key={agent.cluster_id}
                    style={{ animationDelay: `${i * 50}ms` }}
                    className="animate-slide-in-left flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="w-6 h-6 rounded-md bg-violet-100 flex items-center justify-center flex-shrink-0 text-[10px] font-bold text-violet-600">
                        #{agent.cluster_id}
                      </span>
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-gray-800 truncate">
                          {agent.cluster_label || `Cluster ${agent.cluster_id}`}
                        </p>
                        <p className="text-[10px] text-gray-400">
                          {agent.invoice_count} inv · {agent.correction_count} corrections
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 flex-shrink-0 ml-3">
                      <div className="w-16 h-1.5 rounded-full bg-gray-200 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-violet-500 transition-all duration-700"
                          style={{ width: `${agent.accuracy_score}%` }}
                          aria-label={`${agent.accuracy_score}% accuracy`}
                        />
                      </div>
                      <span className="text-xs font-semibold text-gray-600 tabular-nums w-8 text-right">
                        {agent.accuracy_score}%
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </article>

        <article
          aria-label="Green KPI Snapshot panel"
          className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden animate-slide-up hover:shadow-lg transition-shadow duration-200"
          style={{ animationDelay: '0.2s' }}
        >
          <header className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-emerald-100 flex items-center justify-center flex-shrink-0">
                <Leaf className="w-4 h-4 text-emerald-600" aria-hidden="true" />
              </div>
              <h2 className="text-sm font-semibold text-gray-900">Green KPI Snapshot</h2>
              {greenStats?.total_invoices > 0 && (
                <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-[11px] font-semibold">
                  {greenStats.total_invoices} processed
                </span>
              )}
            </div>

            <Link
              to="/invoices"
              className="text-xs font-medium text-emerald-600 hover:text-emerald-700 flex items-center gap-1 group"
              aria-label="View all invoices"
            >
              View all
              <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform duration-200" aria-hidden="true" />
            </Link>
          </header>

          {greenLoading ? (
            <div className="px-5 py-6 grid grid-cols-2 gap-3">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="h-14 rounded-lg shimmer-bg" />
              ))}
            </div>
          ) : !greenStats || greenStats.total_invoices === 0 ? (
            <div className="px-5 py-10 text-center animate-fade-in">
              <div className="w-12 h-12 rounded-2xl bg-emerald-50 flex items-center justify-center mx-auto mb-3">
                <Leaf className="w-6 h-6 text-emerald-300 animate-float" aria-hidden="true" />
              </div>
              <p className="text-sm font-medium text-gray-600 mb-1">No Green KPI data yet</p>
              <p className="text-xs text-gray-400 max-w-xs mx-auto">
                Process invoices to start tracking sustainability, GST compliance, and spend.
              </p>
            </div>
          ) : (
            <div className="px-5 py-4 space-y-4">
              <div
                role="list"
                aria-label="Green KPI metrics"
                className="grid grid-cols-2 gap-3"
              >
                {[
                  {
                    label: 'Total Spend',
                    value: `$${(greenStats.total_spend_aud || 0).toLocaleString()}`,
                    Icon: DollarSign,
                    color: 'text-blue-600',
                    bg: 'bg-blue-50',
                  },
                  {
                    label: 'GST Compliance',
                    value: `${greenStats.gst_compliance_pct || 0}%`,
                    Icon: ShieldCheck,
                    color: 'text-emerald-600',
                    bg: 'bg-emerald-50',
                  },
                ].map(({ label, value, Icon, color, bg }) => (
                  <div key={label} role="listitem" className={`rounded-xl p-3 ${bg} flex items-center gap-2.5`}>
                    <Icon className={`w-5 h-5 ${color} flex-shrink-0`} aria-hidden="true" />
                    <div>
                      <p className="text-lg font-bold text-gray-900 leading-none tabular-nums">{value}</p>
                      <p className="text-[11px] text-gray-500 mt-0.5">{label}</p>
                    </div>
                  </div>
                ))}
              </div>

              <div>
                <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-2">
                  GST compliance
                </p>
                <KpiDoughnutChart
                  data={gstDoughnutData}
                  height={190}
                  loading={greenLoading}
                  title={`${greenStats.gst_compliance_pct ?? 0}%`}
                  subtitle="GST OK"
                />
              </div>

              {greenStats.top_sustainability_tags?.length > 0 && (
                <div>
                  <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-2">
                    Top sustainability tags
                  </p>
                  <ul aria-label="Sustainability tags" className="flex flex-col gap-1.5">
                    {greenStats.top_sustainability_tags.slice(0, 5).map(([tag, count]) => (
                      <li key={tag} className="flex items-center justify-between gap-2">
                        <KpiChip type={tag} />
                        <span className="text-[11px] text-gray-400 tabular-nums flex-shrink-0">
                          ×{count}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="flex flex-wrap gap-2 pt-1 border-t border-gray-50">
                <KpiChip
                  type={(greenStats.gst_compliance_pct ?? 0) >= 90 ? 'gst_ok' : 'gst_issue'}
                />
                {(greenStats.qbcc_detected ?? 0) > 0 && <KpiChip type="qbcc_missing" />}
                {(greenStats.retention_detected ?? 0) > 0 && <KpiChip type="retention_clause" />}
              </div>
            </div>
          )}
        </article>
      </div>

      <section
        aria-label="Recent invoices"
        className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden animate-slide-up hover:shadow-lg transition-shadow duration-200"
        style={{ animationDelay: '0.25s' }}
      >
        <header className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-blue-500" aria-hidden="true" />
            <h2 className="text-sm font-semibold text-gray-900">Recent Invoices</h2>
          </div>

          <Link
            to="/invoices"
            className="text-xs font-medium text-blue-600 hover:text-blue-700 flex items-center gap-1 group"
          >
            View all
            <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform duration-200" aria-hidden="true" />
          </Link>
        </header>

        {recentInvoices.length === 0 ? (
          <div className="px-5 py-14 text-center animate-fade-in">
            <div className="w-14 h-14 rounded-2xl bg-blue-50 flex items-center justify-center mx-auto mb-3">
              <FileText className="w-7 h-7 text-blue-300 animate-float" aria-hidden="true" />
            </div>
            <p className="text-sm font-medium text-gray-600 mb-1">No invoices yet</p>
            <p className="text-xs text-gray-400 mb-5">Upload your first invoice to get started</p>
            <Link
              to="/upload"
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-xl
                         font-semibold text-sm hover:bg-blue-700 transition-all duration-150
                         shadow-md hover:shadow-lg hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98]"
            >
              <Upload className="w-4 h-4" aria-hidden="true" />
              Upload Invoice
            </Link>
          </div>
        ) : (
          <ul aria-label="Recent invoice list" className="divide-y divide-gray-50">
            {recentInvoices.map((invoice, i) => (
              <li key={invoice.id}>
                <Link
                  to={`/invoices/${invoice.id}`}
                  style={{ animationDelay: `${0.25 + i * 0.05}s` }}
                  className="animate-slide-in-left flex items-center justify-between px-5 py-3.5
                             hover:bg-gray-50 transition-colors duration-150 group"
                  aria-label={`Invoice: ${invoice.original_filename}, status: ${invoice.status}`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="relative p-2 bg-gray-100 rounded-xl group-hover:bg-blue-50 transition-colors duration-200 flex-shrink-0">
                      <FileText className="w-4 h-4 text-gray-400 group-hover:text-blue-500 transition-colors duration-200" aria-hidden="true" />
                      <span
                        aria-hidden="true"
                        className={`absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full border-2 border-white ${getStatusDot(invoice.status)}`}
                      />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 group-hover:text-blue-600 transition-colors duration-200 truncate">
                        {invoice.original_filename}
                      </p>
                      <p className="text-[11px] text-gray-400 mt-0.5">
                        {invoice.vendor_name && (
                          <span className="text-indigo-500 font-medium">{invoice.vendor_name} · </span>
                        )}
                        {new Date(invoice.created_at).toLocaleDateString()}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2.5 flex-shrink-0 ml-3">
                    <StatusPill status={invoice.status} />
                    <ArrowRight
                      className="w-3.5 h-3.5 text-gray-300 group-hover:text-gray-500 group-hover:translate-x-0.5 transition-all duration-200"
                      aria-hidden="true"
                    />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}