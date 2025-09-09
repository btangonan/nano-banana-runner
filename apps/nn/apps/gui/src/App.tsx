import { useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { UploadAnalyze } from './pages/UploadAnalyze'
import { RemixReview } from './pages/RemixReview'
import { SubmitMonitor } from './pages/SubmitMonitor'
import { Gallery } from './pages/Gallery'
import { ToastContainer } from './components/ui/Toast'
import { useToast } from './hooks/useToast'
import { cn } from './lib/utils'
import { CheckCircle, Upload, Shuffle, Send, Eye } from 'lucide-react'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})

const steps = [
  { id: 'upload', title: 'Upload & Analyze', icon: Upload },
  { id: 'remix', title: 'Remix & Review', icon: Shuffle },
  { id: 'submit', title: 'Submit & Monitor', icon: Send },
  { id: 'gallery', title: 'View Gallery', icon: Eye },
]

function App() {
  const [currentStep, setCurrentStep] = useState(0)
  const { toasts, toast, dismiss } = useToast()

  const StepIndicator = () => (
    <div className="flex items-center justify-center space-x-8 mb-8">
      {steps.map((step, index) => {
        const Icon = step.icon
        const isActive = index === currentStep
        const isCompleted = index < currentStep
        
        return (
          <div key={step.id} className="flex items-center">
            <div className={cn(
              "flex items-center justify-center w-10 h-10 rounded-full border-2 transition-colors",
              isCompleted && "bg-primary border-primary text-primary-foreground",
              isActive && !isCompleted && "border-primary text-primary",
              !isActive && !isCompleted && "border-muted-foreground text-muted-foreground"
            )}>
              {isCompleted ? (
                <CheckCircle className="w-5 h-5" />
              ) : (
                <Icon className="w-5 h-5" />
              )}
            </div>
            <div className={cn(
              "ml-3 text-sm font-medium transition-colors",
              isCompleted && "text-primary",
              isActive && !isCompleted && "text-foreground",
              !isActive && !isCompleted && "text-muted-foreground"
            )}>
              {step.title}
            </div>
            {index < steps.length - 1 && (
              <div className={cn(
                "w-16 h-px mx-8 transition-colors",
                index < currentStep ? "bg-primary" : "bg-border"
              )} />
            )}
          </div>
        )
      })}
    </div>
  )

  const renderCurrentStep = () => {
    switch (currentStep) {
      case 0:
        return <UploadAnalyze onNext={() => setCurrentStep(1)} toast={toast} />
      case 1:
        return <RemixReview 
          onNext={() => setCurrentStep(2)} 
          onBack={() => setCurrentStep(0)} 
          toast={toast} 
        />
      case 2:
        return <SubmitMonitor
          onNext={() => setCurrentStep(3)}
          onBack={() => setCurrentStep(1)}
          toast={toast}
        />
      case 3:
        return <Gallery
          onBack={() => setCurrentStep(2)}
          toast={toast}
        />
      default:
        return null
    }
  }

  return (
    <QueryClientProvider client={queryClient}>
      <div className="min-h-screen bg-background">
        <div className="container mx-auto py-8 px-4">
          <header className="text-center mb-12">
            <h1 className="text-4xl font-bold text-foreground mb-2">
              Nano Banana Studio
            </h1>
            <p className="text-lg text-muted-foreground">
              Image analyzer → prompt remixer → Gemini generator
            </p>
          </header>

          <StepIndicator />
          
          <main className="max-w-4xl mx-auto">
            {renderCurrentStep()}
          </main>
        </div>
        
        <ToastContainer toasts={toasts} onDismiss={dismiss} />
      </div>
    </QueryClientProvider>
  )
}

export default App