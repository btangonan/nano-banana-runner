import { describe, it, expect } from 'vitest';
import { sha256, generateIdempotencyKey as createIdempotencyKey, normalizeForKey as normalize } from '../../src/core/idempotency.js';

describe('Idempotency Module', () => {
  describe('sha256', () => {
    it('should generate consistent hash for same input', () => {
      const input = 'test string';
      const hash1 = sha256(input);
      const hash2 = sha256(input);
      
      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^[a-f0-9]{64}$/);
    });
    
    it('should generate different hashes for different inputs', () => {
      const hash1 = sha256('input1');
      const hash2 = sha256('input2');
      
      expect(hash1).not.toBe(hash2);
    });
    
    it('should handle empty string', () => {
      const hash = sha256('');
      expect(hash).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    });
    
    it('should handle unicode characters', () => {
      const hash = sha256('Hello 世界 🌍');
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });
  });
  
  describe('normalize', () => {
    it('should normalize text consistently', () => {
      const text1 = '  Hello   WORLD!  ';
      const text2 = 'hello world';
      
      const norm1 = normalize(text1);
      const norm2 = normalize(text2);
      
      expect(norm1).toBe(norm2);
      expect(norm1).toBe('hello world');
    });
    
    it('should remove special characters', () => {
      const text = 'Hello@#$% World!!!';
      const normalized = normalize(text);
      
      expect(normalized).toBe('hello world');
    });
    
    it('should collapse multiple spaces', () => {
      const text = 'hello     world     test';
      const normalized = normalize(text);
      
      expect(normalized).toBe('hello world test');
    });
    
    it('should handle empty string', () => {
      const normalized = normalize('');
      expect(normalized).toBe('');
    });
  });
  
  describe('generateIdempotencyKey', () => {
    it('should create consistent key for same inputs', () => {
      const prompt = 'test prompt';
      const sourceImage = 'image1.jpg';
      const date = new Date('2024-01-01');
      
      const key1 = createIdempotencyKey(prompt, sourceImage, date);
      const key2 = createIdempotencyKey(prompt, sourceImage, date);
      
      expect(key1).toBe(key2);
      expect(key1).toMatch(/^[a-f0-9]{64}$/);
    });
    
    it('should create different keys for different prompts', () => {
      const sourceImage = 'image1.jpg';
      const date = new Date('2024-01-01');
      
      const key1 = createIdempotencyKey('prompt1', sourceImage, date);
      const key2 = createIdempotencyKey('prompt2', sourceImage, date);
      
      expect(key1).not.toBe(key2);
    });
    
    it('should create different keys for different source images', () => {
      const prompt = 'test prompt';
      const date = new Date('2024-01-01');
      
      const key1 = createIdempotencyKey(prompt, 'image1.jpg', date);
      const key2 = createIdempotencyKey(prompt, 'image2.jpg', date);
      
      expect(key1).not.toBe(key2);
    });
    
    it('should create different keys for different dates', () => {
      const prompt = 'test prompt';
      const sourceImage = 'image1.jpg';
      
      const key1 = createIdempotencyKey(prompt, sourceImage, new Date('2024-01-01'));
      const key2 = createIdempotencyKey(prompt, sourceImage, new Date('2024-01-02'));
      
      expect(key1).not.toBe(key2);
    });
  });
});