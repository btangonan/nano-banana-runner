import { useState, useCallback } from 'react'
import { useDropzone } from 'react-dropzone'
import { useMutation } from '@tanstack/react-query'
import { Upload, X, Image as ImageIcon, AlertCircle, CheckCircle, Loader2 } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Progress } from '@/components/ui/Progress'
import { cn, formatFileSize, isValidImageFile } from '@/lib/utils'
import { apiClient, ApiError } from '@/lib/client'
import { UploadResponse, AnalyzeResponse, ClearResponse } from '@/lib/contracts'
import type { ToastProps } from '@/components/ui/Toast'

interface UploadAnalyzeProps {
  onNext: () => void
  toast: (props: Omit<ToastProps, 'id'>) => void
}

interface FileWithPreview extends File {
  preview?: string
  uploadStatus?: 'pending' | 'uploading' | 'success' | 'error'
  error?: string
}

export function UploadAnalyze({ onNext, toast }: UploadAnalyzeProps) {
  const [files, setFiles] = useState<FileWithPreview[]>([])
  const [uploadResult, setUploadResult] = useState<UploadResponse | null>(null)
  const [analyzeResult, setAnalyzeResult] = useState<AnalyzeResponse | null>(null)
  const [isFirstUpload, setIsFirstUpload] = useState(true) // Track if this is the first upload

  const uploadMutation = useMutation({
    mutationFn: async (files: File[]) => {
      const formData = new FormData()
      files.forEach((file) => {
        formData.append('files', file)
      })

      // Clear existing images on first upload to prevent accumulation from previous sessions
      const url = isFirstUpload ? '/ui/upload?clearExisting=true' : '/ui/upload'
      return apiClient.postFormData(url, formData, UploadResponse)
    },
    onSuccess: (data) => {
      setUploadResult(data)
      setIsFirstUpload(false) // Mark that we've done the first upload
      toast({
        title: 'Upload successful',
        description: `${data.uploaded} files uploaded successfully`,
        variant: 'success',
      })
      
      if (data.warnings && data.warnings.length > 0) {
        toast({
          title: 'Upload warnings',
          description: `${data.warnings.length} files had issues`,
          variant: 'warning',
        })
      }
    },
    onError: (error: Error) => {
      if (error instanceof ApiError) {
        toast({
          title: error.problem.title,
          description: error.problem.detail,
          variant: 'destructive',
        })
      } else {
        toast({
          title: 'Upload failed',
          description: error.message,
          variant: 'destructive',
        })
      }
    }
  })

  const analyzeMutation = useMutation({
    mutationFn: async () => {
      return apiClient.post('/ui/analyze', { 
        inDir: './images',
        concurrency: 4 
      }, AnalyzeResponse)
    },
    onSuccess: (data) => {
      setAnalyzeResult(data)
      toast({
        title: 'Analysis complete',
        description: `${data.successful} images analyzed in ${data.duration}`,
        variant: 'success',
      })
    },
    onError: (error: Error) => {
      if (error instanceof ApiError) {
        toast({
          title: error.problem.title,
          description: error.problem.detail,
          variant: 'destructive',
        })
      } else {
        toast({
          title: 'Analysis failed',
          description: error.message,
          variant: 'destructive',
        })
      }
    }
  })

  const clearSessionMutation = useMutation({
    mutationFn: async () => {
      return apiClient.post('/ui/clear-images', {}, ClearResponse)
    },
    onSuccess: (data) => {
      // Reset all local state
      setFiles([])
      setUploadResult(null)
      setAnalyzeResult(null)
      setIsFirstUpload(true) // Reset first upload flag for new session
      // Clear any preview URLs
      files.forEach(f => f.preview && URL.revokeObjectURL(f.preview))
      
      toast({
        title: 'New session started',
        description: data.message || 'Previous images have been cleared',
        variant: 'success',
      })
    },
    onError: (error: Error) => {
      if (error instanceof ApiError) {
        toast({
          title: error.problem.title,
          description: error.problem.detail,
          variant: 'destructive',
        })
      } else {
        toast({
          title: 'Failed to start new session',
          description: error.message,
          variant: 'destructive',
        })
      }
    }
  })

  const onDrop = useCallback((acceptedFiles: File[], rejectedFiles: any[]) => {
    // Handle rejected files
    rejectedFiles.forEach(({ file, errors }) => {
      toast({
        title: `${file.name} rejected`,
        description: errors.map((e: any) => e.message).join(', '),
        variant: 'destructive',
      })
    })

    // Process accepted files
    const newFiles: FileWithPreview[] = acceptedFiles.map(file => {
      const fileWithPreview = file as FileWithPreview
      
      // Validate file client-side
      if (!isValidImageFile(file)) {
        fileWithPreview.uploadStatus = 'error'
        fileWithPreview.error = 'Invalid image type'
      } else if (file.size > 15 * 1024 * 1024) {
        fileWithPreview.uploadStatus = 'error'
        fileWithPreview.error = 'File too large (max 15MB)'
      } else {
        fileWithPreview.uploadStatus = 'pending'
        // Create preview URL for images
        fileWithPreview.preview = URL.createObjectURL(file)
      }

      return fileWithPreview
    })

    setFiles(prev => [...prev, ...newFiles])
  }, [toast])

  const removeFile = useCallback((index: number) => {
    setFiles(prev => {
      const newFiles = [...prev]
      // Clean up preview URL
      if (newFiles[index].preview) {
        URL.revokeObjectURL(newFiles[index].preview!)
      }
      newFiles.splice(index, 1)
      return newFiles
    })
  }, [])

  const handleUpload = async () => {
    const validFiles = files.filter(f => f.uploadStatus !== 'error')
    if (validFiles.length === 0) return

    uploadMutation.mutate(validFiles)
  }

  const handleAnalyze = async () => {
    analyzeMutation.mutate()
  }

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'image/jpeg': ['.jpg', '.jpeg'],
      'image/png': ['.png'],
      'image/webp': ['.webp'],
    },
    maxSize: 15 * 1024 * 1024, // 15MB
    maxFiles: 500,
  })

  const validFilesCount = files.filter(f => f.uploadStatus !== 'error').length
  const canUpload = validFilesCount > 0 && !uploadMutation.isPending
  const canAnalyze = uploadResult && uploadResult.uploaded > 0 && !analyzeMutation.isPending

  return (
    <div className="space-y-6">
      {/* Header with session management buttons */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-semibold">Upload & Analyze</h1>
          <p className="text-muted-foreground">Upload images and analyze their visual properties</p>
        </div>
        <div className="flex gap-2">
          {/* New Session button - clears server images */}
          <Button 
            onClick={() => clearSessionMutation.mutate()}
            disabled={clearSessionMutation.isPending}
            variant="default"
            size="sm"
            title="Clears all previously uploaded images from the server and starts fresh"
          >
            {clearSessionMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Clearing...
              </>
            ) : (
              'New Session'
            )}
          </Button>
          
          {/* Start Over button - resets UI state only */}
          {(files.length > 0 || uploadResult || analyzeResult) && (
            <Button 
              onClick={() => {
                // Reset all state (UI only)
                setFiles([])
                setUploadResult(null)
                setAnalyzeResult(null)
                // Clear any uploaded files
                files.forEach(f => f.preview && URL.revokeObjectURL(f.preview))
                toast({
                  title: 'UI reset complete',
                  description: 'Local state cleared. Use "New Session" to clear server images.',
                  variant: 'default',
                })
              }}
              variant="outline"
              size="sm"
              title="Resets the current UI without clearing server images"
            >
              Start Over
            </Button>
          )}
        </div>
      </div>

      {/* Upload Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Upload className="h-5 w-5" />
            <span>Upload Images</span>
          </CardTitle>
          <CardDescription>
            Drag and drop images or click to browse. Supports JPEG, PNG, WebP up to 15MB each.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Dropzone */}
          <div
            {...getRootProps()}
            className={cn(
              "border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors",
              isDragActive ? "border-primary bg-primary/5" : "border-border hover:border-primary/50",
              uploadMutation.isPending && "pointer-events-none opacity-50"
            )}
          >
            <input {...getInputProps()} />
            <div className="flex flex-col items-center space-y-2">
              <Upload className="h-12 w-12 text-muted-foreground" />
              <div>
                {isDragActive ? (
                  <p className="text-primary">Drop the images here...</p>
                ) : (
                  <>
                    <p className="text-lg">Drag & drop images here</p>
                    <p className="text-sm text-muted-foreground">
                      or click to select files
                    </p>
                  </>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Max 500 files, 15MB each • JPEG, PNG, WebP
              </p>
            </div>
          </div>

          {/* File List */}
          {files.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">
                  Selected Files ({validFilesCount} valid)
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    files.forEach(f => f.preview && URL.revokeObjectURL(f.preview))
                    setFiles([])
                  }}
                >
                  Clear All
                </Button>
              </div>
              
              <div className="max-h-60 overflow-y-auto space-y-2">
                {files.map((file, index) => (
                  <div
                    key={`${file.name}-${index}`}
                    className={cn(
                      "flex items-center space-x-3 p-3 rounded-lg border",
                      file.uploadStatus === 'error' && "border-destructive bg-destructive/5",
                      file.uploadStatus === 'success' && "border-green-200 bg-green-50"
                    )}
                  >
                    {file.preview ? (
                      <img
                        src={file.preview}
                        alt={file.name}
                        className="h-10 w-10 rounded object-cover"
                      />
                    ) : (
                      <ImageIcon className="h-10 w-10 text-muted-foreground" />
                    )}
                    
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{file.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatFileSize(file.size)}
                        {file.error && (
                          <span className="text-destructive ml-2">{file.error}</span>
                        )}
                      </p>
                    </div>

                    <div className="flex items-center space-x-2">
                      {file.uploadStatus === 'error' && (
                        <AlertCircle className="h-4 w-4 text-destructive" />
                      )}
                      {file.uploadStatus === 'success' && (
                        <CheckCircle className="h-4 w-4 text-green-600" />
                      )}
                      
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => removeFile(index)}
                        className="h-6 w-6"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>

              <Button
                onClick={handleUpload}
                disabled={!canUpload}
                className="w-full"
              >
                {uploadMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Uploading...
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4 mr-2" />
                    Upload {validFilesCount} Files
                  </>
                )}
              </Button>
            </div>
          )}

          {/* Upload Result */}
          {uploadResult && (
            <div className="p-4 rounded-lg bg-green-50 border border-green-200">
              <div className="flex items-center space-x-2">
                <CheckCircle className="h-5 w-5 text-green-600" />
                <span className="font-medium text-green-800">
                  Upload Complete: {uploadResult.uploaded} files uploaded
                </span>
              </div>
              {uploadResult.warnings && uploadResult.warnings.length > 0 && (
                <div className="mt-2 text-sm text-green-700">
                  <p className="font-medium">Warnings:</p>
                  <ul className="list-disc list-inside space-y-1">
                    {uploadResult.warnings.map((warning, i) => (
                      <li key={i}>{warning}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Analysis Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <ImageIcon className="h-5 w-5" />
            <span>Analyze Images</span>
          </CardTitle>
          <CardDescription>
            Extract metadata, palette, and attributes from uploaded images.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button
            onClick={handleAnalyze}
            disabled={!canAnalyze}
            className="w-full"
            size="lg"
          >
            {analyzeMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Analyzing Images...
              </>
            ) : (
              <>
                <ImageIcon className="h-4 w-4 mr-2" />
                Analyze Images
              </>
            )}
          </Button>

          {!uploadResult && (
            <p className="text-sm text-muted-foreground text-center">
              Upload images first to enable analysis
            </p>
          )}

          {/* Analysis Progress */}
          {analyzeMutation.isPending && (
            <div className="space-y-2">
              <Progress value={50} />
              <p className="text-sm text-muted-foreground text-center">
                Processing image metadata and extracting features...
              </p>
            </div>
          )}

          {/* Analysis Results */}
          {analyzeResult && (
            <div className="space-y-4">
              <div className="p-4 rounded-lg bg-green-50 border border-green-200">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center space-x-2">
                    <CheckCircle className="h-5 w-5 text-green-600" />
                    <span className="font-medium text-green-800">
                      Analysis Complete
                    </span>
                  </div>
                  <span className="text-sm text-green-700">
                    {analyzeResult.duration}
                  </span>
                </div>
                
                <div className="grid grid-cols-3 gap-4 text-sm">
                  <div className="text-center">
                    <div className="text-lg font-bold text-green-800">
                      {analyzeResult.count}
                    </div>
                    <div className="text-green-700">Analyzed</div>
                  </div>
                  <div className="text-center">
                    <div className="text-lg font-bold text-green-800">
                      {analyzeResult.successful}
                    </div>
                    <div className="text-green-700">Successful</div>
                  </div>
                  <div className="text-center">
                    <div className="text-lg font-bold text-orange-600">
                      {analyzeResult.failed}
                    </div>
                    <div className="text-orange-700">Failed</div>
                  </div>
                </div>
              </div>

              {/* Sample descriptors preview */}
              {analyzeResult.sample && analyzeResult.sample.length > 0 && (
                <div>
                  <h4 className="font-medium mb-2">Sample Analysis Results:</h4>
                  <div className="space-y-2 max-h-40 overflow-y-auto">
                    {analyzeResult.sample.map((descriptor, index) => (
                      <div
                        key={index}
                        className="p-3 rounded border text-sm"
                      >
                        <div className="font-medium truncate mb-1">
                          {descriptor.path.split('/').pop()}
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                          <div>
                            Size: {descriptor.width}×{descriptor.height}
                          </div>
                          <div>
                            Colors: {descriptor.palette.length}
                          </div>
                          <div>
                            Subjects: {descriptor.subjects.join(', ') || 'None'}
                          </div>
                          <div>
                            Style: {descriptor.style.join(', ') || 'None'}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex gap-2">
                <Button 
                  onClick={() => {
                    // Reset all state
                    setFiles([])
                    setUploadResult(null)
                    setAnalyzeResult(null)
                    // Clear any uploaded files
                    files.forEach(f => f.preview && URL.revokeObjectURL(f.preview))
                  }}
                  variant="outline" 
                  className="flex-1"
                  size="lg"
                >
                  Start Over
                </Button>
                <Button onClick={onNext} className="flex-1" size="lg">
                  Continue to Remix & Review
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}