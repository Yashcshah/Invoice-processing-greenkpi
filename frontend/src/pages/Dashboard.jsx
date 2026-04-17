import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import axios from 'axios'
import {
  FileText,
  Upload,
  CheckCircle,
  Clock,
  AlertTriangle,
  ArrowRight,
  Star,
  TrendingUp,
  Brain,
  RefreshCw,
  Layers,
  Zap,
  Leaf,
  ShieldCheck,
  DollarSign,
  BarChart2,
} from 'lucide-react'

export default function Dashboard() {
  const [stats, setStats] = useState({ total: 0, processing: 0, completed: 0, failed: 0 })
  const [displayStats, setDisplayStats] = useState({ total: 0, processing: 0, completed: 0, failed: 0 })
  const [recentInvoices, setRecentInvoices] = useState([])
  const [loading, setLoading] = useState(true)
  const [mlStats, setMlStats] = useState(null)
  const [retraining, setRetraining] = useState(false)
  const [greenStats, setGreenStats] = useState(null)

  const animateCountUp = (to, key, duration = 650) => {
    const startTime = performance.now()
    const step = (now) => {
      const progress = Math.min((now - startTime) / duration, 1)
      const eased    = 1 - Math.pow(1 - progress, 3)
      setDisplayStats(prev => ({ ...prev, [key]: Math.round(to * eased) }))
      if (progress < 1) requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  }

  useEffect(() => { fetchDashboardData(); fetchMlStats(); fetchGreenStats() }, [])

  const fetchGreenStats = async () => {
    try {
      const { data } = await axios.get('/api/green-kpi/stats')
      setGreenStats(data)
    } catch {
      // backend may not be running or schema not applied yet
    }
  }

  const fetchMlStats = async () => {
    try {
      const { data } = await axios.get('/api/learning/stats')
      setMlStats(data)
    } catch {
      // backend may not be running — silently skip
    }
  }

  const handleRetrain = async () => {
    setRetraining(true)
    try {
      await axios.post('/api/learning/retrain')
      // poll once after a short delay so stats refresh
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
          total:      allInvoices.length,
          processing: allInvoices.filter(i =>
            ['preprocessing', 'ocr_processing', 'extraction_processing'].includes(i.status)
          ).length,
          completed:  allInvoices.filter(i =>
            ['validated', 'exported', 'extraction_complete'].includes(i.status)
          ).length,
          failed:     allInvoices.filter(i => i.status === 'failed').length,
        }
        setStats(newStats)
        animateCountUp(newStats.total,      'total')
        animateCountUp(newStats.processing, 'processing')
        animateCountUp(newStats.completed,  'completed')
        animateCountUp(newStats.failed,     'failed')
      }

      setRecentInvoices(invoices || [])
    } catch (error) {
      console.error('Error fetching dashboard data:', error)
    } finally {
      setLoading(false)
    }
  }

  const statCards = [
    { title: 'Total Invoices', key: 'total',      icon: FileText,       gradient: 'from-blue-500 to-blue-600',    shadow: 'shadow-blue-200',    bg: 'bg-blue-50',   text: 'text-blue-600' },
    { title: 'Processing',     key: 'processing', icon: Clock,          gradient: 'from-amber-400 to-orange-500', shadow: 'shadow-amber-200',   bg: 'bg-amber-50',  text: 'text-amber-600' },
    { title: 'Completed',      key: 'completed',  icon: CheckCircle,    gradient: 'from-emerald-400 to-green-500',shadow: 'shadow-emerald-200', bg: 'bg-emerald-50',text: 'text-emerald-600' },
    { title: 'Failed',         key: 'failed',     icon: AlertTriangle,  gradient: 'from-rose-400 to-red-500',     shadow: 'shadow-rose-200',    bg: 'bg-rose-50',   text: 'text-rose-600' },
  ]

  const getStatusBadge = (status) => {
    const styles = {
      uploaded:              'bg-gray-100 text-gray-600',
      preprocessing:         'bg-amber-100 text-amber-700',
      preprocessed:          'bg-blue-100 text-blue-700',
      ocr_processing:        'bg-amber-100 text-amber-700',
      ocr_complete:          'bg-blue-100 text-blue-700',
      extraction_processing: 'bg-amber-100 text-amber-700',
      extraction_complete:   'bg-indigo-100 text-indigo-700',
      validated:             'bg-emerald-100 text-emerald-700',
      exported:              'bg-emerald-100 text-emerald-700',
      failed:                'bg-rose-100 text-rose-700',
    }
    return styles[status] || 'bg-gray-100 text-gray-600'
  }

  const getStatusDot = (status) => {
    if (['preprocessing','ocr_processing','extraction_processing'].includes(status))
      return 'bg-amber-400 animate-pulse'
    if (['validated','exported','extraction_complete'].includes(status))
      return 'bg-emerald-400'
    if (status === 'failed') return 'bg-rose-400'
    return 'bg-gray-300'
  }

  if (loading) {
    return (
      <div className="space-y-8">
        {/* Skeleton banner */}
        <div className="h-40 rounded-2xl shimmer-bg" />
        {/* Skeleton cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-28 rounded-xl shimmer-bg" />
          ))}
        </div>
        {/* Skeleton table */}
        <div className="h-64 rounded-xl shimmer-bg" />
      </div>
    )
  }

  return (
    <div className="space-y-8">

      {/* ── Welcome banner ─────────────────────────────── */}
      <div className="relative overflow-hidden bg-gradient-to-br from-blue-600 via-blue-700 to-indigo-700 rounded-2xl p-8 text-white animate-slide-up shadow-xl shadow-blue-200">
        {/* Decorative blobs */}
        <div className="absolute -top-10 -right-10 w-48 h-48 bg-white/10 rounded-full blur-2xl pointer-events-none" />
        <div className="absolute bottom-0 left-1/2 w-32 h-32 bg-indigo-400/20 rounded-full blur-2xl pointer-events-none" />

        <div className="relative flex flex-col sm:flex-row items-start sm:items-center gap-6">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <Star className="w-5 h-5 text-blue-200 animate-float" />
              <span className="text-blue-200 text-sm font-medium uppercase tracking-widest">AI-Powered</span>
            </div>
            <h2 className="text-2xl font-bold mb-1">Invoice Processing</h2>
            <p className="text-blue-100 text-sm max-w-md">
              Upload invoices and let the AI extract vendor names, line items, and totals automatically.
            </p>
          </div>
          <Link
            to="/upload"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-white text-blue-700 rounded-xl font-semibold text-sm hover:bg-blue-50 transition-all duration-200 shadow-lg hover:shadow-xl hover:-translate-y-0.5 flex-shrink-0"
          >
            <Upload className="w-4 h-4" />
            Upload Invoice
          </Link>
        </div>

        {/* Stats strip */}
        <div className="relative mt-6 pt-5 border-t border-white/20 grid grid-cols-3 gap-4">
          {[
            { label: 'Total uploaded', value: displayStats.total },
            { label: 'In progress',    value: displayStats.processing },
            { label: 'Completed',      value: displayStats.completed },
          ].map((s, i) => (
            <div key={i} className="text-center">
              <p className="text-xl font-bold text-white">{s.value}</p>
              <p className="text-xs text-blue-200">{s.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── Stat cards ─────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((stat, i) => (
          <div
            key={stat.title}
            style={{ animationDelay: `${i * 80}ms` }}
            className="animate-slide-up card-hover bg-white rounded-xl p-5 border border-gray-200 flex items-center gap-4"
          >
            <div className={`p-3 rounded-xl bg-gradient-to-br ${stat.gradient} shadow-lg ${stat.shadow} flex-shrink-0`}>
              <stat.icon className="w-6 h-6 text-white" />
            </div>
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">{stat.title}</p>
              <p className="text-3xl font-bold text-gray-900 leading-tight">{displayStats[stat.key]}</p>
            </div>
          </div>
        ))}
      </div>

      {/* ── ML Agents panel ───────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden animate-slide-up" style={{ animationDelay: '0.2s' }}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <Brain className="w-4 h-4 text-violet-500" />
            <h3 className="text-base font-semibold text-gray-900">ML Cluster Agents</h3>
            {mlStats?.is_trained && (
              <span className="px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 text-xs font-medium">Active</span>
            )}
          </div>
          <button
            onClick={handleRetrain}
            disabled={retraining}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-violet-600 border border-violet-200 rounded-lg hover:bg-violet-50 disabled:opacity-50 transition-all duration-200"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${retraining ? 'animate-spin' : ''}`} />
            {retraining ? 'Training…' : 'Retrain'}
          </button>
        </div>

        {!mlStats ? (
          <div className="px-6 py-8 text-center">
            <div className="h-4 w-48 mx-auto rounded shimmer-bg mb-3" />
            <div className="h-4 w-32 mx-auto rounded shimmer-bg" />
          </div>
        ) : !mlStats.is_trained || mlStats.total_clusters === 0 ? (
          <div className="px-6 py-10 text-center animate-fade-in">
            <div className="w-14 h-14 rounded-2xl bg-violet-50 flex items-center justify-center mx-auto mb-3">
              <Brain className="w-7 h-7 text-violet-300 animate-float" />
            </div>
            <p className="text-gray-500 font-medium mb-1">No clusters yet</p>
            <p className="text-sm text-gray-400 mb-4">
              Process at least 2 invoices, then click <span className="font-semibold text-violet-600">Retrain</span> to build the first agents.
            </p>
          </div>
        ) : (
          <div>
            {/* Summary strip */}
            <div className="grid grid-cols-3 divide-x divide-gray-100 border-b border-gray-100">
              {[
                { label: 'Clusters', value: mlStats.total_clusters, icon: Layers, color: 'text-violet-600' },
                { label: 'Avg accuracy', value: `${mlStats.avg_accuracy}%`, icon: Zap, color: 'text-emerald-600' },
                { label: 'Corrections learned', value: mlStats.total_corrections, icon: CheckCircle, color: 'text-blue-600' },
              ].map((s, i) => (
                <div key={i} className="flex items-center gap-3 px-6 py-4">
                  <s.icon className={`w-5 h-5 ${s.color} flex-shrink-0`} />
                  <div>
                    <p className="text-lg font-bold text-gray-900">{s.value}</p>
                    <p className="text-xs text-gray-400">{s.label}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* Per-cluster rows */}
            <div className="divide-y divide-gray-50">
              {mlStats.agents.slice(0, 5).map((agent, i) => (
                <div
                  key={agent.cluster_id}
                  style={{ animationDelay: `${i * 50}ms` }}
                  className="animate-slide-in-left flex items-center justify-between px-6 py-3"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-violet-50 flex items-center justify-center flex-shrink-0">
                      <span className="text-xs font-bold text-violet-600">#{agent.cluster_id}</span>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-800">
                        {agent.cluster_label || `Cluster ${agent.cluster_id}`}
                      </p>
                      <p className="text-xs text-gray-400">
                        {agent.invoice_count} invoice{agent.invoice_count !== 1 ? 's' : ''} · {agent.correction_count} correction{agent.correction_count !== 1 ? 's' : ''} learned
                      </p>
                    </div>
                  </div>
                  {/* Accuracy bar */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <div className="w-20 h-1.5 rounded-full bg-gray-100 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-emerald-400 transition-all duration-700"
                        style={{ width: `${agent.accuracy_score}%` }}
                      />
                    </div>
                    <span className="text-xs font-semibold text-gray-600 w-10 text-right">
                      {agent.accuracy_score}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Green KPI panel ───────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden animate-slide-up" style={{ animationDelay: '0.25s' }}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <Leaf className="w-4 h-4 text-emerald-500" />
            <h3 className="text-base font-semibold text-gray-900">Green KPI</h3>
            {greenStats?.total_invoices > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-xs font-medium">
                {greenStats.total_invoices} processed
              </span>
            )}
          </div>
          <Link to="/invoices" className="text-sm text-emerald-600 hover:text-emerald-700 font-medium flex items-center gap-1 group">
            View all
            <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform duration-200" />
          </Link>
        </div>

        {!greenStats ? (
          <div className="px-6 py-8">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[...Array(4)].map((_, i) => <div key={i} className="h-16 rounded-lg shimmer-bg" />)}
            </div>
          </div>
        ) : greenStats.total_invoices === 0 ? (
          <div className="px-6 py-10 text-center animate-fade-in">
            <div className="w-14 h-14 rounded-2xl bg-emerald-50 flex items-center justify-center mx-auto mb-3">
              <Leaf className="w-7 h-7 text-emerald-300 animate-float" />
            </div>
            <p className="text-gray-500 font-medium mb-1">No Green KPI data yet</p>
            <p className="text-sm text-gray-400">
              Process invoices to start tracking sustainability, GST compliance, and spend.
            </p>
          </div>
        ) : (
          <div>
            {/* KPI metric strip */}
            <div className="grid grid-cols-2 md:grid-cols-4 divide-y md:divide-y-0 md:divide-x divide-gray-100 border-b border-gray-100">
              {[
                { label: 'Total Spend', value: `$${(greenStats.total_spend_aud || 0).toLocaleString()}`, icon: DollarSign, color: 'text-blue-600', bg: 'bg-blue-50' },
                { label: 'Avg Confidence', value: `${greenStats.avg_confidence_pct || 0}%`, icon: BarChart2, color: 'text-violet-600', bg: 'bg-violet-50' },
                { label: 'GST Compliance', value: `${greenStats.gst_compliance_pct || 0}%`, icon: ShieldCheck, color: 'text-emerald-600', bg: 'bg-emerald-50' },
                { label: 'Corrections', value: greenStats.total_corrections || 0, icon: Brain, color: 'text-amber-600', bg: 'bg-amber-50' },
              ].map((m, i) => (
                <div key={i} className="flex items-center gap-3 px-6 py-4">
                  <div className={`p-2 rounded-lg ${m.bg} flex-shrink-0`}>
                    <m.icon className={`w-4 h-4 ${m.color}`} />
                  </div>
                  <div>
                    <p className="text-lg font-bold text-gray-900">{m.value}</p>
                    <p className="text-xs text-gray-400">{m.label}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* Sustainability tags */}
            {greenStats.top_sustainability_tags?.length > 0 && (
              <div className="px-6 py-4 border-b border-gray-50">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                  Top Sustainability Tags
                </p>
                <div className="flex flex-wrap gap-2">
                  {greenStats.top_sustainability_tags.map(([tag, count]) => (
                    <span
                      key={tag}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-medium"
                    >
                      <Leaf className="w-3 h-3" />
                      {tag.replace(/_/g, ' ')}
                      <span className="text-emerald-400 font-normal">×{count}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Status breakdown */}
            <div className="px-6 py-3 flex items-center gap-4 text-xs text-gray-500">
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" />
                {greenStats.completed || 0} completed
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-amber-400 inline-block" />
                {greenStats.needs_review || 0} needs review
              </span>
              {(greenStats.failed || 0) > 0 && (
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-rose-400 inline-block" />
                  {greenStats.failed} failed
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Recent invoices ─────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden animate-slide-up" style={{ animationDelay: '0.3s' }}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-blue-500" />
            <h3 className="text-base font-semibold text-gray-900">Recent Invoices</h3>
          </div>
          <Link
            to="/invoices"
            className="text-sm text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1 group"
          >
            View all
            <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform duration-200" />
          </Link>
        </div>

        {recentInvoices.length === 0 ? (
          <div className="px-6 py-16 text-center animate-fade-in">
            <div className="w-16 h-16 rounded-2xl bg-blue-50 flex items-center justify-center mx-auto mb-4">
              <FileText className="w-8 h-8 text-blue-300 animate-float" />
            </div>
            <p className="text-gray-500 font-medium mb-1">No invoices yet</p>
            <p className="text-sm text-gray-400 mb-5">Upload your first invoice to get started</p>
            <Link
              to="/upload"
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-xl font-semibold text-sm hover:bg-blue-700 transition-all duration-200 shadow-md hover:shadow-lg hover:-translate-y-0.5"
            >
              <Upload className="w-4 h-4" />
              Upload Invoice
            </Link>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {recentInvoices.map((invoice, i) => (
              <Link
                key={invoice.id}
                to={`/invoices/${invoice.id}`}
                style={{ animationDelay: `${0.3 + i * 0.06}s` }}
                className="animate-slide-in-left flex items-center justify-between px-6 py-4 hover:bg-gray-50 transition-colors duration-150 group"
              >
                <div className="flex items-center gap-4">
                  <div className="relative p-2.5 bg-gray-100 rounded-xl group-hover:bg-blue-50 transition-colors duration-200">
                    <FileText className="w-5 h-5 text-gray-400 group-hover:text-blue-500 transition-colors duration-200" />
                    <span className={`absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white ${getStatusDot(invoice.status)}`} />
                  </div>
                  <div>
                    <p className="font-medium text-gray-900 group-hover:text-blue-600 transition-colors duration-200">
                      {invoice.original_filename}
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {invoice.vendor_name ? (
                        <span className="text-indigo-500 font-medium">{invoice.vendor_name} · </span>
                      ) : null}
                      {new Date(invoice.created_at).toLocaleDateString()}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${getStatusBadge(invoice.status)}`}>
                    {invoice.status.replace(/_/g, ' ')}
                  </span>
                  <ArrowRight className="w-4 h-4 text-gray-300 group-hover:text-gray-500 group-hover:translate-x-1 transition-all duration-200" />
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
