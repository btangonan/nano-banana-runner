import { useState, useEffect } from "react"
import { 
  X, 
  AlertCircle, 
  CircleCheck,    // ✅ use CircleCheck (not CheckCircle)
  Info, 
  TriangleAlert   // ✅ use TriangleAlert (not AlertTriangle)
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "./Button"

// Icon mapping for variants
const ICONS = {
  default: Info,
  destructive: AlertCircle,
  success: CircleCheck,
  warning: TriangleAlert,
  close: X,
} as const

// SafeIcon wrapper to prevent crashes if any import is undefined
function SafeIcon(Comp?: React.ComponentType<any>, Fallback = Info) {
  const C = Comp ?? Fallback
  return (props: any) => <C {...props} />
}

// Dev-time warning for missing icon imports
if (import.meta.env.DEV) {
  const missing = Object.entries({ X, AlertCircle, CircleCheck, Info, TriangleAlert })
    .filter(([,v]) => !v).map(([k]) => k)
  if (missing.length) console.warn('[Toast] Missing lucide icons:', missing)
}

export interface ToastProps {
  id: string
  title: string
  description?: string
  variant?: 'default' | 'destructive' | 'success' | 'warning'
  duration?: number
}

export const Toast = ({ 
  id, 
  title, 
  description, 
  variant = 'default',
  duration = 5000,
  onClose
}: ToastProps & { onClose: (id: string) => void }) => {
  const [isVisible, setIsVisible] = useState(true)

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsVisible(false)
      setTimeout(() => onClose(id), 300) // Allow fade out animation
    }, duration)

    return () => clearTimeout(timer)
  }, [id, duration, onClose])

  const VariantIcon = SafeIcon(ICONS[variant], Info)
  const CloseIcon = SafeIcon(ICONS.close, Info)

  return (
    <div
      className={cn(
        "pointer-events-auto relative flex w-full items-center space-x-4 overflow-hidden rounded-md border p-6 pr-8 shadow-lg transition-all",
        isVisible ? "animate-in slide-in-from-right-full" : "animate-out slide-out-to-right-full",
        {
          "border bg-background text-foreground": variant === 'default',
          "destructive group border-destructive bg-destructive text-destructive-foreground": variant === 'destructive',
          "border-green-200 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-900 dark:text-green-200": variant === 'success',
          "border-orange-200 bg-orange-50 text-orange-800 dark:border-orange-800 dark:bg-orange-900 dark:text-orange-200": variant === 'warning',
        }
      )}
    >
      <VariantIcon className="h-4 w-4" />
      <div className="grid gap-1">
        <div className="text-sm font-semibold">{title}</div>
        {description && (
          <div className="text-sm opacity-90">{description}</div>
        )}
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="absolute right-2 top-2 h-6 w-6 rounded-md opacity-70 hover:opacity-100"
        onClick={() => {
          setIsVisible(false)
          setTimeout(() => onClose(id), 300)
        }}
      >
        <CloseIcon className="h-4 w-4" />
      </Button>
    </div>
  )
}

// Toast container component
export const ToastContainer = ({ toasts, onDismiss }: { 
  toasts: ToastProps[]
  onDismiss: (id: string) => void 
}) => {
  if (toasts.length === 0) return null

  return (
    <div className="fixed top-0 right-0 z-[100] flex max-h-screen w-full flex-col-reverse space-y-2 space-y-reverse p-4 sm:bottom-0 sm:right-0 sm:top-auto sm:flex-col sm:space-y-2 sm:space-y-0">
      {toasts.map((toast) => (
        <Toast
          key={toast.id}
          {...toast}
          onClose={onDismiss}
        />
      ))}
    </div>
  )
}