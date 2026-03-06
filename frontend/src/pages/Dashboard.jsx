import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { 
  FileText, 
  Upload, 
  CheckCircle, 
  Clock, 
  AlertTriangle,
  ArrowRight,
  TrendingUp
} from 'lucide-react'

export default function Dashboard() {
  const [stats, setStats] = useState({
    total: 0,
    processing: 0,
    completed: 0,
    failed: 0,
  })
  const [recentInvoices, setRecentInvoices] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchDashboardData()
  }, [])

  const fetchDashboardData = async () => {
    try {
      // Fetch invoice counts
      const { data: invoices, error } = await supabase
        .from('invoices')
        .select('id, status, original_filename, created_at')
        .order('created_at', { ascending: false })
        .limit(5)

      if (error) throw error

      // Calculate stats
      const { data: allInvoices } = await supabase
        .from('invoices')
        .select('status')

      if (allInvoices) {
        setStats({
          total: allInvoices.length,
          processing: allInvoices.filter(i => 
            ['preprocessing', 'ocr_processing', 'extraction_processing'].includes(i.status)
          ).length,
          completed: allInvoices.filter(i => 
            ['validated', 'exported'].includes(i.status)
          ).length,
          failed: allInvoices.filter(i => i.status === 'failed').length,
        })
      }

      setRecentInvoices(invoices || [])
    } catch (error) {
      console.error('Error fetching dashboard data:', error)
    } finally {
      setLoading(false)
    }
  }

  const statCards = [
    { 
      title: 'Total Invoices', 
      value: stats.total, 
      icon: FileText, 
      color: 'bg-blue-500',
      bgColor: 'bg-blue-50'
    },
    { 
      title: 'Processing', 
      value: stats.processing, 
      icon: Clock, 
      color: 'bg-yellow-500',
      bgColor: 'bg-yellow-50'
    },
    { 
      title: 'Completed', 
      value: stats.completed, 
      icon: CheckCircle, 
      color: 'bg-green-500',
      bgColor: 'bg-green-50'
    },
    { 
      title: 'Failed', 
      value: stats.failed, 
      icon: AlertTriangle, 
      color: 'bg-red-500',
      bgColor: 'bg-red-50'
    },
  ]

  const getStatusBadge = (status) => {
    const styles = {
      uploaded: 'bg-gray-100 text-gray-700',
      preprocessing: 'bg-yellow-100 text-yellow-700',
      ocr_processing: 'bg-yellow-100 text-yellow-700',
      ocr_complete: 'bg-blue-100 text-blue-700',
      extraction_processing: 'bg-yellow-100 text-yellow-700',
      extraction_complete: 'bg-blue-100 text-blue-700',
      validated: 'bg-green-100 text-green-700',
      exported: 'bg-green-100 text-green-700',
      failed: 'bg-red-100 text-red-700',
    }
    return styles[status] || 'bg-gray-100 text-gray-700'
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {/* Welcome message */}
      <div className="bg-gradient-to-r from-blue-600 to-indigo-600 rounded-2xl p-6 text-white">
        <h2 className="text-2xl font-bold mb-2">Welcome to Invoice Processing</h2>
        <p className="text-blue-100 mb-4">
          Upload invoices and let AI extract the data automatically.
        </p>
        <Link
          to="/upload"
          className="inline-flex items-center gap-2 px-4 py-2 bg-white text-blue-600 rounded-lg font-medium hover:bg-blue-50 transition-colors"
        >
          <Upload className="w-4 h-4" />
          Upload Invoice
        </Link>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((stat) => (
          <div key={stat.title} className="bg-white rounded-xl p-6 border border-gray-200">
            <div className="flex items-center gap-4">
              <div className={`p-3 rounded-lg ${stat.bgColor}`}>
                <stat.icon className={`w-6 h-6 ${stat.color.replace('bg-', 'text-')}`} />
              </div>
              <div>
                <p className="text-sm text-gray-500">{stat.title}</p>
                <p className="text-2xl font-bold text-gray-900">{stat.value}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Recent invoices */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900">Recent Invoices</h3>
          <Link 
            to="/invoices"
            className="text-sm text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1"
          >
            View all
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
        
        {recentInvoices.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <FileText className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500 mb-4">No invoices yet</p>
            <Link
              to="/upload"
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors"
            >
              <Upload className="w-4 h-4" />
              Upload your first invoice
            </Link>
          </div>
        ) : (
          <div className="divide-y divide-gray-200">
            {recentInvoices.map((invoice) => (
              <div key={invoice.id} className="flex items-center justify-between px-6 py-4 hover:bg-gray-50">
                <div className="flex items-center gap-4">
                  <div className="p-2 bg-gray-100 rounded-lg">
                    <FileText className="w-5 h-5 text-gray-600" />
                  </div>
                  <div>
                    <p className="font-medium text-gray-900">{invoice.original_filename}</p>
                    <p className="text-sm text-gray-500">
                      {new Date(invoice.created_at).toLocaleDateString()}
                    </p>
                  </div>
                </div>
                <span className={`px-3 py-1 rounded-full text-xs font-medium ${getStatusBadge(invoice.status)}`}>
                  {invoice.status.replace('_', ' ')}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
