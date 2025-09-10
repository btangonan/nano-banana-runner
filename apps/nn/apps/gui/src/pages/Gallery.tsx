import { useState, useCallback, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { 
  Image as ImageIcon, Download, Grid3X3, List, Search, Filter,
  ChevronLeft, ChevronRight, AlertCircle, Loader2, RefreshCw,
  Calendar, FileImage, HardDrive, Clock, ZoomIn
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Input } from '@/components/ui/Input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/Select'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/Dialog'
import { cn } from '@/lib/utils'
import { apiClient, ApiError } from '@/lib/client'
import { FetchRequest, FetchResponse } from '@/lib/contracts'
import type { ToastProps } from '@/components/ui/Toast'

interface GalleryProps {
  jobId?: string | null
  onNext?: () => void
  onBack: () => void
  toast: (props: Omit<ToastProps, 'id'>) => void
}

interface GalleryItem {
  id: string
  name: string
  size: number
  modified: string
  type: string
  dataUrl?: string
  error?: string
  downloadUrl: string
}

export function Gallery({ jobId: propJobId, onNext, onBack, toast }: GalleryProps) {
  // Get jobId from props or URL params
  const [jobId, setJobId] = useState<string>('')
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [selectedImage, setSelectedImage] = useState<GalleryItem | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [typeFilter, setTypeFilter] = useState<string>('all')
  const [page, setPage] = useState(0)
  const itemsPerPage = 20

  // Initialize jobId from props or URL params
  useEffect(() => {
    if (propJobId) {
      setJobId(propJobId)
    } else {
      const urlParams = new URLSearchParams(window.location.search)
      const urlJobId = urlParams.get('jobId')
      if (urlJobId) {
        setJobId(urlJobId)
      }
    }
  }, [propJobId])

  // Fetch gallery data
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['gallery', jobId, page],
    queryFn: async (): Promise<FetchResponse> => {
      if (!jobId) throw new Error('No job ID provided')
      
      const params = new URLSearchParams({
        jobId,
        format: 'gallery',
        limit: itemsPerPage.toString(),
        offset: (page * itemsPerPage).toString(),
      })
      
      return apiClient.get(`/ui/fetch?${params.toString()}`, FetchResponse)
    },
    enabled: !!jobId,
    refetchInterval: false,
    retry: 1,
  })

  // Filter items based on search and type filter
  const filteredItems = data?.results && 'items' in data.results 
    ? data.results.items.filter(item => {
        const matchesSearch = item.name.toLowerCase().includes(searchTerm.toLowerCase())
        const matchesType = typeFilter === 'all' || item.type === typeFilter
        return matchesSearch && matchesType
      })
    : []

  // Get unique types for filter dropdown
  const availableTypes = data?.results && 'items' in data.results
    ? Array.from(new Set(data.results.items.map(item => item.type)))
    : []

  // Handlers
  const handleImageClick = useCallback((item: GalleryItem) => {
    setSelectedImage(item)
  }, [])

  const handleDownload = useCallback(async (item: GalleryItem) => {
    try {
      const response = await fetch(item.downloadUrl)
      if (!response.ok) throw new Error('Download failed')
      
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = item.name
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)

      toast({
        variant: 'success',
        title: 'Download Started',
        description: `Downloading ${item.name}`,
      })
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Download Failed',
        description: 'Could not download the image',
      })
    }
  }, [toast])

  const handleDownloadAll = useCallback(async () => {
    if (!data?.actions.downloadAll) return

    try {
      const response = await fetch(data.actions.downloadAll)
      if (!response.ok) throw new Error('Download failed')
      
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `job-${jobId}-results.zip`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)

      toast({
        variant: 'success',
        title: 'Bulk Download Started',
        description: 'Downloading all results as ZIP file',
      })
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Bulk Download Failed',
        description: 'Could not download the results archive',
      })
    }
  }, [data?.actions.downloadAll, jobId, toast])

  // Format file size
  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  // Format date
  const formatDate = (dateStr: string): string => {
    return new Date(dateStr).toLocaleString()
  }

  // Error state
  if (error && !isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="outline" size="sm" onClick={onBack}>
              ← Back
            </Button>
            <div>
              <h1 className="text-2xl font-semibold">Gallery</h1>
              <p className="text-muted-foreground">Generated images</p>
            </div>
          </div>
        </div>

        <Card>
          <CardContent className="p-8 text-center">
            <AlertCircle className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">Failed to Load Gallery</h3>
            <p className="text-muted-foreground mb-4">
              {error instanceof ApiError ? error.detail : 'Could not load the image gallery'}
            </p>
            <Button onClick={() => refetch()} className="flex items-center gap-2">
              <RefreshCw className="w-4 h-4" />
              Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  // Loading state
  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="outline" size="sm" onClick={onBack}>
              ← Back
            </Button>
            <div>
              <h1 className="text-2xl font-semibold">Gallery</h1>
              <p className="text-muted-foreground">Loading generated images...</p>
            </div>
          </div>
        </div>

        <Card>
          <CardContent className="p-8 text-center">
            <Loader2 className="w-12 h-12 mx-auto text-primary animate-spin mb-4" />
            <h3 className="text-lg font-semibold mb-2">Loading Gallery</h3>
            <p className="text-muted-foreground">Fetching your generated images...</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  // Main render
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="outline" size="sm" onClick={onBack}>
            ← Back
          </Button>
          <div>
            <h1 className="text-2xl font-semibold">Gallery</h1>
            <p className="text-muted-foreground">
              {data ? `${data.results.total} generated images` : 'Generated images'}
              {jobId && (
                <code className="ml-2 text-xs bg-muted px-2 py-1 rounded">
                  {jobId.slice(0, 8)}...
                </code>
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={() => setViewMode(viewMode === 'grid' ? 'list' : 'grid')}
          >
            {viewMode === 'grid' ? <List className="w-4 h-4" /> : <Grid3X3 className="w-4 h-4" />}
          </Button>
          
          {data && (
            <Button onClick={handleDownloadAll} className="flex items-center gap-2">
              <Download className="w-4 h-4" />
              Download All
            </Button>
          )}
        </div>
      </div>

      {/* Job Info */}
      {data?.job && (
        <Card>
          <CardContent className="p-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <div className="text-lg font-semibold">{data.job.prompts}</div>
                <div className="text-sm text-muted-foreground">Prompts</div>
              </div>
              <div>
                <div className="text-lg font-semibold">{data.job.estimatedImages}</div>
                <div className="text-sm text-muted-foreground">Est. Images</div>
              </div>
              <div>
                <div className="text-lg font-semibold">{data.job.provider}</div>
                <div className="text-sm text-muted-foreground">Provider</div>
              </div>
              <div>
                <div className="text-lg font-semibold">{data.job.duration || 'N/A'}</div>
                <div className="text-sm text-muted-foreground">Duration</div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="flex-1">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
            <Input
              placeholder="Search images..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
        </div>
        
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            {availableTypes.map(type => (
              <SelectItem key={type} value={type}>{type}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Results */}
      {filteredItems.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <ImageIcon className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No Images Found</h3>
            <p className="text-muted-foreground">
              {searchTerm || typeFilter !== 'all' 
                ? 'Try adjusting your filters to see more results.'
                : 'No generated images available for this job.'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {viewMode === 'grid' ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {filteredItems.map((item) => (
                <Card key={item.id} className="group overflow-hidden hover:shadow-lg transition-shadow">
                  <div className="aspect-square relative bg-muted">
                    {item.dataUrl && !item.error ? (
                      <img 
                        src={item.dataUrl} 
                        alt={item.name}
                        className="w-full h-full object-cover cursor-pointer"
                        onClick={() => handleImageClick(item)}
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <div className="text-center">
                          <AlertCircle className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
                          <p className="text-xs text-muted-foreground">
                            {item.error || 'Image unavailable'}
                          </p>
                        </div>
                      </div>
                    )}
                    
                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <div className="flex gap-2">
                        {item.dataUrl && (
                          <Button 
                            size="icon" 
                            variant="secondary"
                            onClick={() => handleImageClick(item)}
                          >
                            <ZoomIn className="w-4 h-4" />
                          </Button>
                        )}
                        <Button 
                          size="icon" 
                          variant="secondary"
                          onClick={() => handleDownload(item)}
                        >
                          <Download className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                  
                  <CardContent className="p-3">
                    <div className="text-sm font-medium truncate" title={item.name}>
                      {item.name}
                    </div>
                    <div className="flex items-center justify-between text-xs text-muted-foreground mt-1">
                      <Badge variant="secondary">{item.type}</Badge>
                      <span>{formatFileSize(item.size)}</span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <Card>
              <CardContent className="p-0">
                <div className="divide-y">
                  {filteredItems.map((item) => (
                    <div key={item.id} className="p-4 flex items-center gap-4 hover:bg-muted/50">
                      <div className="w-16 h-16 bg-muted rounded-lg flex-shrink-0 overflow-hidden">
                        {item.dataUrl && !item.error ? (
                          <img 
                            src={item.dataUrl} 
                            alt={item.name}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <AlertCircle className="w-6 h-6 text-muted-foreground" />
                          </div>
                        )}
                      </div>
                      
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{item.name}</div>
                        <div className="flex items-center gap-4 text-sm text-muted-foreground mt-1">
                          <span className="flex items-center gap-1">
                            <FileImage className="w-3 h-3" />
                            {item.type}
                          </span>
                          <span className="flex items-center gap-1">
                            <HardDrive className="w-3 h-3" />
                            {formatFileSize(item.size)}
                          </span>
                          <span className="flex items-center gap-1">
                            <Calendar className="w-3 h-3" />
                            {formatDate(item.modified)}
                          </span>
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-2">
                        {item.dataUrl && (
                          <Button 
                            size="icon" 
                            variant="ghost"
                            onClick={() => handleImageClick(item)}
                          >
                            <ZoomIn className="w-4 h-4" />
                          </Button>
                        )}
                        <Button 
                          size="icon" 
                          variant="ghost"
                          onClick={() => handleDownload(item)}
                        >
                          <Download className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Pagination */}
          {data && data.results.total > itemsPerPage && (
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Showing {page * itemsPerPage + 1} to {Math.min((page + 1) * itemsPerPage, data.results.total)} of {data.results.total} results
              </p>
              
              <div className="flex items-center gap-2">
                <Button 
                  variant="outline" 
                  size="icon"
                  onClick={() => setPage(Math.max(0, page - 1))}
                  disabled={page === 0}
                >
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                
                <span className="text-sm">
                  Page {page + 1} of {Math.ceil(data.results.total / itemsPerPage)}
                </span>
                
                <Button 
                  variant="outline" 
                  size="icon"
                  onClick={() => setPage(page + 1)}
                  disabled={(page + 1) * itemsPerPage >= data.results.total}
                >
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Image Preview Dialog */}
      <Dialog open={!!selectedImage} onOpenChange={() => setSelectedImage(null)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>{selectedImage?.name}</DialogTitle>
            <DialogDescription>
              {selectedImage && (
                <div className="flex items-center gap-4 text-sm">
                  <span>{selectedImage.type}</span>
                  <span>{formatFileSize(selectedImage.size)}</span>
                  <span>{formatDate(selectedImage.modified)}</span>
                </div>
              )}
            </DialogDescription>
          </DialogHeader>
          
          {selectedImage?.dataUrl && (
            <div className="max-h-96 overflow-auto">
              <img 
                src={selectedImage.dataUrl} 
                alt={selectedImage.name}
                className="w-full h-auto"
              />
            </div>
          )}
          
          <div className="flex justify-end gap-2">
            {selectedImage && (
              <Button onClick={() => handleDownload(selectedImage)} className="flex items-center gap-2">
                <Download className="w-4 h-4" />
                Download
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Actions */}
      {onNext && (
        <div className="flex justify-end">
          <Button onClick={onNext}>
            Next →
          </Button>
        </div>
      )}
    </div>
  )
}