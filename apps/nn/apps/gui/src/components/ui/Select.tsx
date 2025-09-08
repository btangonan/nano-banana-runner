import { 
  ReactNode, 
  useState, 
  useRef, 
  useEffect,
  HTMLAttributes,
  forwardRef,
  createContext,
  useContext 
} from "react"
import { cn } from "@/lib/utils"
import { ChevronDown, Check } from "lucide-react"

interface SelectContextType {
  value?: string
  onValueChange?: (value: string) => void
  open: boolean
  setOpen: (open: boolean) => void
}

const SelectContext = createContext<SelectContextType | null>(null)

interface SelectProps {
  value?: string
  onValueChange?: (value: string) => void
  children: ReactNode
}

const Select = ({ value, onValueChange, children }: SelectProps) => {
  const [open, setOpen] = useState(false)

  return (
    <SelectContext.Provider value={{ value, onValueChange, open, setOpen }}>
      <div className="relative">
        {children}
      </div>
    </SelectContext.Provider>
  )
}

interface SelectTriggerProps extends HTMLAttributes<HTMLButtonElement> {
  children: ReactNode
}

const SelectTrigger = forwardRef<HTMLButtonElement, SelectTriggerProps>(
  ({ className, children, ...props }, ref) => {
    const context = useContext(SelectContext)
    if (!context) throw new Error("SelectTrigger must be used within Select")

    const { open, setOpen } = context

    return (
      <button
        type="button"
        role="combobox"
        aria-expanded={open}
        className={cn(
          "flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        onClick={() => setOpen(!open)}
        ref={ref}
        {...props}
      >
        {children}
        <ChevronDown className="h-4 w-4 opacity-50" />
      </button>
    )
  }
)
SelectTrigger.displayName = "SelectTrigger"

interface SelectValueProps extends HTMLAttributes<HTMLSpanElement> {
  placeholder?: string
}

const SelectValue = ({ placeholder, className, ...props }: SelectValueProps) => {
  const context = useContext(SelectContext)
  if (!context) throw new Error("SelectValue must be used within Select")

  const { value } = context

  return (
    <span
      className={cn("block truncate", className)}
      {...props}
    >
      {value || placeholder}
    </span>
  )
}

interface SelectContentProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode
}

const SelectContent = forwardRef<HTMLDivElement, SelectContentProps>(
  ({ className, children, ...props }, ref) => {
    const context = useContext(SelectContext)
    if (!context) throw new Error("SelectContent must be used within Select")

    const { open, setOpen } = context
    const contentRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
      const handleClickOutside = (event: MouseEvent) => {
        if (contentRef.current && !contentRef.current.contains(event.target as Node)) {
          setOpen(false)
        }
      }

      if (open) {
        document.addEventListener('mousedown', handleClickOutside)
        return () => document.removeEventListener('mousedown', handleClickOutside)
      }
    }, [open, setOpen])

    if (!open) return null

    return (
      <div
        ref={contentRef}
        className={cn(
          "absolute top-full z-50 w-full mt-1 max-h-60 overflow-auto rounded-md border bg-popover text-popover-foreground shadow-md",
          className
        )}
        {...props}
      >
        {children}
      </div>
    )
  }
)
SelectContent.displayName = "SelectContent"

interface SelectItemProps extends HTMLAttributes<HTMLDivElement> {
  value: string
  children: ReactNode
}

const SelectItem = forwardRef<HTMLDivElement, SelectItemProps>(
  ({ className, value, children, ...props }, ref) => {
    const context = useContext(SelectContext)
    if (!context) throw new Error("SelectItem must be used within Select")

    const { value: selectedValue, onValueChange, setOpen } = context
    const isSelected = selectedValue === value

    const handleClick = () => {
      onValueChange?.(value)
      setOpen(false)
    }

    return (
      <div
        role="option"
        aria-selected={isSelected}
        className={cn(
          "relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
          className
        )}
        onClick={handleClick}
        ref={ref}
        {...props}
      >
        <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
          {isSelected && <Check className="h-4 w-4" />}
        </span>
        {children}
      </div>
    )
  }
)
SelectItem.displayName = "SelectItem"

export { Select, SelectTrigger, SelectValue, SelectContent, SelectItem }