import { type ClassValue, clsx } from "clsx"

/**
 * Utility to merge Tailwind classes with proper precedence
 */
export function cn(...inputs: ClassValue[]) {
  return clsx(inputs)
}

/**
 * Format file size in human readable format
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes'
  
  const k = 1024
  const sizes = ['Bytes', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

/**
 * Format duration string to human readable
 */
export function formatDuration(duration: string): string {
  const match = duration.match(/^(\d+\.?\d*)([smh])$/)
  if (!match) return duration
  
  const [, value, unit] = match
  const num = parseFloat(value)
  
  switch (unit) {
    case 's':
      return num < 60 ? `${num}s` : `${Math.round(num / 60)}m ${Math.round(num % 60)}s`
    case 'm':
      return `${num}m`
    case 'h':
      return `${num}h`
    default:
      return duration
  }
}

/**
 * Debounce function for input handling
 */
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout | null = null
  
  return (...args: Parameters<T>) => {
    if (timeout) clearTimeout(timeout)
    timeout = setTimeout(() => func(...args), wait)
  }
}

/**
 * Validate if file is a supported image type
 */
export function isValidImageFile(file: File): boolean {
  const validTypes = ['image/jpeg', 'image/png', 'image/webp']
  const validExtensions = ['.jpg', '.jpeg', '.png', '.webp']
  
  const hasValidType = validTypes.includes(file.type)
  const hasValidExtension = validExtensions.some(ext => 
    file.name.toLowerCase().endsWith(ext)
  )
  
  return hasValidType && hasValidExtension
}

/**
 * Create a safe filename by removing potentially dangerous characters
 */
export function sanitizeFilename(filename: string): string {
  return filename
    .replace(/[^a-zA-Z0-9.-]/g, '_')
    .replace(/__+/g, '_')
    .replace(/^_+|_+$/g, '')
}