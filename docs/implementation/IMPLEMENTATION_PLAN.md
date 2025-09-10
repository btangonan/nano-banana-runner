# Nano Banana Runner - Implementation Plan

## Overview
**Status**: ✅ Phase 1 Complete - Batch-First Architecture with Guardrails  
**Next**: Phase 2 - Core Implementation (remix, GUI, CSV ops)

## Phase 1: Batch-First Architecture ✅ COMPLETE

### Architecture Goals ✅
- Gemini Batch API as primary provider (not Vertex AI direct)
- Secure proxy pattern with server-side API key management
- Comprehensive cost controls and safety guardrails
- Vertex AI as fallback for sync operations when needed
- Provider factory pattern for unified interface

### Implementation Complete ✅

#### 1. Provider Architecture ✅
- **Provider Factory** (`src/adapters/providerFactory.ts`):
  - Unified interface abstracting async batch vs sync vertex differences
  - `BatchProviderWrapper` for async batch operations (submit → poll → fetch)
  - `SyncProviderWrapper` for direct vertex operations
  - Automatic provider selection: batch (default) → vertex (fallback) → mock (testing)

#### 2. Batch Guardrails ✅
- **Cost Estimation**: Preview costs with `NN_PRICE_PER_IMAGE_USD`
- **Size Limits**: `JOB_MAX_BYTES` (200MB), `ITEM_MAX_BYTES` (8MB), `MAX_IMAGES_PER_JOB` (2000)
- **Auto-Compression**: Resize images to 1024px, JPEG quality 75
- **Deduplication**: SHA256 hashing prevents duplicate reference images
- **Job Splitting**: Large jobs automatically chunked when exceeding limits
- **Preflight Validation**: Comprehensive checks before submission

#### 3. CLI Safety ✅
- **Default Safe**: `--dry-run` is default for `render` and `batch submit`
- **Explicit Override**: `--live` flag required for actual generation
- **Confirmation Gates**: `--yes` flag mandatory for live operations with billing
- **Input Validation**: Comprehensive parameter validation and bounds checking

#### 4. Environment Configuration ✅
- **Batch-first defaults**: `NN_PROVIDER=batch` (default)
- **Proxy configuration**: `BATCH_PROXY_URL`, `BATCH_MAX_BYTES`
- **Guardrail settings**: `PREFLIGHT_COMPRESS=true`, `PREFLIGHT_SPLIT=true`
- **Fallback support**: Vertex AI configuration when needed

#### 5. Testing & CI/CD ✅
- **Smoke Tests**: `test/smoke.batch.spec.ts` for batch integration
- **Simplified CI**: Docker proxy-only, native Node testing
- **GitHub Actions**: Automated testing with docker-compose
- **Health Checks**: Proxy service monitoring

#### 6. Documentation ✅
- **Updated Architecture**: All READMEs reflect batch-first approach
- **Security Model**: Proxy-based API key management documented
- **CLI Usage**: Batch commands and safety features explained
- **Environment Setup**: Clear configuration instructions

### Key Files Implemented ✅

```
apps/nn/
├── src/adapters/providerFactory.ts    # ✅ Unified provider interface
├── src/workflows/preflight.ts         # ✅ Size limits and validation  
├── src/config/env.ts                  # ✅ Batch-first environment config
├── test/smoke.batch.spec.ts           # ✅ Batch integration tests
├── .github/workflows/ci.yml           # ✅ Simplified CI pipeline
├── docker-compose.yml                 # ✅ Proxy service orchestration
└── proxy/                             # ✅ Batch relay service
```

## Phase 2: Core Implementation 🔄 NEXT

### Priority Tasks
1. **Remix Engine** (`src/core/remix.ts`):
   - Deterministic prompt generation with seeded RNG
   - Template-based variations with style preservation
   - Integration with provider factory

2. **Reference Pack System**:
   - Complete YAML/JSON schema implementation
   - Multi-reference type support (style, props, subject, pose, environment)
   - Reference validation and optimization

3. **GUI Development**:
   - Fastify + React prompt editor
   - Virtual scrolling for large datasets  
   - Real-time batch job monitoring
   - Cost estimation display

4. **CSV Operations**:
   - Export prompts to CSV for external editing
   - Import modified CSV with validation
   - Round-trip fidelity testing

5. **Duplicate Detection**:
   - SimHash implementation for prompt similarity
   - Configurable similarity thresholds
   - Batch deduplication workflows

### Success Criteria
- [ ] End-to-end pipeline: analyze → remix → batch submit → fetch
- [ ] GUI can handle 1000+ prompts with <300ms load time
- [ ] CSV round-trip maintains data integrity
- [ ] Duplicate detection achieves >95% accuracy
- [ ] All operations respect cost controls and safety guards

## Previous Implementation Details (Phase 2 Reference)

## Phase 1: Remix Module Implementation

### Architecture
```typescript
// Core function signatures
export function generatePrompts(
  descriptors: ImageDescriptor[],
  options: RemixOptions
): PromptRow[]

export function composePrompt(
  subjects: string[],
  style: string[],
  lighting: string[],
  camera?: CameraInfo,
  seed?: number
): string

export function injectStyleOnlyPrefix(prompt: string): string
```

### Implementation Details

#### 1. Seeded Random Number Generator
```typescript
class SeededRNG {
  private seed: number;
  
  constructor(seed: number) {
    this.seed = seed;
  }
  
  next(): number {
    // Linear congruential generator (deterministic)
    this.seed = (this.seed * 1664525 + 1013904223) % 2**32;
    return this.seed / 2**32;
  }
  
  choice<T>(array: T[]): T {
    return array[Math.floor(this.next() * array.length)]!;
  }
}
```

#### 2. Prompt Composition Rules
- **Structure**: `[subject] + [≤3 style adj] + [≤2 lighting] + [optional camera] + [composition directive]`
- **Style-only injection**: System prefix always included
- **Adjective swapping**: 2-3 controlled swaps per descriptor with provenance tracking
- **Tag preservation**: Original tags → derived tags mapping

#### 3. Controlled Variation Logic
```typescript
interface RemixOptions {
  maxPerImage: number;        // Default: 50, Max: 100
  seed: number;               // For deterministic output
  styleVariations: number;    // 1-3 style adjective swaps
  lightingVariations: number; // 1-2 lighting swaps
  compositionVariations: number; // Optional composition changes
}
```

#### 4. Style-Only Prefix Injection
```typescript
const STYLE_ONLY_PREFIX = 
  "Use reference images strictly for style, palette, texture, and mood. " +
  "Do NOT copy subject geometry, pose, or layout. " +
  "Prioritize user text for subject and composition.";

function injectStyleOnlyPrefix(prompt: string): string {
  return `${STYLE_ONLY_PREFIX}\n\n${prompt}`;
}
```

### Testing Strategy
- **Deterministic tests**: Same seed → identical output across runs
- **Variation bounds**: Verify max adjectives/lighting respected  
- **Tag provenance**: Ensure derived tags trace back to originals
- **Performance**: Handle 1k descriptors in <200ms

## Phase 2: Gemini Adapter Implementation

### Architecture
```typescript
export class GeminiImageAdapter implements ImageGenProvider {
  private client: GoogleGenerativeAI;
  private model: GenerativeModel;
  
  constructor(config: GeminiConfig);
  
  async render(batch: RenderBatch): Promise<RenderResult>;
  private async executeWithRetry(batch: RenderBatch): Promise<RenderResult>;
  private async estimateCost(batch: RenderBatch): Promise<CostPlan>;
  private validateStyleDistance(generated: Buffer, references: Buffer[]): boolean;
}
```

### Implementation Details

#### 1. Vertex AI SDK Integration (ADC-Only)
```typescript
import { VertexAI } from '@google-cloud/vertexai';

// ADC-only initialization - NO API keys in code
const project = mustEnv('GOOGLE_CLOUD_PROJECT');
const location = mustEnv('GOOGLE_CLOUD_LOCATION');
const vertex = new VertexAI({ project, location });

const model = vertex.preview.getGenerativeModel({
  model: 'gemini-2.5-flash-image-preview',
  generationConfig: {
    maxOutputTokens: 4096,
    temperature: 0.8,
  },
});
```

#### 2. Three-Layer Style-Only Defense
```typescript
// Layer 1: System prompt
const systemPrompt = {
  role: 'system',
  parts: [{ text: STYLE_ONLY_PREFIX }]
};

// Layer 2: Attach style references as multimodal parts
const styleParts = await Promise.all(
  styleRefs.map(async (ref) => ({
    inlineData: {
      data: await readFile(ref).then(b => b.toString('base64')),
      mimeType: 'image/jpeg'
    }
  }))
);

// Layer 3: Post-generation hash distance validation
const isStyleCopy = await validateStyleDistance(generated, styleRefs);
if (isStyleCopy) {
  log.warn('Style copying detected, discarding result');
  continue; // Try again or skip
}
```

#### 3. Exponential Backoff Retry Logic
```typescript
async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  baseDelay = 1000
): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      
      // Handle specific error codes
      if (error.code === 429) {
        // Rate limited - longer backoff
        const delay = baseDelay * Math.pow(2, i) * 2;
        await sleep(delay + Math.random() * 1000);
      } else if (error.code >= 500) {
        // Server error - standard backoff
        const delay = baseDelay * Math.pow(2, i);
        await sleep(delay + Math.random() * delay * 0.5);
      } else {
        // Non-retryable error
        throw error;
      }
    }
  }
  throw new Error('Max retries exceeded');
}
```

#### 4. Cost Estimation (Configurable Pricing)
```typescript
function estimateCost(batch: RenderBatch): CostPlan {
  const imageCount = batch.rows.length * batch.variants;
  const concurrency = Math.min(4, Math.ceil(imageCount / 10));
  const estimatedTime = Math.ceil(imageCount / concurrency) * 3; // 3s per image avg
  
  // Configurable pricing from environment
  const pricePerImage = Number(env.NN_PRICE_PER_IMAGE_USD ?? NaN);
  const estimatedCost = Number.isFinite(pricePerImage) 
    ? imageCount * pricePerImage 
    : undefined;
  
  return {
    imageCount,
    estimatedCost: estimatedCost ?? 0,
    estimatedTime: `${estimatedTime}s`,
    concurrency,
    warning: estimatedCost && estimatedCost > 10 ? 'High cost operation' : undefined,
    priceNote: estimatedCost ? undefined : 'Set NN_PRICE_PER_IMAGE_USD for cost estimation',
  };
}
```

#### 5. Hash Distance Validation
```typescript
import { generateFileHash, hashSimilarity, STYLE_COPY_THRESHOLD } from '../core/idempotency.js';

async function validateStyleDistance(
  generated: Buffer,
  styleRefs: string[]
): Promise<boolean> {
  const generatedHash = await generateFileHash(generated);
  
  for (const refPath of styleRefs) {
    const refBuffer = await readFile(refPath);
    const refHash = await generateFileHash(refBuffer);
    const similarity = hashSimilarity(generatedHash, refHash);
    
    if (similarity > STYLE_COPY_THRESHOLD) {
      return false; // Too similar = potential copy
    }
  }
  
  return true; // Acceptable style transfer
}
```

### Testing Strategy
- **Mock API responses**: Test without real Vertex calls
- **Retry logic**: Simulate 429/503 errors and verify backoff
- **Style validation**: Test hash distance with known similar/different images
- **Cost estimation**: Verify accuracy against actual Vertex pricing
- **Concurrency**: Test batch processing under load

## Integration Points

### File Dependencies
```typescript
// remix.ts imports
import type { ImageDescriptor, PromptRow } from '../types.js';
import { createOperationLogger } from '../logger.js';

// geminiImage.ts imports  
import type { ImageGenProvider, RenderBatch, RenderResult } from '../types.js';
import { validateGoogleCloudConfig } from '../config/env.js';
import { generateFileHash, hashSimilarity } from '../core/idempotency.js';
```

### Error Handling
```typescript
// RFC 7807 Problem+JSON for all errors
import { ProblemSchema } from '../types.js';

function createProblem(
  title: string,
  detail: string,
  status: number,
  type = 'about:blank'
): Problem {
  return ProblemSchema.parse({ type, title, detail, status });
}
```

## Performance Targets

### Remix Module
- Generate 1k prompts: <200ms
- Memory usage: <50MB for 10k descriptors
- CPU efficient: Use single-pass algorithms

### Gemini Adapter
- Dry-run estimation: <50ms (no network)
- Live rendering: respect rate limits (2 concurrent by default)
- Error recovery: <3 retries with exponential backoff

## Security Requirements

### Remix Module (Lower Risk)
- Input validation with Zod schemas
- No external network calls
- Deterministic output (no side effects)

### Gemini Adapter (Higher Risk)
- Never log API keys or full signed URLs  
- Use ADC for authentication (no hardcoded keys)
- Redact sensitive data in error messages
- Validate all inputs before API calls

## Validation Checklist

### Remix Module
- [ ] Deterministic output with same seed
- [ ] Respects max adjective limits
- [ ] Style-only prefix always included
- [ ] Tag provenance preserved
- [ ] Performance target met
- [ ] Pure functions (no side effects)

### Gemini Adapter  
- [ ] Three-layer style-only enforcement
- [ ] Exponential backoff implemented
- [ ] Cost estimation accurate
- [ ] Hash validation functional
- [ ] No secrets logged
- [ ] ADC authentication working
- [ ] Error handling comprehensive

## Risk Assessment

### High Risk
1. **Style copying**: Hash thresholds too loose/tight
2. **API changes**: Google Gen AI SDK breaking changes  
3. **Cost runaway**: Inaccurate estimation or failed controls
4. **Rate limiting**: Insufficient backoff causing bans

### Medium Risk
1. **Determinism failure**: RNG not truly reproducible
2. **Memory leaks**: Large batch processing issues
3. **Performance degradation**: Slow hash calculations

### Low Risk
1. **Tag formatting**: Minor output inconsistencies
2. **Logging verbosity**: Too much/little information
3. **Configuration edge cases**: Unusual parameter combinations

## Implementation Order
1. **remix.ts**: Core functionality with tests
2. **geminiImage.ts**: Adapter with mock tests  
3. **Integration tests**: End-to-end pipeline validation
4. **Performance optimization**: Profiling and tuning
5. **Documentation**: Update README and CLAUDE.md