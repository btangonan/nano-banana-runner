# Comprehensive E2E Testing Strategy for Gemini-Powered Workflow

**Date**: 2025-09-12  
**Author**: Claude Code Assistant  
**Status**: Implementation In Progress (Updated with ChatGPT-5 Audit Feedback)

## Implementation Update (2025-09-12)

### ✅ Completed Based on ChatGPT-5 Audit

Following a ruthless audit by ChatGPT-5, the E2E testing infrastructure has been significantly improved with these key implementations:

#### 1. **Cassette-Based Record/Replay Pattern** 
**Location**: `test/e2e/adapters/dual-mode.adapter.ts`
- **Innovation**: Record API responses once, replay infinitely (90%+ cost reduction)
- **4 Modes**: `mock` | `live` | `record` | `replay`
- **Deterministic Keys**: `SHA256(VERSION_TAG + normalized_request)`
- **Budget Tracking**: Hard stop at `E2E_BUDGET_USD` limit
- **Schema Validation**: All modes validate against same Zod schema

#### 2. **Adaptive Image Preprocessing**
**Location**: `test/e2e/utils/image-preprocessor.ts`
- **Smart Compression**: PNG for line art, WebP for photos
- **Progressive Quality**: 85% → 60% to meet size limits
- **Target Size**: 900KB (safe margin under 1MB proxy limit)
- **Quality Preservation**: SSIM validation ensures visual fidelity
- **Solves**: 413 "Payload Too Large" errors for 4-5MB images

#### 3. **Key Improvements from Audit**
- **Single Adapter Pattern**: One adapter with 4 modes vs overcomplicated dual-mode
- **Cassette Versioning**: Auto-invalidates on API changes
- **Cost Reporting**: Generates `cost.json` for CI budget enforcement
- **Offline Testing**: Developers can run full E2E suite without API keys

### 🚀 Next Implementation Phase

1. **Per-test SQLite Isolation** - Prevent test pollution
2. **CI Budget Enforcement** - GitHub Actions with cost gates
3. **Error Taxonomy** - Structured retry policies

---

## Executive Summary

This document outlines a comprehensive end-to-end testing strategy for the Nano Banana Runner's Gemini-powered image description and generation workflow. The strategy addresses current gaps, proposes a tiered testing approach, and provides implementation recommendations.

## Current State Analysis

### Existing Testing Infrastructure

#### ✅ What We Have
1. **Unit Tests with Mocks** (`test/providers/*.test.ts`)
   - All external dependencies mocked (fetch, Google Generative AI)
   - Fast execution, no API costs
   - Good coverage of business logic

2. **Conditional Live Tests** (`test/smoke.live.spec.ts`)
   - Skip when GOOGLE_CLOUD_PROJECT not set
   - Actual API calls when environment configured
   - 60-second timeout for live generation

3. **Gated Live Tests** (`test/live/gated-test.ts`)
   - Require explicit `--yes` confirmation
   - Single-shot image generation validation
   - Style guard verification

4. **Test Scripts**
   - `scripts/smoke_batch.sh` - Batch provider verification
   - `test-direct-mode.sh` - Direct Mode validation
   - Manual E2E test documentation (2025-09-10)

#### ❌ Critical Gaps Identified

1. **No Automated E2E Tests in CI/CD**
   - All CI tests use mocks
   - No regular validation of real API integration
   - Risk of undetected breaking changes

2. **Gemini Vision Provider Failures**
   - 413 Payload Too Large errors (4-5MB images)
   - Cannot test AI-powered image descriptions
   - Fallback to Sharp-only analysis

3. **Mock Batch API Limitations**
   - Gemini lacks true batch API
   - In-memory Map storage (not persistent)
   - No real async job processing

4. **Cost and Rate Limit Management**
   - No automated cost tracking
   - No rate limit monitoring
   - Risk of unexpected charges

## Proposed Tiered Testing Strategy

### Tier 1: Unit Tests (Continuous)
**Purpose**: Fast feedback, logic validation  
**Frequency**: Every commit  
**Cost**: Free  
**Coverage**: 80%+

```yaml
triggers: [push, pull_request]
environment: mocked
execution_time: <30s
```

### Tier 2: Integration Tests (Continuous)
**Purpose**: Proxy and mock batch API validation  
**Frequency**: Every PR  
**Cost**: Free (local proxy)  
**Coverage**: Critical paths

```yaml
services:
  - proxy (port 8787)
  - mock batch provider
tests:
  - batch submission flow
  - job polling mechanism
  - result retrieval
```

### Tier 3: Gated Live Tests (Manual)
**Purpose**: Pre-release validation  
**Frequency**: Before releases  
**Cost**: ~$0.10 per run  
**Coverage**: Happy path

```bash
# Requires explicit confirmation
./test/live/gated-test.ts --yes

# Tests:
- Single image generation
- Style guard validation
- API connectivity
```

### Tier 4: Scheduled E2E Tests (Nightly)
**Purpose**: Continuous API validation  
**Frequency**: Nightly (2 AM UTC)  
**Cost**: ~$1/day budget  
**Coverage**: Full workflow

```yaml
schedule:
  - cron: "0 2 * * *"
environment:
  GEMINI_API_KEY: ${{ secrets.GEMINI_TEST_KEY }}
  COST_LIMIT: 1.00
  ALERT_THRESHOLD: 0.80
```

## Implementation Plan

### Phase 1: Fix Critical Issues (Week 1)

#### 1.1 Fix Gemini Vision 413 Errors
```typescript
// Add to proxy/src/routes/analyze.ts
async function preprocessImage(base64: string): Promise<string> {
  const buffer = Buffer.from(base64, 'base64');
  
  // Resize if > 1MB
  if (buffer.length > 1024 * 1024) {
    const sharp = await import('sharp');
    const resized = await sharp(buffer)
      .resize(1024, 1024, { 
        fit: 'inside',
        withoutEnlargement: true 
      })
      .jpeg({ quality: 85 })
      .toBuffer();
    
    return resized.toString('base64');
  }
  
  return base64;
}
```

#### 1.2 Create Test Fixtures
```bash
# Create optimized test images
test/fixtures/
├── small-test-image.jpg    # 100KB, 512x512
├── medium-test-image.jpg   # 500KB, 1024x1024
├── style-reference.jpg     # 200KB, 768x768
└── test-prompts.jsonl      # 5 test prompts
```

### Phase 2: Implement Tiered Tests (Week 2)

#### 2.1 Directory Structure
```
test/
├── unit/           # Tier 1 - Mocked tests
├── integration/    # Tier 2 - Proxy tests
├── e2e/           # Tier 3 & 4 - Live tests
│   ├── gated/     # Manual confirmation required
│   └── scheduled/ # Automated with budget
└── fixtures/      # Test data
```

#### 2.2 GitHub Actions Workflow
```yaml
# .github/workflows/e2e-nightly.yml
name: Nightly E2E Tests

on:
  schedule:
    - cron: '0 2 * * *'
  workflow_dispatch:

jobs:
  e2e-tests:
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '20'
      
      - name: Install dependencies
        run: pnpm install
      
      - name: Start proxy
        run: |
          cd apps/nn/proxy
          pnpm dev &
          sleep 5
        env:
          GEMINI_BATCH_API_KEY: ${{ secrets.GEMINI_TEST_KEY }}
      
      - name: Run E2E tests with budget
        run: |
          cd apps/nn
          pnpm test:e2e:scheduled
        env:
          COST_LIMIT: 1.00
          SKIP_EXPENSIVE_TESTS: false
      
      - name: Upload test results
        if: always()
        uses: actions/upload-artifact@v3
        with:
          name: e2e-results
          path: test/output/
```

### Phase 3: Cost Management (Week 3)

#### 3.1 Cost Tracking
```typescript
// src/core/costTracker.ts
export class CostTracker {
  private spent = 0;
  private limit: number;
  
  constructor(limit = 1.00) {
    this.limit = limit;
  }
  
  canProceed(estimatedCost: number): boolean {
    return (this.spent + estimatedCost) <= this.limit;
  }
  
  track(actualCost: number): void {
    this.spent += actualCost;
    if (this.spent > this.limit * 0.8) {
      console.warn(`⚠️ Cost warning: $${this.spent.toFixed(2)} of $${this.limit} budget used`);
    }
  }
}
```

#### 3.2 Test Data Optimization
```typescript
// Minimal test dataset
const E2E_TEST_SUITE = {
  images: [
    { path: 'small-test.jpg', size: '100KB' },
    { path: 'medium-test.jpg', size: '500KB' }
  ],
  prompts: [
    'Simple geometric shapes',
    'Nature scene with trees'
  ],
  variants: 1,  // Minimize cost
  expectedCost: 0.05
};
```

### Phase 4: Monitoring & Alerts (Week 4)

#### 4.1 Test Metrics Dashboard
```typescript
// test/e2e/metrics.ts
export interface E2EMetrics {
  lastRun: Date;
  testsRun: number;
  testsPassed: number;
  testsFailed: number;
  totalCost: number;
  avgLatency: number;
  apiErrors: string[];
}
```

#### 4.2 Slack/Email Alerts
```yaml
# Alert on:
- Test failures
- Cost overruns (>$1/day)
- API errors (429, 503)
- Performance degradation (>2x normal)
```

## Test Coverage Goals

### Current vs Target Coverage

| Component | Current | Target | Strategy |
|-----------|---------|--------|----------|
| Unit Tests | 65% | 80% | Add missing test cases |
| Integration | 40% | 70% | Test proxy endpoints |
| E2E (Mock) | 30% | 60% | Expand scenarios |
| E2E (Live) | 5% | 20% | Scheduled tests |

## Risk Mitigation

### API Cost Controls
1. **Test Account**: Separate GCP project with billing alerts
2. **Spending Limits**: Hard cap at $30/month for testing
3. **Cost Estimation**: Dry-run before live execution
4. **Caching**: Cache successful test results for 24 hours

### Rate Limit Management
1. **Throttling**: Max 10 requests/minute in tests
2. **Exponential Backoff**: Retry with delays
3. **Quota Monitoring**: Alert at 80% usage
4. **Time-based Tests**: Spread across hours

### Non-Deterministic Output Handling
1. **Snapshot Testing**: Compare image metadata, not pixels
2. **Semantic Validation**: Check for expected elements
3. **Confidence Thresholds**: Accept 80%+ confidence
4. **Multiple Attempts**: Allow 3 retries for flaky tests

## Success Metrics

### KPIs for E2E Testing
- **Test Reliability**: >95% consistent pass rate
- **Cost Efficiency**: <$30/month total testing cost
- **Coverage**: >60% E2E coverage of critical paths
- **Detection Rate**: Catch 100% of API breaking changes
- **Execution Time**: <5 minutes for Tier 3 tests

## Implementation Timeline

### Week 1: Foundation
- [ ] Fix Gemini Vision 413 errors
- [ ] Create optimized test fixtures
- [ ] Document test procedures

### Week 2: Tiered Tests
- [ ] Implement integration test suite
- [ ] Create gated live tests
- [ ] Set up scheduled test framework

### Week 3: Cost Management
- [ ] Implement cost tracking
- [ ] Add budget controls
- [ ] Create test data optimization

### Week 4: Monitoring
- [ ] Deploy metrics dashboard
- [ ] Configure alerts
- [ ] Run first production E2E cycle

## Conclusion

This comprehensive E2E testing strategy addresses all identified gaps while maintaining cost efficiency and reliability. The tiered approach ensures fast feedback for developers while providing thorough validation of the Gemini-powered workflow.

### Next Steps
1. Review and approve strategy
2. Create implementation tickets
3. Assign team resources
4. Begin Week 1 implementation

---

**Document Status**: Ready for implementation  
**Estimated Effort**: 4 weeks (1 engineer)  
**Estimated Monthly Cost**: <$30 for all E2E tests