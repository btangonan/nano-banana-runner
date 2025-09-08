import { useState, useCallback } from 'react'
import { useMutation } from '@tanstack/react-query'
import { 
  Shuffle, Download, FileText, Edit3, Trash2, Save, X, Check, 
  AlertCircle, CheckCircle, Loader2, Plus, Minus 
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Progress } from '@/components/ui/Progress'
import { cn } from '@/lib/utils'
import { apiClient, ApiError } from '@/lib/client'
import { RemixRequest, RemixResponse, SavePromptsRequest, SavePromptsResponse, PromptRow } from '@/lib/contracts'
import type { ToastProps } from '@/components/ui/Toast'

interface RemixReviewProps {
  onNext: () => void
  onBack: () => void
  toast: (props: Omit<ToastProps, 'id'>) => void
}

interface EditingPrompt extends PromptRow {
  _id?: string // temporary ID for editing
  _isEditing?: boolean
}

export function RemixReview({ onNext, onBack, toast }: RemixReviewProps) {
  // Form state
  const [descriptorsPath, setDescriptorsPath] = useState('./artifacts/descriptors.json')
  const [maxPerImage, setMaxPerImage] = useState(10)
  const [seed, setSeed] = useState(42)

  // Results state
  const [remixResult, setRemixResult] = useState<RemixResponse | null>(null)
  const [prompts, setPrompts] = useState<EditingPrompt[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)

  const remixMutation = useMutation({
    mutationFn: async (params: RemixRequest) => {
      return apiClient.post('/ui/remix', params, RemixResponse)
    },
    onSuccess: (data) => {
      setRemixResult(data)
      // Initialize prompts with temporary IDs for editing
      const promptsWithIds = (data.sample || []).map((prompt, index) => ({
        ...prompt,
        _id: `temp-${index}`,
        _isEditing: false,
      }))
      setPrompts(promptsWithIds)
      
      toast({
        title: 'Remix complete',
        description: `Generated ${data.count} prompts from ${data.sourceImages} images in ${data.duration}`,
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
          title: 'Remix failed',
          description: error.message,
          variant: 'destructive',
        })
      }
    }
  })

  const savePromptsMutation = useMutation({
    mutationFn: async ({ format, outputPath }: { format: 'jsonl' | 'csv', outputPath?: string }) => {
      const cleanPrompts = prompts.map(({ _id, _isEditing, ...prompt }) => prompt)
      return apiClient.post('/ui/save-prompts', {
        prompts: cleanPrompts,
        format,
        outputPath: outputPath || `./artifacts/prompts.${format}`,
      }, SavePromptsResponse)
    },
    onSuccess: (data, variables) => {
      toast({
        title: 'Prompts saved',
        description: `${data.saved} prompts saved as ${variables.format.toUpperCase()} in ${data.duration}`,
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
          title: 'Save failed',
          description: error.message,
          variant: 'destructive',
        })
      }
    }
  })

  const handleRemix = useCallback(() => {
    remixMutation.mutate({ descriptorsPath, maxPerImage, seed })
  }, [descriptorsPath, maxPerImage, seed, remixMutation])

  const handleSaveJSONL = useCallback(() => {
    savePromptsMutation.mutate({ format: 'jsonl' })
  }, [savePromptsMutation])

  const handleSaveCSV = useCallback(() => {
    savePromptsMutation.mutate({ format: 'csv' })
  }, [savePromptsMutation])

  const startEditing = useCallback((id: string) => {
    setEditingId(id)
  }, [])

  const stopEditing = useCallback(() => {
    setEditingId(null)
  }, [])

  const updatePrompt = useCallback((id: string, field: keyof PromptRow, value: any) => {
    setPrompts(prev => prev.map(prompt => 
      prompt._id === id ? { ...prompt, [field]: value } : prompt
    ))
  }, [])

  const deletePrompt = useCallback((id: string) => {
    setPrompts(prev => prev.filter(prompt => prompt._id !== id))
    toast({
      title: 'Prompt deleted',
      description: 'Prompt removed from the list',
      variant: 'default',
    })
  }, [toast])

  const addPrompt = useCallback(() => {
    const newPrompt: EditingPrompt = {
      _id: `temp-new-${Date.now()}`,
      prompt: 'A new prompt...',
      sourceImage: 'custom',
      tags: ['custom'],
      seed: seed,
      _isEditing: true,
    }
    setPrompts(prev => [...prev, newPrompt])
    setEditingId(newPrompt._id!)
  }, [seed])

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Remix & Review</h1>
          <p className="text-gray-600">Generate prompts from analysis and review before rendering</p>
        </div>
        <div className="space-x-2">
          <Button variant="outline" onClick={onBack}>
            Back
          </Button>
          <Button onClick={onNext} disabled={prompts.length === 0}>
            Next: Render
          </Button>
        </div>
      </div>

      {/* Remix Configuration */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shuffle className="w-5 h-5" />
            Remix Configuration
          </CardTitle>
          <CardDescription>
            Configure prompt generation parameters
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700">
                Descriptors File
              </label>
              <input
                type="text"
                value={descriptorsPath}
                onChange={(e) => setDescriptorsPath(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="./artifacts/descriptors.json"
              />
            </div>
            
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700">
                Max Prompts Per Image
              </label>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline" 
                  size="sm"
                  onClick={() => setMaxPerImage(Math.max(1, maxPerImage - 1))}
                  disabled={maxPerImage <= 1}
                >
                  <Minus className="w-4 h-4" />
                </Button>
                <input
                  type="number"
                  value={maxPerImage}
                  onChange={(e) => setMaxPerImage(Math.max(1, Math.min(100, parseInt(e.target.value) || 1)))}
                  className="w-20 px-3 py-2 text-center border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  min="1"
                  max="100"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setMaxPerImage(Math.min(100, maxPerImage + 1))}
                  disabled={maxPerImage >= 100}
                >
                  <Plus className="w-4 h-4" />
                </Button>
              </div>
            </div>
            
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700">
                Random Seed
              </label>
              <input
                type="number"
                value={seed}
                onChange={(e) => setSeed(parseInt(e.target.value) || 42)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="42"
              />
            </div>
          </div>

          <div className="flex justify-center">
            <Button
              onClick={handleRemix}
              disabled={remixMutation.isPending}
              className="px-8"
            >
              {remixMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Shuffle className="w-4 h-4 mr-2" />
                  Generate Prompts
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Results Summary */}
      {remixResult && (
        <Card>
          <CardContent className="pt-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
              <div>
                <div className="text-2xl font-bold text-blue-600">{remixResult.count}</div>
                <div className="text-sm text-gray-600">Total Prompts</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-green-600">{remixResult.sourceImages}</div>
                <div className="text-sm text-gray-600">Source Images</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-purple-600">{remixResult.avgPerImage.toFixed(1)}</div>
                <div className="text-sm text-gray-600">Avg Per Image</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-orange-600">{remixResult.duration}</div>
                <div className="text-sm text-gray-600">Generation Time</div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Prompts Table */}
      {prompts.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <FileText className="w-5 h-5" />
                Prompt Review ({prompts.length} prompts)
              </CardTitle>
              <CardDescription>
                Edit, remove, or add prompts before saving
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={addPrompt}>
                <Plus className="w-4 h-4 mr-1" />
                Add Prompt
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleSaveCSV}
                disabled={savePromptsMutation.isPending}
              >
                {savePromptsMutation.isPending ? (
                  <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                ) : (
                  <Download className="w-4 h-4 mr-1" />
                )}
                CSV
              </Button>
              <Button
                size="sm"
                onClick={handleSaveJSONL}
                disabled={savePromptsMutation.isPending}
              >
                {savePromptsMutation.isPending ? (
                  <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                ) : (
                  <Save className="w-4 h-4 mr-1" />
                )}
                JSONL
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {prompts.map((prompt, index) => (
                <div
                  key={prompt._id || index}
                  className={cn(
                    "border rounded-lg p-3 space-y-2",
                    editingId === prompt._id ? "border-blue-300 bg-blue-50" : "border-gray-200"
                  )}
                >
                  <div className="flex items-center justify-between">
                    <div className="text-sm text-gray-600">
                      Source: {prompt.sourceImage} | Tags: {prompt.tags.join(', ')}
                      {prompt.seed && ` | Seed: ${prompt.seed}`}
                    </div>
                    <div className="flex gap-1">
                      {editingId === prompt._id ? (
                        <Button variant="ghost" size="sm" onClick={stopEditing}>
                          <Check className="w-4 h-4" />
                        </Button>
                      ) : (
                        <Button variant="ghost" size="sm" onClick={() => startEditing(prompt._id!)}>
                          <Edit3 className="w-4 h-4" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => deletePrompt(prompt._id!)}
                        className="text-red-600 hover:text-red-700"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                  
                  {editingId === prompt._id ? (
                    <div className="space-y-2">
                      <textarea
                        value={prompt.prompt}
                        onChange={(e) => updatePrompt(prompt._id!, 'prompt', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        rows={3}
                        maxLength={2000}
                      />
                      <div className="flex gap-2 text-xs">
                        <input
                          type="text"
                          placeholder="Source image"
                          value={prompt.sourceImage}
                          onChange={(e) => updatePrompt(prompt._id!, 'sourceImage', e.target.value)}
                          className="flex-1 px-2 py-1 border border-gray-300 rounded text-xs"
                        />
                        <input
                          type="text"
                          placeholder="Tags (comma-separated)"
                          value={prompt.tags.join(', ')}
                          onChange={(e) => updatePrompt(prompt._id!, 'tags', e.target.value.split(',').map(t => t.trim()))}
                          className="flex-1 px-2 py-1 border border-gray-300 rounded text-xs"
                        />
                        <input
                          type="number"
                          placeholder="Seed"
                          value={prompt.seed || ''}
                          onChange={(e) => updatePrompt(prompt._id!, 'seed', e.target.value ? parseInt(e.target.value) : undefined)}
                          className="w-16 px-2 py-1 border border-gray-300 rounded text-xs"
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="text-sm text-gray-900">
                      {prompt.prompt}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}