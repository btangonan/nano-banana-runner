import { useState, useCallback, useEffect, useRef } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { 
  Zap, Play, Pause, AlertCircle, CheckCircle, Loader2, 
  DollarSign, Clock, Image, Settings, RefreshCw, Eye, Download 
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Progress } from '@/components/ui/Progress'
import { Badge } from '@/components/ui/Badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/Select'
import { cn } from '@/lib/utils'
import { apiClient, ApiError } from '@/lib/client'
import { 
  PreflightRequest, PreflightResponse, 
  SubmitRequest, SubmitResponse,
  PollRequest, PollResponse 
} from '@/lib/contracts'
import type { ToastProps } from '@/components/ui/Toast'

interface SubmitMonitorProps {
  onNext: () => void
  onBack: () => void
  toast: (props: Omit<ToastProps, 'id'>) => void
}

interface JobState {
  jobId?: string
  status: 'idle' | 'preflight' | 'ready' | 'submitted' | 'running' | 'completed' | 'failed'
  pollData?: PollResponse
}

export function SubmitMonitor({ onNext, onBack, toast }: SubmitMonitorProps) {
  // Form state
  const [promptsPath] = useState('./artifacts/prompts.jsonl')
  const [styleDir] = useState('./images')
  const [provider, setProvider] = useState<'gemini-batch' | 'vertex-ai'>('gemini-batch')
  const [variants, setVariants] = useState<1 | 2 | 3>(1)
  const [runMode, setRunMode] = useState<'dry-run' | 'live'>('dry-run')

  // Job tracking state
  const [jobState, setJobState] = useState<JobState>({ status: 'idle' })
  const [preflightData, setPreflightData] = useState<PreflightResponse | null>(null)
  const pollIntervalRef = useRef<NodeJS.Timeout>()

  // Preflight mutation
  const preflightMutation = useMutation({
    mutationFn: async (params: PreflightRequest) => {
      return apiClient.post('/ui/preflight', params, PreflightResponse)
    },
    onSuccess: (data) => {
      setPreflightData(data)
      setJobState({ status: 'ready' })
      toast({
        variant: 'success',
        title: 'Cost Estimation Complete',
        description: `${data.costEstimate.totalImages} images • $${data.costEstimate.estimatedCost.toFixed(4)} estimated cost`,
      })
    },
    onError: (error: ApiError) => {
      toast({
        variant: 'error', 
        title: 'Preflight Failed',
        description: error.detail || 'Could not estimate costs',
      })
    }
  })

  // Submit mutation
  const submitMutation = useMutation({
    mutationFn: async (params: SubmitRequest) => {
      return apiClient.post('/ui/submit', params, SubmitResponse)
    },
    onSuccess: (data) => {
      setJobState({ 
        jobId: data.jobId,
        status: 'submitted' 
      })
      startPolling(data.jobId)
      toast({
        variant: 'success',
        title: 'Job Submitted',
        description: `${data.runMode === 'dry-run' ? 'Dry-run' : 'Live'} job started with ${data.estimatedImages} images`,
      })
    },
    onError: (error: ApiError) => {
      toast({
        variant: 'error',
        title: 'Submission Failed', 
        description: error.detail || 'Could not submit job',
      })
    }
  })

  // Polling function
  const startPolling = useCallback((jobId: string) => {
    // Clear existing interval
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current)
    }

    const poll = async () => {
      try {
        const response = await apiClient.get(
          `/ui/poll?jobId=${jobId}`, 
          PollResponse
        )
        
        setJobState(prev => ({
          ...prev,
          jobId,
          status: response.status,
          pollData: response,
        }))

        // Determine next poll interval
        let nextPollMs = 5000 // Default 5s
        if ('nextPollIn' in response) {
          nextPollMs = response.nextPollIn
        }

        // Stop polling if completed or failed
        if (response.status === 'completed' || response.status === 'failed') {
          if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current)
          }

          if (response.status === 'completed') {
            toast({
              variant: 'success',
              title: 'Generation Complete',
              description: `Job completed successfully! ${response.estimatedImages} images generated.`,
            })
          } else if (response.status === 'failed') {
            toast({
              variant: 'error',
              title: 'Generation Failed',
              description: 'failed' in response ? response.error.message : 'Job failed unexpectedly',
            })
          }
        } else {
          // Schedule next poll
          pollIntervalRef.current = setTimeout(poll, nextPollMs)
        }

      } catch (error) {
        console.error('Polling error:', error)
        // Continue polling on errors, but less frequently
        if (pollIntervalRef.current) {
          pollIntervalRef.current = setTimeout(poll, 10000)
        }
      }
    }

    // Start immediate poll
    poll()
  }, [toast])

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current)
      }
    }
  }, [])

  // Handlers
  const handlePreflight = useCallback(() => {
    setJobState({ status: 'preflight' })
    preflightMutation.mutate({
      promptsPath,
      styleDir,
      provider,
      variants,
    })
  }, [promptsPath, styleDir, provider, variants, preflightMutation])

  const handleSubmit = useCallback(() => {
    if (!preflightData) return

    submitMutation.mutate({
      promptsPath,
      styleDir,
      provider,
      variants,
      runMode,
    })
  }, [promptsPath, styleDir, provider, variants, runMode, preflightData, submitMutation])

  const handleViewGallery = useCallback(() => {
    if (jobState.jobId) {
      // Store jobId in URL params for Gallery component
      const url = new URL(window.location.href)
      url.searchParams.set('jobId', jobState.jobId)
      window.history.pushState({}, '', url.toString())
    }
    onNext()
  }, [jobState.jobId, onNext])

  // Render status indicator
  const renderStatusBadge = () => {
    switch (jobState.status) {
      case 'idle':
        return <Badge variant="secondary">Ready to Start</Badge>
      case 'preflight':
        return <Badge variant="secondary"><Loader2 className="w-3 h-3 mr-1 animate-spin" />Estimating</Badge>
      case 'ready':
        return <Badge variant="success"><CheckCircle className="w-3 h-3 mr-1" />Ready to Submit</Badge>
      case 'submitted':
        return <Badge variant="secondary"><Clock className="w-3 h-3 mr-1" />Submitted</Badge>
      case 'running':
        return <Badge variant="secondary"><Loader2 className="w-3 h-3 mr-1 animate-spin" />Generating</Badge>
      case 'completed':
        return <Badge variant="success"><CheckCircle className="w-3 h-3 mr-1" />Complete</Badge>
      case 'failed':
        return <Badge variant="destructive"><AlertCircle className="w-3 h-3 mr-1" />Failed</Badge>
      default:
        return <Badge variant="secondary">Unknown</Badge>
    }
  }

  // Render progress section
  const renderProgress = () => {
    if (!jobState.pollData?.progress) return null

    const { progress } = jobState.pollData
    return (
      <div className="space-y-2">
        <div className="flex justify-between text-sm">
          <span className="capitalize">{progress.stage}</span>
          <span>{progress.current}/{progress.total}</span>
        </div>
        <Progress value={progress.percentage} className="w-full" />
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>Progress: {progress.percentage}%</span>
          {jobState.pollData?.timing.estimatedRemaining && (
            <span>~{jobState.pollData.timing.estimatedRemaining} remaining</span>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Submit & Monitor</h1>
          <p className="text-muted-foreground">Generate images and track progress</p>
        </div>
        {renderStatusBadge()}
      </div>

      {/* Configuration */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="w-5 h-5" />
            Generation Settings
          </CardTitle>
          <CardDescription>Configure your image generation parameters</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="text-sm font-medium mb-2 block">Provider</label>
              <Select value={provider} onValueChange={(value: 'gemini-batch' | 'vertex-ai') => setProvider(value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="gemini-batch">Gemini Batch ($0.000125/img)</SelectItem>
                  <SelectItem value="vertex-ai">Vertex AI ($0.0025/img)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-sm font-medium mb-2 block">Variants per Prompt</label>
              <Select value={variants.toString()} onValueChange={(value) => setVariants(parseInt(value) as 1 | 2 | 3)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">1 variant</SelectItem>
                  <SelectItem value="2">2 variants</SelectItem>
                  <SelectItem value="3">3 variants</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-sm font-medium mb-2 block">Execution Mode</label>
              <Select value={runMode} onValueChange={(value: 'dry-run' | 'live') => setRunMode(value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="dry-run">Dry Run (No Cost)</SelectItem>
                  <SelectItem value="live">Live Generation</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Cost Estimation */}
      {preflightData && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <DollarSign className="w-5 h-5" />
              Cost Estimation
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <div className="text-2xl font-bold">{preflightData.validation.promptCount}</div>
                <div className="text-sm text-muted-foreground">Prompts</div>
              </div>
              <div>
                <div className="text-2xl font-bold">{preflightData.costEstimate.totalImages}</div>
                <div className="text-sm text-muted-foreground">Total Images</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-green-600">
                  ${preflightData.costEstimate.estimatedCost.toFixed(4)}
                </div>
                <div className="text-sm text-muted-foreground">Estimated Cost</div>
              </div>
              <div>
                <div className="text-2xl font-bold">{preflightData.costEstimate.estimatedTime}</div>
                <div className="text-sm text-muted-foreground">Est. Duration</div>
              </div>
            </div>

            {preflightData.recommendations.length > 0 && (
              <div className="mt-4 p-3 bg-muted rounded-lg">
                <div className="font-medium mb-2">Recommendations:</div>
                <ul className="text-sm space-y-1">
                  {preflightData.recommendations.map((rec, i) => (
                    <li key={i}>{rec}</li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Job Status */}
      {jobState.status !== 'idle' && jobState.status !== 'preflight' && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Zap className="w-5 h-5" />
              Job Status
              {jobState.jobId && (
                <code className="text-xs bg-muted px-2 py-1 rounded ml-auto">
                  {jobState.jobId.slice(0, 8)}...
                </code>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {jobState.pollData && (
              <>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div>
                    <div className="text-lg font-semibold">{jobState.pollData.prompts}</div>
                    <div className="text-sm text-muted-foreground">Prompts</div>
                  </div>
                  <div>
                    <div className="text-lg font-semibold">{jobState.pollData.estimatedImages}</div>
                    <div className="text-sm text-muted-foreground">Images</div>
                  </div>
                  <div>
                    <div className="text-lg font-semibold">{jobState.pollData.provider}</div>
                    <div className="text-sm text-muted-foreground">Provider</div>
                  </div>
                  <div>
                    <div className="text-lg font-semibold">{jobState.pollData.timing.elapsedTime}</div>
                    <div className="text-sm text-muted-foreground">Elapsed</div>
                  </div>
                </div>

                {renderProgress()}

                {/* Status-specific actions */}
                {'completed' in jobState.pollData && jobState.pollData.completed && (
                  <div className="flex gap-2 pt-4">
                    <Button onClick={handleViewGallery} className="flex items-center gap-2">
                      <Eye className="w-4 h-4" />
                      View Gallery
                    </Button>
                    <Button variant="outline" asChild>
                      <a href={jobState.pollData.actions.fetchResults} className="flex items-center gap-2">
                        <Download className="w-4 h-4" />
                        Download Results
                      </a>
                    </Button>
                  </div>
                )}

                {'failed' in jobState.pollData && jobState.pollData.failed && (
                  <div className="p-3 bg-destructive/10 rounded-lg">
                    <div className="font-medium text-destructive mb-1">Generation Failed</div>
                    <div className="text-sm">{jobState.pollData.error.message}</div>
                    {jobState.pollData.error.recoverable && (
                      <Button variant="outline" size="sm" className="mt-2" onClick={handleSubmit}>
                        <RefreshCw className="w-4 h-4 mr-2" />
                        Retry Job
                      </Button>
                    )}
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Actions */}
      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack}>
          Back
        </Button>

        <div className="flex gap-2">
          {jobState.status === 'idle' && (
            <Button 
              onClick={handlePreflight}
              disabled={preflightMutation.isPending}
              className="flex items-center gap-2"
            >
              {preflightMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <DollarSign className="w-4 h-4" />
              )}
              Estimate Cost
            </Button>
          )}

          {jobState.status === 'ready' && (
            <Button 
              onClick={handleSubmit}
              disabled={submitMutation.isPending}
              className="flex items-center gap-2"
              variant={runMode === 'live' ? 'default' : 'secondary'}
            >
              {submitMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Play className="w-4 h-4" />
              )}
              {runMode === 'dry-run' ? 'Start Dry Run' : 'Start Generation'}
            </Button>
          )}

          {jobState.status === 'completed' && (
            <Button onClick={onNext} className="flex items-center gap-2">
              <Eye className="w-4 h-4" />
              View Gallery
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}