/**
 * Simple logger utility for proxy routes
 * Matches the interface expected by the analyze route
 */
export function createOperationLogger(operation: string, context?: any) {
  const prefix = `[${operation}]`;
  
  return {
    info: (data: any, message?: string) => {
      const logData = { ...context, ...data };
      console.log(`${prefix} INFO:`, message || '', logData);
    },
    
    error: (data: any, message?: string) => {
      const logData = { ...context, ...data };
      console.error(`${prefix} ERROR:`, message || '', logData);
    },
    
    debug: (data: any, message?: string) => {
      const logData = { ...context, ...data };
      if (process.env.LOG_LEVEL === 'debug') {
        console.debug(`${prefix} DEBUG:`, message || '', logData);
      }
    },
    
    warn: (data: any, message?: string) => {
      const logData = { ...context, ...data };
      console.warn(`${prefix} WARN:`, message || '', logData);
    },
  };
}