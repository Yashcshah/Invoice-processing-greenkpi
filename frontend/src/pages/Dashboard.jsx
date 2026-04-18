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

const PIPELINE_STEPS = [
  { id: 'preprocess', label: 'Preprocess', Icon: ScanLine, tone: 'bg-blue-500' },
  { id: 'ocr', label: 'OCR', Icon: Eye, tone: 'bg-sky-500' },
  { id: 'llm', label: 'LLM', Icon: Sparkles, tone: 'bg-indigo-500' },
  { id: 'gnn', label: 'GNN', Icon: GitBranch, tone: 'bg-violet-500' },
  { id: 'review', label: 'Review', Icon: ClipboardCheck, tone: 'bg-emerald-500' },
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

  const animateCountUp = (to, key, duration = 700) => {
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

  const gstDoughnutData =
    greenStats?.total_invoices > 0
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
      return 'bg-amber-400'
    }
    if (['validated', 'exported', 'extraction_complete'].includes(status)) {
      return 'bg-emerald-400'
    }
    if (status === 'failed') return 'bg-rose-400'
    return 'bg-slate-300'
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-64 rounded-3xl shimmer-bg" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-28 rounded-3xl shimmer-bg" />
          ))}
        </div>
        <div className="h-80 rounded-3xl shimmer-bg" />
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <div className="h-80 rounded-3xl shimmer-bg" />
          <div className="h-80 rounded-3xl shimmer-bg" />
        </div>
        <div className="h-72 rounded-3xl shimmer-bg" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <section className="relative overflow-hidden rounded-3xl border border-blue-200 bg-gradient-to-br from-blue-600 via-blue-600 to-indigo-600 p-6 text-white shadow-xl shadow-blue-200/60 sm:p-8">
        <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-white/10 blur-3xl" />
        <div className="pointer-events-none absolute bottom-0 left-1/3 h-40 w-40 rounded-full bg-cyan-300/10 blur-2xl" />

        <div className="relative flex flex-col gap-6">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-2xl">
              <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-blue-100">
                <Sparkles className="h-3.5 w-3.5" />
                AI-powered processing
              </div>

              <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
                Invoice processing dashboard
              </h1>

              <p className="mt-3 max-w-2xl text-sm leading-6 text-blue-100 sm:text-base">
                Track upload volume, extraction confidence, ML agent learning, and green KPI
                signals across your invoice pipeline.
              </p>
            </div>

            <Link
              to="/upload"
              className="inline-flex items-center gap-2 self-start rounded-2xl bg-white px-5 py-3 text-sm font-semibold text-blue-700 shadow-lg transition hover:-translate-y-0.5 hover:bg-blue-50 hover:shadow-xl"
            >
              <Upload className="h-4 w-4" />
              Upload invoice
            </Link>
          </div>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              {
                label: 'Total invoices',
                value: displayStats.total,
                icon: FileText,
                accent: 'text-blue-100',
              },
              {
                label: 'In progress',
                value: displayStats.processing,
                icon: Clock,
                accent: 'text-amber-200',
              },
              {
                label: 'Completed',
                value: displayStats.completed,
                icon: CheckCircle,
                accent: 'text-emerald-200',
              },
              {
                label: 'Failed',
                value: displayStats.failed,
                icon: AlertTriangle,
                accent: 'text-rose-200',
              },
            ].map(({ label, value, icon: Icon, accent }) => (
              <div
                key={label}
                className="rounded-2xl border border-white/10 bg-white/10 px-4 py-4 backdrop-blur-sm"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/10">
                    <Icon className={`h-5 w-5 ${accent}`} />
                  </div>
                  <div>
                    <p className="text-2xl font-bold leading-none">{value}</p>
                    <p className="mt-1 text-xs text-blue-100">{label}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div>
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-blue-100">
              Processing pipeline
            </p>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              {PIPELINE_STEPS.map((step) => (
                <div
                  key={step.id}
                  className="rounded-2xl border border-white/10 bg-white/10 px-4 py-4 text-center backdrop-blur-sm"
                >
                  <div
                    className={`mx-auto flex h-11 w-11 items-center justify-center rounded-2xl ${step.tone} shadow-lg`}
                  >
                    <step.Icon className="h-5 w-5 text-white" />
                  </div>
                  <p className="mt-3 text-sm font-semibold text-white">{step.label}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          {
            title: 'Total invoices',
            key: 'total',
            Icon: FileText,
            bg: 'from-blue-500 to-blue-600',
          },
          {
            title: 'In progress',
            key: 'processing',
            Icon: Clock,
            bg: 'from-amber-400 to-orange-500',
          },
          {
            title: 'Completed',
            key: 'completed',
            Icon: CheckCircle,
            bg: 'from-emerald-400 to-green-500',
          },
          {
            title: 'Failed',
            key: 'failed',
            Icon: AlertTriangle,
            bg: 'from-rose-400 to-red-500',
          },
        ].map(({ title, key, Icon, bg }) => (
          <div
            key={title}
            className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg"
          >
            <div className="flex items-center gap-4">
              <div
                className={`flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br ${bg} text-white shadow-lg`}
              >
                <Icon className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {title}
                </p>
                <p className="mt-1 text-3xl font-bold leading-none text-slate-900">
                  {displayStats[key]}
                </p>
              </div>
            </div>
          </div>
        ))}
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-blue-50">
              <Zap className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Confidence trend</h2>
              <p className="text-xs text-slate-500">
                Average extraction confidence over the last 30 days
              </p>
            </div>
          </div>

          {confidenceTrend.length > 0 && (
            <div className="text-left sm:text-right">
              <p className="text-2xl font-bold leading-none text-blue-600">
                {confidenceTrend[confidenceTrend.length - 1]?.avg_confidence ?? '—'}%
              </p>
              <p className="text-xs text-slate-500">latest</p>
            </div>
          )}
        </div>

        <div className="px-4 py-4 sm:px-5">
          <ConfidenceTrendChart
            data={confidenceTrend}
            height={240}
            loading={trendLoading}
          />
        </div>
      </section>

      <section className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <article className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-violet-100">
                <Brain className="h-5 w-5 text-violet-600" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-slate-900">ML cluster agents</h2>
                <p className="text-xs text-slate-500">Learning from invoice corrections</p>
              </div>
              {mlStats?.is_trained && (
                <span className="rounded-full bg-violet-100 px-2.5 py-1 text-[11px] font-semibold text-violet-700">
                  Active
                </span>
              )}
            </div>

            <button
              onClick={handleRetrain}
              disabled={retraining}
              className="inline-flex items-center gap-2 rounded-2xl border border-violet-200 bg-white px-4 py-2.5 text-sm font-medium text-violet-700 transition hover:bg-violet-50 disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${retraining ? 'animate-spin' : ''}`} />
              {retraining ? 'Training...' : 'Retrain'}
            </button>
          </div>

          {mlLoading ? (
            <div className="space-y-3 px-5 py-6">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="h-14 rounded-2xl shimmer-bg" />
              ))}
            </div>
          ) : !mlStats?.is_trained || mlStats.total_clusters === 0 ? (
            <div className="px-5 py-14 text-center">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-3xl bg-violet-50">
                <Brain className="h-7 w-7 text-violet-300" />
              </div>
              <p className="text-sm font-semibold text-slate-700">No clusters yet</p>
              <p className="mt-2 text-sm text-slate-500">
                Process at least 2 invoices, then retrain to build your first ML agents.
              </p>
            </div>
          ) : (
            <div className="space-y-5 px-5 py-5">
              <div className="grid grid-cols-3 gap-3">
                {[
                  {
                    label: 'Clusters',
                    value: mlStats.total_clusters,
                    Icon: Layers,
                    tone: 'bg-violet-50 text-violet-700',
                  },
                  {
                    label: 'Avg accuracy',
                    value: `${mlStats.avg_accuracy}%`,
                    Icon: Zap,
                    tone: 'bg-emerald-50 text-emerald-700',
                  },
                  {
                    label: 'Corrections',
                    value: mlStats.total_corrections,
                    Icon: CheckCircle,
                    tone: 'bg-blue-50 text-blue-700',
                  },
                ].map(({ label, value, Icon, tone }) => (
                  <div key={label} className="rounded-2xl border border-slate-100 bg-slate-50 p-3">
                    <div className={`mb-2 inline-flex rounded-xl p-2 ${tone}`}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <p className="text-lg font-bold text-slate-900">{value}</p>
                    <p className="text-[11px] text-slate-500">{label}</p>
                  </div>
                ))}
              </div>

              <div>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Accuracy by cluster
                </p>
                <ClusterAccuracyChart data={clusterBarData} height={180} loading={mlLoading} />
              </div>

              <div className="space-y-2">
                {mlStats.agents.slice(0, 3).map((agent) => (
                  <div
                    key={agent.cluster_id}
                    className="flex items-center justify-between gap-3 rounded-2xl bg-slate-50 px-3 py-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-800">
                        {agent.cluster_label || `Cluster ${agent.cluster_id}`}
                      </p>
                      <p className="text-xs text-slate-500">
                        {agent.invoice_count} invoices · {agent.correction_count} corrections
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <div className="h-2 w-20 overflow-hidden rounded-full bg-slate-200">
                        <div
                          className="h-full rounded-full bg-violet-500"
                          style={{ width: `${agent.accuracy_score}%` }}
                        />
                      </div>
                      <span className="w-10 text-right text-xs font-semibold text-slate-600">
                        {agent.accuracy_score}%
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </article>

        <article className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-100">
                <Leaf className="h-5 w-5 text-emerald-600" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-slate-900">Green KPI snapshot</h2>
                <p className="text-xs text-slate-500">Sustainability and compliance overview</p>
              </div>

              {greenStats?.total_invoices > 0 && (
                <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
                  {greenStats.total_invoices} processed
                </span>
              )}
            </div>

            <Link
              to="/invoices"
              className="inline-flex items-center gap-1 text-sm font-medium text-emerald-700 transition hover:text-emerald-800"
            >
              View all
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>

          {greenLoading ? (
            <div className="grid grid-cols-2 gap-3 px-5 py-6">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="h-16 rounded-2xl shimmer-bg" />
              ))}
            </div>
          ) : !greenStats || greenStats.total_invoices === 0 ? (
            <div className="px-5 py-14 text-center">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-3xl bg-emerald-50">
                <Leaf className="h-7 w-7 text-emerald-300" />
              </div>
              <p className="text-sm font-semibold text-slate-700">No Green KPI data yet</p>
              <p className="mt-2 text-sm text-slate-500">
                Process invoices to start tracking spend, GST compliance, and sustainability tags.
              </p>
            </div>
          ) : (
            <div className="space-y-5 px-5 py-5">
              <div className="grid grid-cols-2 gap-3">
                {[
                  {
                    label: 'Total spend',
                    value: `$${(greenStats.total_spend_aud || 0).toLocaleString()}`,
                    Icon: DollarSign,
                    tone: 'bg-blue-50 text-blue-700',
                  },
                  {
                    label: 'GST compliance',
                    value: `${greenStats.gst_compliance_pct || 0}%`,
                    Icon: ShieldCheck,
                    tone: 'bg-emerald-50 text-emerald-700',
                  },
                ].map(({ label, value, Icon, tone }) => (
                  <div key={label} className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                    <div className={`mb-2 inline-flex rounded-xl p-2 ${tone}`}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <p className="text-lg font-bold text-slate-900">{value}</p>
                    <p className="text-[11px] text-slate-500">{label}</p>
                  </div>
                ))}
              </div>

              <div>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  GST compliance
                </p>
                <KpiDoughnutChart
                  data={gstDoughnutData}
                  height={210}
                  loading={greenLoading}
                  title={`${greenStats.gst_compliance_pct ?? 0}%`}
                  subtitle="GST OK"
                />
              </div>

              {greenStats.top_sustainability_tags?.length > 0 && (
                <div>
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Top sustainability tags
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {greenStats.top_sustainability_tags.slice(0, 5).map(([tag, count]) => (
                      <div key={tag} className="flex items-center gap-1.5">
                        <KpiChip type={tag} />
                        <span className="text-[11px] text-slate-500">×{count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-4">
                <KpiChip
                  type={(greenStats.gst_compliance_pct ?? 0) >= 90 ? 'gst_ok' : 'gst_issue'}
                />
                {(greenStats.qbcc_detected ?? 0) > 0 && <KpiChip type="qbcc_missing" />}
                {(greenStats.retention_detected ?? 0) > 0 && <KpiChip type="retention_clause" />}
              </div>
            </div>
          )}
        </article>
      </section>

      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-blue-50">
              <FileText className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Recent invoices</h2>
              <p className="text-xs text-slate-500">Latest uploaded and processed files</p>
            </div>
          </div>

          <Link
            to="/invoices"
            className="inline-flex items-center gap-1 text-sm font-medium text-blue-700 transition hover:text-blue-800"
          >
            View all
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>

        {recentInvoices.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-3xl bg-blue-50">
              <FileText className="h-8 w-8 text-blue-300" />
            </div>
            <p className="text-base font-semibold text-slate-800">No invoices yet</p>
            <p className="mt-2 text-sm text-slate-500">
              Upload your first invoice to get started.
            </p>
            <Link
              to="/upload"
              className="mt-6 inline-flex items-center gap-2 rounded-2xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-blue-700 hover:shadow-lg"
            >
              <Upload className="h-4 w-4" />
              Upload invoice
            </Link>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {recentInvoices.map((invoice) => (
              <li key={invoice.id}>
                <Link
                  to={`/invoices/${invoice.id}`}
                  className="group flex flex-col gap-4 px-5 py-4 transition hover:bg-slate-50 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="relative flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl bg-slate-100 transition group-hover:bg-blue-100">
                      <FileText className="h-5 w-5 text-slate-500 group-hover:text-blue-600" />
                      <span
                        className={`absolute right-1 top-1 h-2.5 w-2.5 rounded-full border-2 border-white ${getStatusDot(invoice.status)}`}
                      />
                    </div>

                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900 group-hover:text-blue-700">
                        {invoice.original_filename}
                      </p>
                      <p className="mt-1 truncate text-xs text-slate-500">
                        {invoice.vendor_name && (
                          <span className="font-medium text-indigo-600">
                            {invoice.vendor_name} ·{' '}
                          </span>
                        )}
                        {new Date(invoice.created_at).toLocaleDateString()}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <StatusPill status={invoice.status} />
                    <ArrowRight className="h-4 w-4 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-slate-500" />
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