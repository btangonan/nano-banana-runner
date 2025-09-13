import { FastifyInstance } from 'fastify';

/**
 * Simple in-memory metrics collector
 */
export class MetricsCollector {
  private requestCounts: Map<string, number> = new Map();
  private responseTimes: Map<string, number[]> = new Map();
  private errorCounts: Map<string, number> = new Map();
  private startTime: number = Date.now();
  
  /**
   * Record a request
   */
  recordRequest(route: string, method: string) {
    const key = `${method}:${route}`;
    this.requestCounts.set(key, (this.requestCounts.get(key) || 0) + 1);
  }
  
  /**
   * Record response time
   */
  recordResponseTime(route: string, method: string, timeMs: number) {
    const key = `${method}:${route}`;
    const times = this.responseTimes.get(key) || [];
    times.push(timeMs);
    
    // Keep only last 100 samples per route
    if (times.length > 100) {
      times.shift();
    }
    
    this.responseTimes.set(key, times);
  }
  
  /**
   * Record an error
   */
  recordError(route: string, method: string, statusCode: number) {
    const key = `${method}:${route}:${statusCode}`;
    this.errorCounts.set(key, (this.errorCounts.get(key) || 0) + 1);
  }
  
  /**
   * Get metrics summary
   */
  getSummary() {
    const uptime = Math.floor((Date.now() - this.startTime) / 1000);
    
    // Calculate response time percentiles
    const percentiles: Record<string, any> = {};
    for (const [key, times] of this.responseTimes.entries()) {
      if (times.length > 0) {
        const sorted = [...times].sort((a, b) => a - b);
        percentiles[key] = {
          p50: sorted[Math.floor(sorted.length * 0.5)],
          p95: sorted[Math.floor(sorted.length * 0.95)],
          p99: sorted[Math.floor(sorted.length * 0.99)],
          avg: times.reduce((a, b) => a + b, 0) / times.length
        };
      }
    }
    
    // Count total requests and errors
    const totalRequests = Array.from(this.requestCounts.values())
      .reduce((a, b) => a + b, 0);
    const totalErrors = Array.from(this.errorCounts.values())
      .reduce((a, b) => a + b, 0);
    
    return {
      uptime,
      requests: {
        total: totalRequests,
        byRoute: Object.fromEntries(this.requestCounts)
      },
      errors: {
        total: totalErrors,
        byType: Object.fromEntries(this.errorCounts)
      },
      responseTimes: percentiles,
      errorRate: totalRequests > 0 ? (totalErrors / totalRequests) * 100 : 0
    };
  }
  
  /**
   * Reset metrics
   */
  reset() {
    this.requestCounts.clear();
    this.responseTimes.clear();
    this.errorCounts.clear();
    this.startTime = Date.now();
  }
}

/**
 * Register metrics collection hooks
 */
export function registerMetrics(app: FastifyInstance, collector: MetricsCollector) {
  // Hook into request lifecycle
  app.addHook('onRequest', async (request, reply) => {
    // Store start time
    (request as any).startTime = Date.now();
  });
  
  app.addHook('onResponse', async (request, reply) => {
    const startTime = (request as any).startTime;
    const responseTime = startTime ? Date.now() - startTime : 0;
    
    // Record metrics
    collector.recordRequest(request.routerPath || request.url, request.method);
    collector.recordResponseTime(
      request.routerPath || request.url, 
      request.method, 
      responseTime
    );
    
    // Record errors
    if (reply.statusCode >= 400) {
      collector.recordError(
        request.routerPath || request.url,
        request.method,
        reply.statusCode
      );
    }
  });
  
  // Add metrics endpoint
  app.get('/metrics', async (request, reply) => {
    return collector.getSummary();
  });
}

// Export singleton instance
export const metrics = new MetricsCollector();