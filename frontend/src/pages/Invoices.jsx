import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import axios from 'axios'
import { supabase } from '../lib/supabase'
import {
  FileText,
  Search,
  Eye,
  Trash2,
  RefreshCw,
  Upload,
  Folder,
  FolderOpen,
  FolderPlus,
  X,
} from 'lucide-react'

export default function Invoices() {
  const [invoices, setInvoices] = useState([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')

  const [folders, setFolders] = useState([])
  const [selectedFolderId, setSelectedFolderId] = useState(null)
  const [newFolderName, setNewFolderName] = useState('')
  const [showNewFolder, setShowNewFolder] = useState(false)

  useEffect(() => {
    axios.get('/api/folders').then(res => setFolders(res.data.folders)).catch(() => {})
  }, [])

  useEffect(() => {
    fetchInvoices()
  }, [statusFilter, selectedFolderId])

  const fetchInvoices = async () => {
    setLoading(true)
    try {
      let query = supabase
        .from('invoices')
        .select('*')
        .order('created_at', { ascending: false })

      if (statusFilter !== 'all') {
        query = query.eq('status', statusFilter)
      }
      if (selectedFolderId === 'none') {
        query = query.is('folder_id', null)
      } else if (selectedFolderId) {
        query = query.eq('folder_id', selectedFolderId)
      }

      const { data, error } = await query

      if (error) throw error
      setInvoices(data || [])
    } catch (error) {
      console.error('Error fetching invoices:', error)
    } finally {
      setLoading(false)
    }
  }

  const deleteInvoice = async (id) => {
    if (!confirm('Are you sure you want to delete this invoice?')) return

    try {
      const { error } = await supabase
        .from('invoices')
        .delete()
        .eq('id', id)

      if (error) throw error
      setInvoices(prev => prev.filter(inv => inv.id !== id))
    } catch (error) {
      console.error('Error deleting invoice:', error)
      alert('Failed to delete invoice')
    }
  }

  const [processingIds, setProcessingIds] = useState(new Set())
  const [notification, setNotification] = useState(null)

  const showNotification = (msg, type = 'success') => {
    setNotification({ msg, type })
    setTimeout(() => setNotification(null), 4000)
  }

  const processInvoice = async (id) => {
    setProcessingIds(prev => new Set(prev).add(id))
    try {
      await axios.post('/api/processing/process', { invoice_id: id })
      showNotification('Processing started! Refresh to see progress.')
      fetchInvoices()
    } catch (error) {
      const detail = error.response?.data?.detail || 'Failed to start processing'
      showNotification(detail, 'error')
    } finally {
      setProcessingIds(prev => { const s = new Set(prev); s.delete(id); return s })
    }
  }

  const createFolder = async () => {
    if (!newFolderName.trim()) return
    try {
      const res = await axios.post('/api/folders', { name: newFolderName.trim() })
      setFolders(prev => [...prev, res.data].sort((a, b) => a.name.localeCompare(b.name)))
      setNewFolderName('')
      setShowNewFolder(false)
    } catch {
      alert('Failed to create folder')
    }
  }

  const deleteFolder = async (folderId) => {
    if (!confirm('Delete this folder? Invoices inside will become unassigned.')) return
    try {
      await axios.delete(`/api/folders/${folderId}`)
      setFolders(prev => prev.filter(f => f.id !== folderId))
      if (selectedFolderId === folderId) setSelectedFolderId(null)
    } catch {
      alert('Failed to delete folder')
    }
  }

  const getStatusBadge = (status) => {
    const styles = {
      uploaded: 'bg-gray-100 text-gray-700',
      preprocessing: 'bg-yellow-100 text-yellow-700',
      preprocessed: 'bg-blue-100 text-blue-700',
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

  const filteredInvoices = invoices.filter(inv =>
    inv.original_filename.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const statusOptions = [
    { value: 'all', label: 'All Status' },
    { value: 'uploaded', label: 'Uploaded' },
    { value: 'preprocessing', label: 'Preprocessing' },
    { value: 'ocr_complete', label: 'OCR Complete' },
    { value: 'extraction_complete', label: 'Extracted' },
    { value: 'validated', label: 'Validated' },
    { value: 'failed', label: 'Failed' },
  ]

  return (
    <div className="space-y-6">
      {/* Notification */}
      {notification && (
        <div className={`px-4 py-3 rounded-lg text-sm font-medium ${notification.type === 'error' ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-green-50 text-green-700 border border-green-200'}`}>
          {notification.msg}
        </div>
      )}

      <div className="flex gap-6 items-start">
        {/* Folder sidebar */}
        <aside className="w-52 flex-shrink-0 bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Folders</h2>
            <button
              onClick={() => setShowNewFolder(true)}
              title="New folder"
              className="p-1 text-gray-400 hover:text-blue-600 rounded transition-colors"
            >
              <FolderPlus className="w-4 h-4" />
            </button>
          </div>

          {showNewFolder && (
            <div className="px-3 py-2 border-b border-gray-100 flex gap-1">
              <input
                autoFocus
                value={newFolderName}
                onChange={e => setNewFolderName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') createFolder()
                  if (e.key === 'Escape') { setShowNewFolder(false); setNewFolderName('') }
                }}
                placeholder="Folder name"
                className="flex-1 text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 outline-none"
              />
              <button onClick={createFolder} className="px-2 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700">Add</button>
            </div>
          )}

          <nav className="py-1">
            <button
              onClick={() => setSelectedFolderId(null)}
              className={`w-full flex items-center gap-2 px-4 py-2 text-sm text-left transition-colors ${selectedFolderId === null ? 'bg-blue-50 text-blue-600 font-medium' : 'text-gray-700 hover:bg-gray-50'}`}
            >
              <FolderOpen className="w-4 h-4 flex-shrink-0" />
              All Invoices
            </button>

            {folders.map(folder => (
              <div
                key={folder.id}
                onClick={() => setSelectedFolderId(folder.id)}
                className={`group flex items-center gap-2 px-4 py-2 text-sm cursor-pointer transition-colors ${selectedFolderId === folder.id ? 'bg-blue-50 text-blue-600 font-medium' : 'text-gray-700 hover:bg-gray-50'}`}
              >
                <Folder className="w-4 h-4 flex-shrink-0" />
                <span className="flex-1 truncate">{folder.name}</span>
                <button
                  onClick={e => { e.stopPropagation(); deleteFolder(folder.id) }}
                  className="opacity-0 group-hover:opacity-100 p-0.5 text-gray-400 hover:text-red-500 transition-all"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}

            {folders.length === 0 && !showNewFolder && (
              <p className="px-4 py-3 text-xs text-gray-400 italic">No folders yet</p>
            )}
          </nav>
        </aside>

        {/* Main content */}
        <div className="flex-1 min-w-0 space-y-4">
          {/* Active folder breadcrumb */}
          {selectedFolderId && selectedFolderId !== 'none' && (
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <Folder className="w-4 h-4 text-blue-500" />
              <span className="font-medium">{folders.find(f => f.id === selectedFolderId)?.name}</span>
              <button onClick={() => setSelectedFolderId(null)} className="ml-1 text-gray-400 hover:text-gray-700">
                <X className="w-3 h-3" />
              </button>
            </div>
          )}

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input
            type="text"
            placeholder="Search invoices..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
        >
          {statusOptions.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        <button
          onClick={fetchInvoices}
          className="flex items-center gap-2 px-4 py-2.5 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          </div>
        ) : filteredInvoices.length === 0 ? (
          <div className="text-center py-12">
            <FileText className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500 mb-4">
              {searchQuery ? 'No invoices match your search' : 'No invoices yet'}
            </p>
            <Link
              to="/upload"
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors"
            >
              <Upload className="w-4 h-4" />
              Upload Invoice
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Filename
                  </th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Vendor
                  </th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Size
                  </th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Uploaded
                  </th>
                  <th className="text-right px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {filteredInvoices.map((invoice) => (
                  <tr key={invoice.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-gray-100 rounded-lg">
                          <FileText className="w-5 h-5 text-gray-600" />
                        </div>
                        <div>
                          <Link
                            to={`/invoices/${invoice.id}`}
                            className="font-medium text-gray-900 hover:text-blue-600 transition-colors"
                          >
                            {invoice.original_filename}
                          </Link>
                          <p className="text-sm text-gray-500">
                            {invoice.file_type?.toUpperCase()}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-700">
                      {invoice.vendor_name || <span className="text-gray-400">—</span>}
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex px-3 py-1 rounded-full text-xs font-medium ${getStatusBadge(invoice.status)}`}>
                        {invoice.status.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500">
                      {invoice.file_size_bytes 
                        ? `${(invoice.file_size_bytes / 1024 / 1024).toFixed(2)} MB`
                        : '-'
                      }
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500">
                      {new Date(invoice.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Link
                          to={`/invoices/${invoice.id}`}
                          className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg transition-colors"
                          title="View Details"
                        >
                          <Eye className="w-4 h-4" />
                        </Link>
                        {['uploaded', 'failed'].includes(invoice.status) && (
                          <button
                            onClick={() => processInvoice(invoice.id)}
                            disabled={processingIds.has(invoice.id)}
                            className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors disabled:opacity-50"
                            title="Process Invoice"
                          >
                            <RefreshCw className={`w-4 h-4 ${processingIds.has(invoice.id) ? 'animate-spin' : ''}`} />
                          </button>
                        )}
                        <button
                          onClick={() => deleteInvoice(invoice.id)}
                          className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                          title="Delete"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
        </div>{/* end main content */}
      </div>{/* end flex row */}
    </div>
  )
}
