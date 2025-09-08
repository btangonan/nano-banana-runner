import { HTMLAttributes, forwardRef } from "react"
import { cn } from "@/lib/utils"

interface ProgressProps extends HTMLAttributes<HTMLDivElement> {
  value?: number
  max?: number
}

const Progress = forwardRef<HTMLDivElement, ProgressProps>(
  ({ className, value = 0, max = 100, ...props }, ref) => {
    const percentage = Math.min(Math.max((value / max) * 100, 0), 100)
    
    return (
      <div
        ref={ref}
        className={cn(
          "relative h-4 w-full overflow-hidden rounded-full bg-secondary",
          className
        )}
        {...props}
      >
        <div
          className="h-full w-full flex-1 bg-primary transition-transform duration-300 ease-in-out"
          style={{ transform: `translateX(-${100 - percentage}%)` }}
        />
        {/* Optional percentage text */}
        <div className="absolute inset-0 flex items-center justify-center text-xs font-medium text-primary-foreground">
          {Math.round(percentage)}%
        </div>
      </div>
    )
  }
)
Progress.displayName = "Progress"

export { Progress }