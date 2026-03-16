import { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useDropzone } from 'react-dropzone'
import { supabase } from '../lib/supabase'
import {
  Upload as UploadIcon,
  FileText,
  X,
  CheckCircle,
  AlertCircle,
  Loader,
  Star,
} from 'lucide-react'

export default function Upload() {
  const navigate    = useNavigate()
  const [files, setFiles]               = useState([])
  const [uploading, setUploading]       = useState(false)
  const [uploadStatus, setUploadStatus] = useState({})
  const [uploadErrors, setUploadErrors] = useState({})
  const [uploadProgress, setUploadProgress] = useState({}) // 0-100

  const onDrop = useCallback((acceptedFiles) => {
    const newFiles = acceptedFiles.map(file => ({
      file,
      id:      Math.random().toString(36).substring(7),
      preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
    }))
    setFiles(prev => [...prev, ...newFiles])
  }, [])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/pdf': ['.pdf'],
      'image/*':         ['.png', '.jpg', '.jpeg', '.tiff', '.tif'],
    },
    maxSize: 10 * 1024 * 1024,
  })

  const removeFile = (id) => {
    setFiles(prev => prev.filter(f => f.id !== id))
    setUploadStatus(prev => { const s = { ...prev }; delete s[id]; return s })
    setUploadProgress(prev => { const s = { ...prev }; delete s[id]; return s })
  }

  const uploadFiles = async () => {
    if (files.length === 0) return
    setUploading(true)
    setUploadErrors({})

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      alert('Please log in to upload files')
      setUploading(false)
      return
    }

    const { data: orgMembers } = await supabase
      .from('organization_members')
      .select('organization_id')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .limit(1)

    const organizationId = orgMembers?.[0]?.organization_id
    let successCount = 0

    for (const fileItem of files) {
      setUploadStatus(prev   => ({ ...prev,   [fileItem.id]: 'uploading' }))
      setUploadProgress(prev => ({ ...prev,   [fileItem.id]: 10 }))

      try {
        const fileExt  = fileItem.file.name.split('.').pop()
        const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`
        const filePath = organizationId ? `${organizationId}/${fileName}` : `${user.id}/${fileName}`

        setUploadProgress(prev => ({ ...prev, [fileItem.id]: 40 }))

        const { error: uploadError } = await supabase.storage
          .from('invoices-raw')
          .upload(filePath, fileItem.file)

        if (uploadError) throw uploadError

        setUploadProgress(prev => ({ ...prev, [fileItem.id]: 75 }))

        const { error: dbError } = await supabase
          .from('invoices')
          .insert({
            organization_id:   organizationId || null,
            uploaded_by:       user.id,
            original_filename: fileItem.file.name,
            file_path:         filePath,
            file_size_bytes:   fileItem.file.size,
            file_type:         fileExt,
            status:            'uploaded',
            upload_source:     'web',
          })

        if (dbError) throw dbError

        setUploadProgress(prev => ({ ...prev, [fileItem.id]: 100 }))
        setUploadStatus(prev => ({ ...prev, [fileItem.id]: 'success' }))
        successCount++
      } catch (error) {
        console.error('Upload error:', error)
        setUploadStatus(prev => ({ ...prev, [fileItem.id]: 'error' }))
        setUploadErrors(prev => ({
          ...prev,
          [fileItem.id]: error.message || 'Upload failed. Check console for details.',
        }))
        setUploadProgress(prev => ({ ...prev, [fileItem.id]: 0 }))
      }
    }

    setUploading(false)
    if (successCount === files.length) {
      setTimeout(() => navigate('/invoices'), 1600)
    }
  }

  const getStatusIcon = (status) => {
    switch (status) {
      case 'uploading': return <Loader className="w-5 h-5 text-blue-500 animate-spin" />
      case 'success':   return <CheckCircle className="w-5 h-5 text-emerald-500 animate-bounce-in" />
      case 'error':     return <AlertCircle className="w-5 h-5 text-rose-500" />
      default:          return <FileText className="w-5 h-5 text-gray-400" />
    }
  }

  const formatSize = (bytes) => {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`
  }

  const steps = [
    { icon: '🔍', label: 'Preprocess',   desc: 'Deskew & denoise' },
    { icon: '📝', label: 'OCR',          desc: 'Extract text' },
    { icon: '🤖', label: 'AI Extract',   desc: 'Identify fields' },
    { icon: '✅', label: 'Review',        desc: 'Validate results' },
  ]

  return (
    <div className="max-w-2xl mx-auto space-y-6 animate-fade-in">

      {/* ── Drop zone ─────────────────────────────────── */}
      <div
        {...getRootProps()}
        className={`
          relative border-2 border-dashed rounded-2xl p-12 text-center cursor-pointer
          transition-all duration-300 overflow-hidden group
          ${isDragActive
            ? 'border-blue-500 bg-blue-50 scale-[1.01]'
            : 'border-gray-200 hover:border-blue-300 bg-white hover:bg-blue-50/30'
          }
        `}
      >
        <input {...getInputProps()} />

        {/* Animated background ring on drag */}
        {isDragActive && (
          <div className="absolute inset-0 rounded-2xl animate-pulse-soft bg-blue-100/40 pointer-events-none" />
        )}

        <div className="flex flex-col items-center relative">
          <div className={`
            p-5 rounded-2xl mb-5 transition-all duration-300
            ${isDragActive
              ? 'bg-blue-100 scale-110'
              : 'bg-gray-100 group-hover:bg-blue-50 group-hover:scale-105'
            }
          `}>
            <UploadIcon className={`w-10 h-10 transition-colors duration-300 ${isDragActive ? 'text-blue-600' : 'text-gray-400 group-hover:text-blue-400'}`} />
          </div>

          <p className={`text-lg font-semibold mb-1 transition-colors duration-200 ${isDragActive ? 'text-blue-700' : 'text-gray-800'}`}>
            {isDragActive ? '✨ Release to drop your files!' : 'Drag & drop invoices here'}
          </p>
          <p className="text-sm text-gray-400 mb-5">or click to browse your files</p>

          <div className="flex items-center gap-2 text-xs text-gray-400 bg-gray-50 px-4 py-2 rounded-full border border-gray-200">
            <span className="font-medium">Supports:</span>
            <span>PDF · PNG · JPG · TIFF</span>
            <span className="text-gray-300">|</span>
            <span>Max 10 MB</span>
          </div>
        </div>
      </div>

      {/* ── File list ─────────────────────────────────── */}
      {files.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm animate-slide-up">
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gray-50/50">
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-blue-500" />
              <h3 className="font-semibold text-gray-900 text-sm">
                Selected Files
              </h3>
              <span className="px-2 py-0.5 bg-blue-100 text-blue-600 text-xs font-bold rounded-full">
                {files.length}
              </span>
            </div>
          </div>

          <div className="divide-y divide-gray-100">
            {files.map((fileItem, i) => {
              const status   = uploadStatus[fileItem.id]
              const progress = uploadProgress[fileItem.id] || 0
              return (
                <div
                  key={fileItem.id}
                  style={{ animationDelay: `${i * 60}ms` }}
                  className="animate-slide-in-left flex items-center gap-4 px-6 py-4 hover:bg-gray-50/60 transition-colors"
                >
                  {/* Thumbnail / icon */}
                  {fileItem.preview ? (
                    <img src={fileItem.preview} alt="" className="w-12 h-12 object-cover rounded-xl shadow-sm flex-shrink-0" />
                  ) : (
                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 transition-colors duration-300 ${status === 'success' ? 'bg-emerald-50' : status === 'error' ? 'bg-rose-50' : 'bg-gray-100'}`}>
                      <FileText className={`w-6 h-6 ${status === 'success' ? 'text-emerald-400' : status === 'error' ? 'text-rose-400' : 'text-gray-400'}`} />
                    </div>
                  )}

                  {/* Info + progress */}
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-900 text-sm truncate">{fileItem.file.name}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{formatSize(fileItem.file.size)}</p>

                    {/* Progress bar */}
                    {status === 'uploading' && (
                      <div className="mt-2 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-blue-500 to-indigo-500 rounded-full transition-all duration-500"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                    )}
                    {status === 'success' && (
                      <div className="mt-1.5 h-1.5 bg-emerald-100 rounded-full overflow-hidden">
                        <div className="h-full w-full bg-emerald-400 rounded-full" />
                      </div>
                    )}
                    {uploadErrors[fileItem.id] && (
                      <p className="text-xs text-rose-500 mt-1">{uploadErrors[fileItem.id]}</p>
                    )}
                  </div>

                  {/* Status icon + remove */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {getStatusIcon(status)}
                    {!uploading && !status && (
                      <button
                        onClick={() => removeFile(fileItem.id)}
                        className="p-1.5 hover:bg-red-50 rounded-lg transition-colors group/del"
                      >
                        <X className="w-4 h-4 text-gray-300 group-hover/del:text-rose-500 transition-colors" />
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Upload button */}
          <div className="px-6 py-4 bg-gray-50/60 border-t border-gray-100">
            <button
              onClick={uploadFiles}
              disabled={uploading || files.length === 0}
              className={`
                w-full flex items-center justify-center gap-2.5 px-4 py-3 rounded-xl
                font-semibold text-sm transition-all duration-200
                ${uploading
                  ? 'bg-blue-400 text-white cursor-wait'
                  : 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white hover:from-blue-700 hover:to-indigo-700 shadow-md hover:shadow-lg hover:-translate-y-0.5 active:translate-y-0'
                }
                disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none
              `}
            >
              {uploading ? (
                <>
                  <Loader className="w-5 h-5 animate-spin" />
                  Uploading {files.length} {files.length === 1 ? 'file' : 'files'}…
                </>
              ) : (
                <>
                  <UploadIcon className="w-5 h-5" />
                  Upload {files.length} {files.length === 1 ? 'file' : 'files'}
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* ── Processing steps card ─────────────────────── */}
      <div className="bg-gradient-to-br from-slate-50 to-blue-50/50 border border-blue-100 rounded-2xl p-6 animate-slide-up" style={{ animationDelay: '0.15s' }}>
        <div className="flex items-center gap-2 mb-4">
          <Star className="w-4 h-4 text-blue-500" />
          <h4 className="font-semibold text-gray-800 text-sm">What happens after upload?</h4>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {steps.map((step, i) => (
            <div
              key={i}
              style={{ animationDelay: `${0.2 + i * 0.07}s` }}
              className="animate-slide-up flex flex-col items-center text-center p-3 bg-white rounded-xl border border-gray-100 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200"
            >
              <span className="text-2xl mb-1.5">{step.icon}</span>
              <p className="text-xs font-semibold text-gray-700">{step.label}</p>
              <p className="text-[10px] text-gray-400 mt-0.5">{step.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
