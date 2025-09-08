import { useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { UploadAnalyze } from './pages/UploadAnalyze'
import { ToastContainer, useToast } from './components/ui/Toast'
import { cn } from './lib/utils'
import { CheckCircle, Circle, Upload } from 'lucide-react'

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
  { id: 'remix', title: 'Remix & Review', icon: Circle },
  { id: 'submit', title: 'Submit & Monitor', icon: Circle },
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
        return <div className="text-center text-muted-foreground">Remix & Review - Coming in Session 2</div>
      case 2:
        return <div className="text-center text-muted-foreground">Submit & Monitor - Coming in Session 3</div>
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