#!/usr/bin/env node

/**
 * Performance benchmark for Nano Banana Runner
 * Target: Generate 1k prompts in <200ms
 */

import { generatePrompts } from '../dist/cli.js';

// Mock image descriptors for benchmarking
const mockDescriptors = Array.from({ length: 100 }, (_, i) => ({
  path: `./test-images/image-${i}.jpg`,
  hash: `hash-${i.toString().padStart(8, '0')}`,
  width: 1024,
  height: 768,
  palette: ['#ff0000', '#00ff00', '#0000ff'],
  subjects: ['portrait', 'nature'],
  style: ['vibrant', 'bright'],
  lighting: ['natural light', 'soft light']
}));

console.log('🚀 Nano Banana Runner Performance Benchmark');
console.log(`📊 Target: Generate 1k prompts in <200ms`);
console.log(`📦 Input: ${mockDescriptors.length} mock descriptors × 10 prompts/image = 1,000 prompts\n`);

// Warm up
console.log('🔥 Warming up...');
try {
  generatePrompts(mockDescriptors.slice(0, 10), {
    maxPerImage: 1,
    seed: 42,
    maxStyleAdj: 3,
    maxLighting: 2
  });
} catch (error) {
  console.error('❌ Warm-up failed:', error.message);
  process.exit(1);
}

// Main benchmark
console.log('⏱️  Running benchmark...');
const startTime = Date.now();

try {
  const prompts = generatePrompts(mockDescriptors, {
    maxPerImage: 10,  // 100 × 10 = 1,000 prompts
    seed: 42,
    maxStyleAdj: 3,
    maxLighting: 2
  });

  const duration = Date.now() - startTime;
  const target = 200; // Target: <200ms

  console.log(`\n✅ Benchmark Results:`);
  console.log(`   Generated: ${prompts.length} prompts`);
  console.log(`   Duration: ${duration}ms`);
  console.log(`   Rate: ${Math.round(prompts.length / duration * 1000)} prompts/second`);
  console.log(`   Target: <${target}ms`);

  if (duration <= target) {
    console.log(`🎉 PASS: ${duration}ms ≤ ${target}ms target`);
    process.exit(0);
  } else {
    console.log(`🚨 FAIL: ${duration}ms > ${target}ms target`);
    process.exit(1);
  }

} catch (error) {
  console.error('❌ Benchmark failed:', error.message);
  process.exit(1);
}