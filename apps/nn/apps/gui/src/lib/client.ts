import { z } from "zod";
import type { Problem } from "./contracts.js";

/**
 * Typed API client with Zod validation and error handling
 */
class ApiClient {
  private baseUrl: string;

  constructor(baseUrl = '') {
    this.baseUrl = baseUrl;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit,
    responseSchema: z.ZodSchema<T>
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    
    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...options.headers,
        },
      });

      const data = await response.json();

      if (!response.ok) {
        // Handle Problem+JSON errors
        if (response.status >= 400 && data.type && data.title) {
          throw new ApiError(data as Problem);
        }
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      // Validate response with Zod
      const validated = responseSchema.safeParse(data);
      if (!validated.success) {
        console.error('Response validation failed:', validated.error);
        throw new Error('Invalid response format from server');
      }

      return validated.data;
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      
      // Network or other errors
      console.error('API request failed:', error);
      throw new Error(
        error instanceof Error ? error.message : 'Network request failed'
      );
    }
  }

  async get<T>(endpoint: string, schema: z.ZodSchema<T>): Promise<T> {
    return this.request(endpoint, { method: 'GET' }, schema);
  }

  async post<T>(
    endpoint: string,
    data: unknown,
    schema: z.ZodSchema<T>
  ): Promise<T> {
    return this.request(endpoint, {
      method: 'POST',
      body: JSON.stringify(data),
    }, schema);
  }

  async postFormData<T>(
    endpoint: string,
    formData: FormData,
    schema: z.ZodSchema<T>
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    
    try {
      const response = await fetch(url, {
        method: 'POST',
        body: formData, // Don't set Content-Type for FormData
      });

      const data = await response.json();

      if (!response.ok) {
        if (response.status >= 400 && data.type && data.title) {
          throw new ApiError(data as Problem);
        }
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const validated = schema.safeParse(data);
      if (!validated.success) {
        console.error('Response validation failed:', validated.error);
        throw new Error('Invalid response format from server');
      }

      return validated.data;
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      
      console.error('API request failed:', error);
      throw new Error(
        error instanceof Error ? error.message : 'Network request failed'
      );
    }
  }
}

/**
 * Custom error class for RFC 7807 Problem+JSON errors
 */
export class ApiError extends Error {
  public readonly problem: Problem;

  constructor(problem: Problem) {
    super(problem.title);
    this.name = 'ApiError';
    this.problem = problem;
  }

  get detail(): string | undefined {
    return this.problem.detail;
  }

  get status(): number {
    return this.problem.status;
  }

  get type(): string {
    return this.problem.type;
  }

  get instance(): string {
    return this.problem.instance;
  }
}

// Export singleton client
export const apiClient = new ApiClient();