# Nano Banana Runner - Phase 2 & 3 Implementation Roadmap

## 🎯 Project Status
- **Phase 1**: ✅ COMPLETE - Core infrastructure, image analysis, GUI
- **Phase 2**: ⏳ PENDING - Prompt remixing & AI integration
- **Phase 3**: ⏳ PENDING - Advanced features & production readiness

---

## 📋 PHASE 2: PROMPT REMIXING & AI INTEGRATION

### 2.1 Prompt Remix Engine
**Files**: `src/core/remix.ts`, `src/core/templates.ts`
**Priority**: P0 (Critical - blocks all other features)

#### Tasks:
- [ ] Implement seeded random number generator (xorshift128+)
- [ ] Create prompt template system with Handlebars-style variables
- [ ] Build style mixing algorithm (weighted palette blending)
- [ ] Add variation generation (10-20% parameter deviation)
- [ ] Implement deterministic shuffling for reproducibility

#### Acceptance Criteria:
- Same seed + input = identical output
- Generates 50 variations per source image
- Mixes styles from multiple sources
- Respects max token limits (< 1000 chars)

### 2.2 CLI Implementation
**Files**: `src/cli.ts`, `src/commands/*.ts`
**Priority**: P0 (Critical - enables testing)

#### Tasks:
- [ ] Set up commander.js structure
- [ ] Implement `nn analyze` command
- [ ] Implement `nn remix` command
- [ ] Implement `nn render` command with --dry-run
- [ ] Implement `nn gui` command
- [ ] Add progress indicators (ora/cli-progress)
- [ ] Add --verbose and --quiet flags

#### Acceptance Criteria:
- All commands have help text
- Dry-run mode shows cost estimate
- Progress bars for batch operations
- Proper exit codes (0 success, 1 error)

### 2.3 Gemini Integration
**Files**: `src/adapters/geminiImage.ts`, `src/adapters/vertexAuth.ts`
**Priority**: P0 (Critical - core functionality)

#### Tasks:
- [ ] Set up @google-cloud/vertexai SDK
- [ ] Implement ADC-only authentication
- [ ] Create imagen-3-fast API wrapper
- [ ] Add style-only conditioning in prompts
- [ ] Implement response parsing
- [ ] Add mock adapter for testing

#### Acceptance Criteria:
- No API keys in code
- Handles all Vertex AI error codes
- Respects rate limits (5 QPS)
- Returns structured ImageResponse

### 2.4 Batch Processing Workflows
**Files**: `src/workflows/runRemix.ts`, `src/workflows/runRender.ts`
**Priority**: P1 (Important)

#### Tasks:
- [ ] Implement runRemix with concurrency control
- [ ] Implement runRender with rate limiting
- [ ] Add progress tracking and resumption
- [ ] Create batch manifest for tracking
- [ ] Implement partial failure handling

#### Acceptance Criteria:
- Processes 1000 images without OOM
- Resumes from interruption
- Generates cost report
- Handles partial failures gracefully

---

## 📋 PHASE 3: ADVANCED FEATURES & PRODUCTION

### 3.1 Style-Only Conditioning
**Files**: `src/core/styleGuard.ts`, `src/core/validation.ts`
**Priority**: P0 (Critical - compliance requirement)

#### Tasks:
- [ ] Implement 3-layer defense system
- [ ] Add system prompt prefix injection
- [ ] Create reference image validator
- [ ] Build similarity checker (perceptual hash)
- [ ] Add audit logging for violations

#### Acceptance Criteria:
- Zero style copying in 1000 generations
- Similarity score < 0.85 threshold
- All attempts logged for audit
- Configurable strictness levels

### 3.2 Deduplication System
**Files**: `src/core/dedupe.ts`, `src/core/simhash.ts`
**Priority**: P1 (Important - efficiency)

#### Tasks:
- [ ] Implement SimHash algorithm
- [ ] Create Jaccard similarity calculator
- [ ] Build prompt clustering
- [ ] Add configurable thresholds
- [ ] Create deduplication report

#### Acceptance Criteria:
- Detects 95% of near-duplicates
- Processes 10K prompts in < 1 second
- Configurable similarity threshold
- Detailed deduplication metrics

### 3.3 Error Handling & Retry
**Files**: `src/lib/retry.ts`, `src/lib/circuitBreaker.ts`
**Priority**: P0 (Critical - production stability)

#### Tasks:
- [ ] Implement exponential backoff with jitter
- [ ] Add circuit breaker pattern
- [ ] Create error classification system
- [ ] Build graceful degradation
- [ ] Add comprehensive logging

#### Acceptance Criteria:
- 99.9% success rate with retries
- Circuit breaks after 5 consecutive failures
- All errors logged with context
- No infinite retry loops

### 3.4 Cost Control & Monitoring
**Files**: `src/core/pricing.ts`, `src/core/usage.ts`
**Priority**: P1 (Important - user safety)

#### Tasks:
- [ ] Implement pricing calculator
- [ ] Add budget limit enforcement
- [ ] Create usage tracking database
- [ ] Build cost projection system
- [ ] Add spending alerts

#### Acceptance Criteria:
- Accurate cost calculations (± 1%)
- Hard stop at budget limit
- Real-time usage tracking
- Daily/monthly reports

### 3.5 Testing Suite
**Files**: `tests/**/*.test.ts`, `tests/e2e/*.spec.ts`
**Priority**: P1 (Important - quality assurance)

#### Tasks:
- [ ] Unit tests for all core modules (80% coverage)
- [ ] Integration tests for workflows
- [ ] E2E tests for CLI commands
- [ ] Performance benchmarks
- [ ] Load testing scenarios

#### Acceptance Criteria:
- 80% code coverage
- All CLI commands tested
- Performance regression detection
- CI/CD pipeline integration

### 3.6 GUI Enhancements
**Files**: `apps/gui/src/pages/*.tsx`, `apps/gui/src/components/*.tsx`
**Priority**: P2 (Nice to have)

#### Tasks:
- [ ] Add prompt editing interface
- [ ] Show real-time cost estimates
- [ ] Display generation progress
- [ ] Implement batch export
- [ ] Add history/versioning

#### Acceptance Criteria:
- Live prompt preview
- Cost updates as parameters change
- WebSocket progress updates
- Export to CSV/JSON

---

## 📊 Success Metrics

### Phase 2 Success Criteria:
- ✅ Generate 50 unique prompts from 1 source image
- ✅ Successfully call Gemini API with style conditioning
- ✅ CLI fully functional with all commands
- ✅ Process 100 images in batch without errors

### Phase 3 Success Criteria:
- ✅ Zero style copying violations in 1000 tests
- ✅ 90% reduction in duplicate prompts
- ✅ 99.9% uptime with retry logic
- ✅ Stay within $10 test budget
- ✅ 80% test coverage achieved

---

## 🚀 Implementation Order

### Week 1: Core Functionality
1. Prompt remix engine (2 days)
2. CLI structure (1 day)
3. Gemini integration (2 days)

### Week 2: Batch Processing
1. Workflow implementation (2 days)
2. Style-only guards (2 days)
3. Initial testing (1 day)

### Week 3: Production Features
1. Deduplication system (2 days)
2. Error handling & retry (2 days)
3. Cost controls (1 day)

### Week 4: Polish & Testing
1. Comprehensive testing (3 days)
2. GUI enhancements (1 day)
3. Documentation (1 day)

---

## 🛠️ Technical Dependencies

### Required Packages:
```json
{
  "@google-cloud/vertexai": "^1.2.0",
  "commander": "^12.0.0",
  "seedrandom": "^3.0.5",
  "simhash-js": "^1.0.0",
  "p-queue": "^8.0.0",
  "p-retry": "^6.0.0",
  "ora": "^8.0.0"
}
```

### Environment Requirements:
- Node.js 20+
- Google Cloud Project with Vertex AI enabled
- Application Default Credentials configured
- 8GB RAM minimum for batch processing

---

## 🎯 Next Steps

1. **Immediate Action**: Start with prompt remix engine (blocks everything)
2. **Parallel Work**: CLI can be developed alongside
3. **Integration Test**: Gemini adapter with mock first
4. **Validation**: Style-only conditioning before any real generation
5. **Progressive Enhancement**: Add advanced features iteratively

---

## 📝 Notes

- **Style-Only Requirement**: Critical for terms compliance
- **Cost Control**: Hard limit at $10 for testing phase
- **Performance Target**: 1K images/hour throughput
- **Quality Target**: 80% test coverage minimum
- **Security**: ADC-only, no keys in code

---

Last Updated: 2025-09-08
Status: Ready for Phase 2 Implementation