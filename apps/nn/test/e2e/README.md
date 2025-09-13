# E2E Testing Infrastructure

**Last Updated**: 2025-09-12  
**Status**: Implementation Complete (Based on ChatGPT-5 Audit)

## Overview

This E2E testing infrastructure implements a sophisticated **cassette-based record/replay pattern** that reduces API costs by 90%+ while maintaining test reliability and determinism. The system was designed based on ruthless feedback from ChatGPT-5's audit of our testing strategy.

## Key Innovation: 4-Mode Test Adapter

The heart of the system is a single adapter (`adapters/dual-mode.adapter.ts`) that supports four distinct testing modes:

### Testing Modes

| Mode | Description | API Calls | Cost | Use Case |
|------|-------------|-----------|------|----------|
| **mock** | Uses existing mock implementations | No | Free | Unit testing |
| **record** | Calls real API, saves responses | Yes | Paid | Creating cassettes |
| **replay** | Uses saved cassettes | No | Free | PR validation |
| **live** | Direct API calls with tracking | Yes | Paid | Release testing |

### Mode Selection

```bash
# Set via environment variable
export E2E_MODE=replay  # Default: mock

# Or inline with test command
E2E_MODE=record pnpm test:e2e
```

## Cassette Pattern Explained

### What are Cassettes?

Cassettes are recorded API responses stored as JSON files. They enable:
- **Deterministic Testing**: Same input always produces same output
- **Offline Testing**: Run full E2E suite without API keys
- **Cost Reduction**: Record once, replay infinitely
- **Version Control**: Track API changes over time

### How Cassettes Work

1. **Recording Phase** (`E2E_MODE=record`):
   ```
   Test Request → Real API → Response → Save as Cassette → Return to Test
   ```

2. **Replay Phase** (`E2E_MODE=replay`):
   ```
   Test Request → Generate Key → Load Cassette → Return to Test
   ```

### Cassette Key Generation

Cassettes use deterministic keys based on request content:

```typescript
key = SHA256(VERSION_TAG + normalized_request)
```

- **VERSION_TAG**: API version (e.g., `gemini-2.5-flash-image-preview@2025-09`)
- **Normalized Request**: Truncated strings, redacted auth, sorted keys
- **Result**: Same request always maps to same cassette file

## Directory Structure

```
test/e2e/
├── adapters/
│   ├── dual-mode.adapter.ts      # 4-mode test adapter
│   └── dual-mode.adapter.spec.ts # Adapter tests
├── fixtures/
│   ├── recordings/                # Cassette storage
│   │   ├── a1b2c3...json         # Recorded API response
│   │   └── d4e5f6...json         # Another cassette
│   └── test-images/              # Test image files
├── utils/
│   ├── image-preprocessor.ts     # Adaptive compression
│   └── cost-tracker.ts          # Budget tracking
├── .artifacts/
│   └── cost.json                 # Cost report
└── README.md                     # This file
```

## Environment Configuration

```bash
# Core Settings
E2E_MODE=replay                    # Testing mode (mock|live|record|replay)
E2E_BUDGET_USD=0.50               # Max spend per test run
E2E_VERSION_TAG=gemini-2.5-flash-image-preview@2025-09

# Paths
E2E_CASSETTES_DIR=test/e2e/fixtures/recordings
E2E_COST_REPORT_PATH=test/e2e/.artifacts/cost.json

# Optional
E2E_MAX_PARALLEL=3                # Parallel test execution
E2E_TIMEOUT_MS=30000             # Test timeout
```

## Running Tests

### First Time Setup

```bash
# 1. Install dependencies
pnpm install

# 2. Create test directories
mkdir -p test/e2e/fixtures/recordings
mkdir -p test/e2e/.artifacts

# 3. Record initial cassettes (requires API key)
GEMINI_API_KEY=your-key E2E_MODE=record pnpm test:e2e

# 4. Verify cassettes created
ls test/e2e/fixtures/recordings/
```

### Daily Development

```bash
# Use replay mode (no API calls, no costs)
E2E_MODE=replay pnpm test:e2e

# This uses recorded cassettes - fast and free!
```

### Updating Cassettes

```bash
# When API changes or new tests added
E2E_MODE=record E2E_BUDGET_USD=2.00 pnpm test:e2e

# Commit new cassettes
git add test/e2e/fixtures/recordings/
git commit -m "test: update cassettes for new API version"
```

### CI/CD Pipeline

```yaml
# .github/workflows/test.yml
- name: E2E Tests (Replay)
  run: E2E_MODE=replay pnpm test:e2e
  
# Nightly job to refresh cassettes
- name: E2E Tests (Record)
  if: github.event.schedule == '0 2 * * *'
  run: E2E_MODE=record E2E_BUDGET_USD=5.00 pnpm test:e2e
  env:
    GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
```

## Image Preprocessing (413 Error Solution)

Large images (4-5MB) that exceed proxy payload limits are automatically preprocessed:

### Adaptive Preprocessing Features

```typescript
import { preprocessForGemini } from './utils/image-preprocessor';

const result = await preprocessForGemini(largeImage, {
  maxSizeBytes: 900 * 1024,      // Target <900KB
  maxEdgePixels: 1400,            // Resize if larger
  preserveFormat: false           // Allow format conversion
});
```

**Smart Decisions**:
- Images <300KB pass through unchanged
- PNG preserved for line art/diagrams
- WebP used for photos (better compression)
- Progressive quality reduction: 85% → 60%
- SSIM validation ensures quality >0.85

### Example Usage

```typescript
// In your test
const processed = await preprocessForGemini(testImage);
const response = await adapter.analyzeImage(processed.buffer);

console.log(`Compressed from ${processed.originalSize} to ${processed.processedSize}`);
console.log(`Compression ratio: ${processed.compressionRatio}`);
```

## Budget Management

### Cost Tracking

The adapter automatically tracks costs:

```typescript
const adapter = new GeminiTestAdapter('live');

// Check budget before operations
if (!adapter.canSpend(0.05)) {
  throw new Error('Budget exceeded');
}

// Track actual spend
adapter.track(0.0025);  // $0.0025 per image

// Get report
const report = adapter.getCostReport();
console.log(`Spent: $${report.spentUSD}`);
```

### Cost Report

After each test run, check `test/e2e/.artifacts/cost.json`:

```json
{
  "spentUSD": 0.42,
  "requestCount": 168,
  "mode": "live",
  "timestamp": "2025-09-12T10:30:00Z"
}
```

### CI Budget Enforcement

```bash
# In CI pipeline
spent=$(jq -r '.spentUSD' test/e2e/.artifacts/cost.json)
if (( $(echo "$spent > 1.00" | bc -l) )); then
  echo "Budget exceeded: $spent"
  exit 1
fi
```

## Writing E2E Tests

### Basic Test Structure

```typescript
import { GeminiTestAdapter } from './adapters/dual-mode.adapter';
import { preprocessForGemini } from './utils/image-preprocessor';

describe('Image Analysis E2E', () => {
  let adapter: GeminiTestAdapter;
  
  beforeEach(() => {
    adapter = new GeminiTestAdapter();  // Uses E2E_MODE env
  });
  
  afterEach(async () => {
    await adapter.saveCostReport();
  });
  
  it('should analyze image with Gemini Vision', async () => {
    // Load and preprocess test image
    const image = await readFile('test-image.jpg');
    const processed = await preprocessForGemini(image);
    
    // Analyze with adapter (mode-aware)
    const result = await adapter.analyzeImage(processed.buffer);
    
    // Validate result
    expect(result.objects).toContain('expected-object');
    expect(result.confidence).toBeGreaterThan(0.8);
  });
});
```

### Testing Different Modes

```typescript
describe('Mode-specific tests', () => {
  it('should work in all modes', async () => {
    // This test works identically in all 4 modes
    // thanks to consistent schema validation
    
    const adapter = new GeminiTestAdapter();
    const result = await adapter.generateImage('test prompt');
    
    expect(result).toMatchSchema(GeminiResponseSchema);
  });
});
```

## Best Practices

### DO ✅

1. **Record Cassettes Carefully**
   - Use a dedicated test account
   - Record with minimal test data
   - Review cassettes before committing

2. **Version Your Cassettes**
   - Update VERSION_TAG when API changes
   - Re-record cassettes after API updates
   - Keep cassettes in version control

3. **Monitor Costs**
   - Set reasonable E2E_BUDGET_USD limits
   - Check cost reports regularly
   - Use replay mode for development

4. **Preprocess Images**
   - Always use preprocessForGemini() for large images
   - Validate SSIM if quality matters
   - Test with various image formats

### DON'T ❌

1. **Don't Commit Secrets**
   - Cassettes are sanitized but double-check
   - Never commit API keys
   - Review cassettes for PII

2. **Don't Ignore Failures**
   - Cassette validation errors mean API changed
   - Budget exceeded means review test scope
   - Schema failures indicate breaking changes

3. **Don't Skip Preprocessing**
   - Large images will fail with 413
   - Always preprocess before Vision API
   - Test preprocessing separately

## Troubleshooting

### "Cassette not found"
```bash
# Run in record mode to create cassettes
E2E_MODE=record pnpm test:e2e
```

### "Budget exceeded"
```bash
# Increase budget for this run
E2E_MODE=live E2E_BUDGET_USD=5.00 pnpm test:e2e
```

### "Invalid cassette schema"
```bash
# API changed, re-record cassettes
rm -rf test/e2e/fixtures/recordings/
E2E_MODE=record pnpm test:e2e
```

### "413 Payload Too Large"
```typescript
// Always preprocess images
const processed = await preprocessForGemini(image);
```

## Migration Guide

### From Mock-Only Tests

```typescript
// Before: Mock only
const mockAPI = { call: jest.fn() };
mockAPI.call.mockResolvedValue(mockResponse);

// After: 4-mode compatible
const adapter = new GeminiTestAdapter();
const result = await adapter.callAPI(request);
// Works in mock, live, record, and replay modes!
```

### From Live-Only Tests

```typescript
// Before: Always calls API
const response = await fetch(GEMINI_API_URL, { ... });

// After: Mode-aware
const adapter = new GeminiTestAdapter();
const response = await adapter.callAPI(request);
// Only calls API in live/record modes
```

## Performance Benchmarks

| Operation | Mock | Replay | Record | Live |
|-----------|------|--------|--------|------|
| Single test | 5ms | 10ms | 2000ms | 2000ms |
| 100 tests | 500ms | 1s | 200s | 200s |
| API calls | 0 | 0 | 100 | 100 |
| Cost | $0 | $0 | $0.25 | $0.25 |

## Contributing

1. **Adding New Tests**: Write mode-agnostic tests using the adapter
2. **Updating Cassettes**: Record with minimal test data
3. **Fixing Failures**: Check if cassettes need updating
4. **Performance**: Use replay mode for fast feedback

## References

- [ChatGPT-5 Audit Feedback](../../docs/testing/E2E_TESTING_STRATEGY.md)
- [Adaptive Image Preprocessing](./utils/image-preprocessor.ts)
- [Dual-Mode Adapter](./adapters/dual-mode.adapter.ts)
- [Main Documentation](../../CLAUDE.md#testing-strategy)

---

**Remember**: The cassette pattern transforms expensive, slow, non-deterministic API tests into free, fast, deterministic ones. Record once, replay forever! 🎬