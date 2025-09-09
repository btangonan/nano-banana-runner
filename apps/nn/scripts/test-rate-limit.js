#!/usr/bin/env node
/**
 * Rate Limit Flood Test Script
 * Tests global and route-specific rate limiting
 */

const PROXY_URL = process.env.PROXY_URL || 'http://127.0.0.1:8787';
const TEST_DURATION_MS = 70000; // 70 seconds to test minute window

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function makeRequest(endpoint, method = 'GET', body = null) {
  try {
    const options = {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Test-Client': 'rate-limit-test'
      }
    };
    
    if (body) {
      options.body = JSON.stringify(body);
    }
    
    const response = await fetch(`${PROXY_URL}${endpoint}`, options);
    return {
      status: response.status,
      ok: response.ok,
      headers: Object.fromEntries(response.headers.entries())
    };
  } catch (error) {
    return {
      status: 0,
      ok: false,
      error: error.message
    };
  }
}

async function testGlobalLimit() {
  console.log('\n🧪 Testing Global Rate Limit (100 req/min)...');
  const results = { success: 0, rateLimited: 0, errors: 0 };
  
  // Send 110 requests rapidly
  const promises = [];
  for (let i = 0; i < 110; i++) {
    promises.push(makeRequest('/ui/preflight'));
  }
  
  const responses = await Promise.all(promises);
  
  responses.forEach(res => {
    if (res.status === 200) results.success++;
    else if (res.status === 429) results.rateLimited++;
    else results.errors++;
  });
  
  console.log(`  ✅ Success: ${results.success}`);
  console.log(`  🚫 Rate Limited (429): ${results.rateLimited}`);
  console.log(`  ❌ Errors: ${results.errors}`);
  
  const passed = results.success <= 100 && results.rateLimited > 0;
  console.log(`  ${passed ? '✅ PASSED' : '❌ FAILED'}: Global limit enforced`);
  
  return passed;
}

async function testBatchLimit() {
  console.log('\n🧪 Testing Batch Submit Rate Limit (5 req/5min)...');
  const results = { success: 0, rateLimited: 0, errors: 0 };
  
  // Send 7 batch submit requests
  for (let i = 0; i < 7; i++) {
    const res = await makeRequest('/batch/submit', 'POST', {
      prompts: [{ text: `test prompt ${i}` }],
      refs: [],
      provider: 'mock'
    });
    
    if (res.status === 200 || res.status === 201) results.success++;
    else if (res.status === 429) results.rateLimited++;
    else results.errors++;
    
    await sleep(100); // Small delay between requests
  }
  
  console.log(`  ✅ Success: ${results.success}`);
  console.log(`  🚫 Rate Limited (429): ${results.rateLimited}`);
  console.log(`  ❌ Errors: ${results.errors}`);
  
  const passed = results.success <= 5 && results.rateLimited >= 2;
  console.log(`  ${passed ? '✅ PASSED' : '❌ FAILED'}: Batch limit enforced`);
  
  return passed;
}

async function testHealthExemption() {
  console.log('\n🧪 Testing Health Check Exemption...');
  const results = { success: 0, rateLimited: 0, errors: 0 };
  
  // Send 200 health check requests (should all pass)
  const promises = [];
  for (let i = 0; i < 200; i++) {
    promises.push(makeRequest('/healthz'));
  }
  
  const responses = await Promise.all(promises);
  
  responses.forEach(res => {
    if (res.status === 200) results.success++;
    else if (res.status === 429) results.rateLimited++;
    else results.errors++;
  });
  
  console.log(`  ✅ Success: ${results.success}`);
  console.log(`  🚫 Rate Limited (429): ${results.rateLimited}`);
  console.log(`  ❌ Errors: ${results.errors}`);
  
  const passed = results.success === 200 && results.rateLimited === 0;
  console.log(`  ${passed ? '✅ PASSED' : '❌ FAILED'}: Health check exempt from limits`);
  
  return passed;
}

async function testRateLimitHeaders() {
  console.log('\n🧪 Testing Rate Limit Headers...');
  
  const res = await makeRequest('/ui/preflight');
  
  const hasHeaders = 
    res.headers['x-ratelimit-limit'] !== undefined &&
    res.headers['x-ratelimit-remaining'] !== undefined &&
    res.headers['x-ratelimit-reset'] !== undefined;
  
  if (hasHeaders) {
    console.log(`  ✅ PASSED: Rate limit headers present`);
    console.log(`    Limit: ${res.headers['x-ratelimit-limit']}`);
    console.log(`    Remaining: ${res.headers['x-ratelimit-remaining']}`);
    console.log(`    Reset: ${res.headers['x-ratelimit-reset']}`);
  } else {
    console.log(`  ❌ FAILED: Rate limit headers missing`);
  }
  
  return hasHeaders;
}

async function main() {
  console.log('🚀 Rate Limit Test Suite');
  console.log(`📍 Testing against: ${PROXY_URL}`);
  console.log('⏱️  This will take about 70 seconds...\n');
  
  // Check if proxy is running
  const health = await makeRequest('/healthz');
  if (!health.ok) {
    console.error('❌ Proxy is not running! Start it with: cd apps/nn/proxy && pnpm dev');
    process.exit(1);
  }
  
  const results = [];
  
  // Run tests
  results.push(await testHealthExemption());
  await sleep(2000); // Reset window
  
  results.push(await testGlobalLimit());
  await sleep(61000); // Wait for rate limit window to reset
  
  results.push(await testBatchLimit());
  results.push(await testRateLimitHeaders());
  
  // Summary
  console.log('\n' + '='.repeat(50));
  console.log('📊 Test Summary');
  console.log('='.repeat(50));
  
  const passed = results.filter(r => r).length;
  const total = results.length;
  
  console.log(`  Total: ${passed}/${total} tests passed`);
  
  if (passed === total) {
    console.log('  🎉 All tests passed! Rate limiting is working correctly.');
    process.exit(0);
  } else {
    console.log('  ⚠️  Some tests failed. Review the configuration.');
    process.exit(1);
  }
}

// Handle errors
process.on('unhandledRejection', (err) => {
  console.error('❌ Unhandled error:', err);
  process.exit(1);
});

// Run tests
main().catch(err => {
  console.error('❌ Test suite failed:', err);
  process.exit(1);
});