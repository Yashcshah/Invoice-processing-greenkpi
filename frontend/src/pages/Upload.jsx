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
  Loader
} from 'lucide-react'

export default function Upload() {
  const navigate = useNavigate()
  const [files, setFiles] = useState([])
  const [uploading, setUploading] = useState(false)
  const [uploadStatus, setUploadStatus] = useState({})
  const [uploadErrors, setUploadErrors] = useState({})

  const onDrop = useCallback((acceptedFiles) => {
    const newFiles = acceptedFiles.map(file => ({
      file,
      id: Math.random().toString(36).substring(7),
      preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
    }))
    setFiles(prev => [...prev, ...newFiles])
  }, [])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/pdf': ['.pdf'],
      'image/*': ['.png', '.jpg', '.jpeg', '.tiff', '.tif'],
    },
    maxSize: 10 * 1024 * 1024, // 10MB
  })

  const removeFile = (id) => {
    setFiles(prev => prev.filter(f => f.id !== id))
    setUploadStatus(prev => {
      const newStatus = { ...prev }
      delete newStatus[id]
      return newStatus
    })
  }

  const uploadFiles = async () => {
    if (files.length === 0) return

    setUploading(true)
    setUploadErrors({})

    // Get current user
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      alert('Please log in to upload files')
      setUploading(false)
      return
    }

    // Get user's organization (optional — upload still works without one)
    const { data: orgMembers } = await supabase
      .from('organization_members')
      .select('organization_id')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .limit(1)

    const organizationId = orgMembers?.[0]?.organization_id

    // Track success locally (not via stale state)
    let successCount = 0

    for (const fileItem of files) {
      setUploadStatus(prev => ({ ...prev, [fileItem.id]: 'uploading' }))

      try {
        // Generate unique filename
        const fileExt = fileItem.file.name.split('.').pop()
        const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`
        const filePath = organizationId
          ? `${organizationId}/${fileName}`
          : `${user.id}/${fileName}`

        // Upload to Supabase Storage
        const { error: uploadError } = await supabase.storage
          .from('invoices-raw')
          .upload(filePath, fileItem.file)

        if (uploadError) throw uploadError

        // Create invoice record in database
        const { error: dbError } = await supabase
          .from('invoices')
          .insert({
            organization_id: organizationId || null,
            uploaded_by: user.id,
            original_filename: fileItem.file.name,
            file_path: filePath,
            file_size_bytes: fileItem.file.size,
            file_type: fileExt,
            status: 'uploaded',
            upload_source: 'web',
          })

        if (dbError) throw dbError

        setUploadStatus(prev => ({ ...prev, [fileItem.id]: 'success' }))
        successCount++
      } catch (error) {
        console.error('Upload error:', error)
        setUploadStatus(prev => ({ ...prev, [fileItem.id]: 'error' }))
        setUploadErrors(prev => ({
          ...prev,
          [fileItem.id]: error.message || 'Upload failed. Check console for details.',
        }))
      }
    }

    setUploading(false)

    // Navigate only if ALL files succeeded (using local counter, not stale state)
    if (successCount === files.length) {
      setTimeout(() => navigate('/invoices'), 1500)
    }
  }

  const getFileIcon = (status) => {
    switch (status) {
      case 'uploading':
        return <Loader className="w-5 h-5 text-blue-500 animate-spin" />
      case 'success':
        return <CheckCircle className="w-5 h-5 text-green-500" />
      case 'error':
        return <AlertCircle className="w-5 h-5 text-red-500" />
      default:
        return <FileText className="w-5 h-5 text-gray-400" />
    }
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Upload area */}
      <div
        {...getRootProps()}
        className={`
          border-2 border-dashed rounded-2xl p-12 text-center cursor-pointer
          transition-colors duration-200
          ${isDragActive 
            ? 'border-blue-500 bg-blue-50' 
            : 'border-gray-300 hover:border-gray-400 bg-white'
          }
        `}
      >
        <input {...getInputProps()} />
        <div className="flex flex-col items-center">
          <div className={`
            p-4 rounded-full mb-4
            ${isDragActive ? 'bg-blue-100' : 'bg-gray-100'}
          `}>
            <UploadIcon className={`w-8 h-8 ${isDragActive ? 'text-blue-600' : 'text-gray-400'}`} />
          </div>
          <p className="text-lg font-medium text-gray-900 mb-1">
            {isDragActive ? 'Drop files here' : 'Drag & drop invoices here'}
          </p>
          <p className="text-sm text-gray-500 mb-4">
            or click to browse
          </p>
          <p className="text-xs text-gray-400">
            Supports PDF, PNG, JPG, TIFF (max 10MB)
          </p>
        </div>
      </div>

      {/* File list */}
      {files.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <h3 className="font-semibold text-gray-900">
              Selected Files ({files.length})
            </h3>
          </div>
          <div className="divide-y divide-gray-200">
            {files.map((fileItem) => (
              <div key={fileItem.id} className="flex items-center gap-4 px-6 py-4">
                {/* Preview or icon */}
                {fileItem.preview ? (
                  <img 
                    src={fileItem.preview} 
                    alt="" 
                    className="w-12 h-12 object-cover rounded-lg"
                  />
                ) : (
                  <div className="w-12 h-12 bg-gray-100 rounded-lg flex items-center justify-center">
                    <FileText className="w-6 h-6 text-gray-400" />
                  </div>
                )}
                
                {/* File info */}
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-gray-900 truncate">
                    {fileItem.file.name}
                  </p>
                  <p className="text-sm text-gray-500">
                    {(fileItem.file.size / 1024 / 1024).toFixed(2)} MB
                  </p>
                  {uploadErrors[fileItem.id] && (
                    <p className="text-xs text-red-600 mt-0.5">
                      {uploadErrors[fileItem.id]}
                    </p>
                  )}
                </div>

                {/* Status */}
                <div className="flex items-center gap-3">
                  {getFileIcon(uploadStatus[fileItem.id])}
                  {!uploading && !uploadStatus[fileItem.id] && (
                    <button
                      onClick={() => removeFile(fileItem.id)}
                      className="p-1 hover:bg-gray-100 rounded-lg transition-colors"
                    >
                      <X className="w-5 h-5 text-gray-400" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
          
          {/* Upload button */}
          <div className="px-6 py-4 bg-gray-50 border-t border-gray-200">
            <button
              onClick={uploadFiles}
              disabled={uploading || files.length === 0}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {uploading ? (
                <>
                  <Loader className="w-5 h-5 animate-spin" />
                  Uploading...
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

      {/* Info card */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-6">
        <h4 className="font-medium text-blue-900 mb-2">What happens after upload?</h4>
        <ol className="text-sm text-blue-700 space-y-1">
          <li>1. Invoice is preprocessed (deskew, denoise)</li>
          <li>2. OCR extracts text from the document</li>
          <li>3. AI identifies and extracts key fields</li>
          <li>4. You can review and validate the results</li>
        </ol>
      </div>
    </div>
  )
}
