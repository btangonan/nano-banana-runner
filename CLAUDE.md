# Claude Code Operating Manual for Nano Banana Runner

## Quick Reference
**Project**: Nano Banana Runner (nn) - Image analyzer → prompt remixer → Gemini generator  
**Location**: `/Users/bradleytangonan/Desktop/my apps/gemini image analyzer/`  
**Stack**: TypeScript, Node 20, Gemini Batch API, Vertex AI SDK, Fastify, React, Zod  
**Provider System**: Batch (primary/default) with Vertex (fallback) - Provider switching implemented  
**Status**: Core modules implemented, Batch provider working, Vertex has entitlement issues

## Active SuperClaude Commands

### Thinking Modes
```bash
--seq / --sequential-thinking    # Deep multi-step reasoning (active by default for complex tasks)
--ultrathink                      # Maximum depth analysis (~32K tokens)
--think                          # Standard analysis (~4K tokens)
--think-hard                     # Deep analysis (~10K tokens)
```

### Operational Modes
```bash
--brainstorm                     # Discovery mindset for requirements
--introspect                     # Meta-cognitive analysis and self-correction
--task-manage                    # Hierarchical task organization
--orchestrate                    # Optimal tool selection and parallelization
--token-efficient / --uc         # Symbol communication (30-50% reduction)
```

### Quality Gates
```bash
--guardrails                     # Review caps, retries, idempotency, style-only enforcement
--qc                            # Produce QC checklist and smoke tests
--audit                         # Run Vibe Top 5 compliance audit
--validate                      # Pre-execution risk assessment
--safe-mode                     # Maximum validation, conservative execution
```

### Execution Control
```bash
--delegate [auto|files|folders]  # Enable sub-agent processing
--concurrency [n]                # Control parallel operations (1-15)
--loop                          # Iterative improvement cycles
--iterations [n]                # Set improvement count (1-10)
--scope [file|module|project]   # Define operational boundary
```

## MCP Servers Available

### Sequential Thinking (Active)
- **Purpose**: Multi-step reasoning and hypothesis testing
- **When**: Complex debugging, system design, architectural decisions
- **Usage**: Automatically activated for complex analysis
- **Commands**: `--seq`, `--think`, `--ultrathink`

### Context7
- **Purpose**: Official library documentation and patterns
- **When**: Framework questions, API usage, best practices
- **Activation**: Import statements, framework keywords
- **Example**: "How to use Vertex AI SDK with ADC" → Context7 lookup

### Magic (21st.dev)
- **Purpose**: UI component generation from patterns
- **When**: `/ui`, `/21`, component requests
- **Activation**: UI/component keywords
- **Example**: "Create a prompt editor component" → Magic patterns

### Playwright
- **Purpose**: Browser automation and E2E testing
- **When**: Visual testing, form validation, user flows
- **Activation**: Testing keywords, browser interaction
- **Example**: "Test the GUI prompt editor" → Playwright automation

## Project-Specific Context

### Current Implementation Status
✅ **Completed**:
- Batch-first architecture with proxy service
- Gemini Batch API integration (default provider)
- **In-memory job tracking**: Map-based storage for batch job lifecycle
- Provider factory with unified interface (batch/vertex/mock)
- Comprehensive batch limits and guardrails:
  - Cost estimation with warnings
  - Preflight checks with size limits
  - Auto-compression and deduplication
  - CLI safety with --dry-run defaults
  - Style-only enforcement
- **Mock batch functionality**: Since Gemini lacks true batch API
- **Enhanced CORS**: Proxy self-origin support (ports 8787)
- Smoke tests for batch operations (smoke.batch.spec.ts)
- CI/CD with docker-compose and GitHub Actions
- Environment configuration with batch defaults
- Proxy service with health checks and security
- TypeScript configuration (strict mode)
- Zod schemas for all data types
- Pino logger with request tracing
- Idempotency helpers (SHA256)
- Image analysis with Sharp
- CLI with batch commands
- **Provider mapping helpers**: UI to API provider name translation

⏳ **Pending**:
- GUI with Fastify + React
- CSV export/import
- Duplicate detection
- Reference pack system completion

### Key Files and Locations
```
apps/nn/
├── src/
│   ├── types.ts           # ✅ Zod schemas (strict validation)
│   ├── config/env.ts      # ✅ Batch-first environment config
│   ├── cli.ts             # ✅ CLI with batch commands
│   ├── logger.ts          # ✅ Pino with no secrets logging
│   ├── core/
│   │   ├── analyze.ts     # ✅ Sharp-based image analysis
│   │   ├── idempotency.ts # ✅ SHA256 and similarity checks
│   │   ├── styleGuard.ts  # ✅ Style-only conditioning
│   │   ├── remix.ts       # ✅ Prompt generation
│   │   └── dedupe.ts      # ⏳ SimHash duplicate detection
│   ├── adapters/
│   │   ├── providerFactory.ts # ✅ Unified provider interface
│   │   ├── geminiBatch.ts # ✅ Batch client with in-memory job tracking
│   │   ├── batchRelayClient.ts # ✅ Proxy client
│   │   ├── geminiImage.ts # ✅ Vertex AI fallback
│   │   └── fs-manifest.ts # ✅ File operations
│   ├── workflows/         # ✅ Batch orchestration
│   │   └── preflight.ts   # ✅ Size limits and validation
│   └── types/             # ✅ Reference pack schemas
├── proxy/                 # ✅ Batch relay proxy service
│   └── src/
│       ├── server.ts      # ✅ Enhanced CORS configuration
│       └── clients/
│           └── geminiBatch.ts # ✅ In-memory Map storage for jobs
├── test/
│   └── smoke.batch.spec.ts # ✅ Batch integration tests
├── .github/workflows/ci.yml # ✅ CI/CD pipeline
└── docker-compose.yml     # ✅ Service orchestration
```

### Environment Requirements
```bash
# Batch-first Architecture (Default)
NN_PROVIDER=batch                    # batch (default) | vertex | mock
BATCH_PROXY_URL=http://127.0.0.1:8787
BATCH_MAX_BYTES=104857600            # 100MB batch size limit

# Preflight Guardrails
JOB_MAX_BYTES=209715200              # 200MB job size limit
ITEM_MAX_BYTES=8388608               # 8MB item size limit
MAX_IMAGES_PER_JOB=2000              # Image count limit
PREFLIGHT_COMPRESS=true              # Auto-compress reference images
PREFLIGHT_SPLIT=true                 # Auto-split oversized jobs

# Optional: Vertex AI Fallback
GOOGLE_CLOUD_PROJECT=your-project-id # Required for vertex provider
GOOGLE_CLOUD_LOCATION=us-central1

# Performance & Features
NN_CONCURRENCY=2
NN_MAX_PER_IMAGE=50
NN_STYLE_GUARD_ENABLED=true
PREFLIGHT_COMPRESS=true
PREFLIGHT_SPLIT=true
```

## Vibe Coding Principles (Top 5)

### 1. Small, Composable Slices ✅
- All files ≤300 LOC
- Single responsibility per module
- Pure functions where possible

### 2. Typed + Validated Everything ✅
- Zod schemas with `.strict()`
- TypeScript strict mode enabled
- Validation at all boundaries

### 3. Secrets Stay Secret ✅
- ADC for Google Cloud auth
- No keys in code/logs/tests
- Redacted logging configured

### 4. Minimal State, Durable Truth ✅
- Filesystem manifest as truth
- Artifacts in `./artifacts`
- Idempotency keys for operations

### 5. Fail Fast, Loud, Recover Gracefully 🔄
- RFC 7807 Problem+JSON
- Exponential backoff with jitter
- Dry-run by default

## Starting the Application

### Bulletproof Startup (Recommended)
```bash
# Clean start with automatic process cleanup
./start-clean.sh

# Options:
./start-clean.sh --clear-cache  # Clear Vite cache too
./start-clean.sh stop           # Stop all services
./start-clean.sh restart        # Full restart
./start-clean.sh status         # Check what's running
./start-clean.sh cleanup        # Aggressive cleanup
./start-clean.sh logs           # View recent logs
```

**What it does:**
- Kills ALL processes on ports 8787, 5174, 24678
- Clears Vite cache and temp files (with --clear-cache)
- Starts proxy first, then GUI
- Verifies health checks
- Tracks PIDs for clean shutdown
- Logs to `./logs/` directory

### Manual Start (If Script Fails)
```bash
# Kill old processes first
pkill -f "pnpm.*dev" || true
lsof -ti :8787 | xargs kill -9 2>/dev/null || true
lsof -ti :5174 | xargs kill -9 2>/dev/null || true

# Start proxy
cd apps/nn/proxy && pnpm dev

# Start GUI (new terminal)
cd apps/nn/apps/gui && pnpm dev

# Verify
curl http://127.0.0.1:8787/healthz  # Should return {"status":"ok"}
```

## Batch Processing Implementation

### Architecture Overview
Since Gemini doesn't provide a true batch API, we've implemented a mock batch system:

1. **In-Memory Job Storage**: Uses a Map to track job status and results
2. **Job Lifecycle**: submit → poll (status) → fetch (results)
3. **Status Tracking**: Jobs transition through states (processing → completed)
4. **Result Storage**: Base64 data URLs stored directly in memory

### Key Components
```typescript
// In-memory storage structure (geminiBatch.ts)
const jobs = new Map<string, {
  status: "processing" | "completed" | "failed";
  completed: number;
  total: number;
  results: Array<{ id: string; prompt: string; outUrl?: string }>;
  problems: any[];
}>();
```

### Batch API Endpoints
- `POST /batch/submit` - Submit new batch job
- `GET /batch/job-{id}/poll` - Check job status
- `GET /batch/job-{id}/results` - Fetch completed results

### Image Extraction Workflow
```bash
# 1. Submit batch job
curl -X POST http://127.0.0.1:8787/batch/submit -d '{...}'

# 2. Poll for completion
curl http://127.0.0.1:8787/batch/job-{id}/poll

# 3. Extract results (base64 image)
curl -s http://127.0.0.1:8787/batch/job-{id}/results | \
  jq -r '.results[0].outUrl' | \
  sed 's/^data:image\/[^;]*;base64,//' | \
  base64 -d > image.png
```

## Recent Fixes (2025-09-08)

### Toast Component Crash (RESOLVED)
**Issue**: React "Element type is invalid...got: undefined"
**Cause**: lucide-react v0.445.0 renamed icons
**Fix**: Updated icon imports and separated hook
```typescript
// Fixed imports:
import { CircleCheck, TriangleAlert } from "lucide-react"
// Was: CheckCircle, AlertTriangle
```

### Batch Routes 404 (RESOLVED)
**Issue**: "relay submit 500: submit failed 404"
**Cause**: fastify-plugin wrapper prevented registration
**Fix**: Removed wrapper from batch.ts
```typescript
// Fixed:
export default async function batchRoutes(app: FastifyInstance) {
// Was: export default fp(async function...)
```

## Common Operations

### Start New Feature
```bash
# 1. Plan with sequential thinking
--seq "Plan implementation of [feature]"

# 2. Create tests first
"Write failing tests for [feature]"

# 3. Implement with validation
"Implement [feature] with Zod validation"

# 4. Verify compliance
--audit "Check Vibe Top 5 compliance"
```

### Debug Issue
```bash
# 1. Collect context
--seq "Analyze error: [error message]"

# 2. Write reproduction test
"Create failing test that reproduces [issue]"

# 3. Fix with minimal change
"Fix [issue] with ≤2 file changes"

# 4. Validate fix
--validate "Verify fix doesn't break other tests"
```

### Review Code
```bash
# Security and quality audit
--audit --guardrails "Review latest changes"

# Performance check
--think "Analyze performance bottlenecks"

# Documentation update
"Update CLAUDE.md with new patterns"
```

## Style-Only Conditioning Rules

### Implementation Requirements
1. **System Prompt**: Always include style-only instruction
2. **Reference Images**: Attach as multimodal parts
3. **Hash Validation**: Check similarity < 0.85 threshold
4. **Rejection Policy**: Discard near-copies, log attempts

### Code Pattern
```typescript
const styleOnlyPrefix = {
  role: 'system',
  parts: [{
    text: 'Use reference images strictly for style, palette, texture, and mood. Do NOT copy subject geometry, pose, or layout.'
  }]
};
```

## Testing Strategy

### Unit Tests (Priority)
- Pure functions: `normalize()`, `simhash()`, `jaccard()`
- Adapters with mocks: `geminiImage`, `mockImage`
- Workflows with stubs: `runAnalyze`, `runRemix`

### Integration Tests
- CSV round-trip fidelity
- Dedupe accuracy
- API validation

### E2E Tests
- Full pipeline: analyze → remix → render
- GUI workflows: edit → export → render
- Cost controls: dry-run → live

## Performance Targets
- Export 1k prompts: <300ms ✅
- Dedupe 5k prompts: <500ms p95
- GUI load 1k rows: <300ms TTI
- Render dry-run: instant (no network)

## Git Workflow
```bash
# Always on feature branch
git checkout -b feature/[name]

# Atomic commits
git add [specific files]
git commit -m "feat: [description]"

# Never on main
git branch # Should show feature/*, not main
```

## Quick Commands

### Development
```bash
pnpm dev          # Watch mode
pnpm test:watch   # Test watch
pnpm typecheck    # Validate types
pnpm lint         # Check style
```

### CLI Usage
```bash
nn analyze --in ./images --out ./artifacts
nn remix --descriptors ./artifacts/descriptors.json
nn render --dry-run  # Cost preview only
nn gui              # Launch QC interface
```

### Validation
```bash
pnpm validate     # Full pipeline test
pnpm bench        # Performance check
pnpm test:e2e     # End-to-end tests
```

## Current Task Context

### Active TODO List
✅ **Batch-First Architecture Complete**:
1. ✅ Set Gemini Batch as default provider in config
2. ✅ Create smoke.batch.spec.ts for proxy testing
3. ✅ Update docs to reflect Batch-first architecture
4. ✅ Simplify CI to proxy-only (remove Vertex containers)
5. ✅ Add provider factory with Batch primary, Vertex fallback
6. ✅ Implement Batch limits and guardrails

### Next Phase
⏳ **Implementation Completion**:
1. Complete core/remix.ts for prompt generation
2. Enhance reference pack system
3. GUI development with Fastify + React
4. CSV export/import functionality
5. Duplicate detection with SimHash

## Troubleshooting

### Issue: Vertex API 429
**Fix**: Reduce `--concurrency` to 2, implement backoff

### Issue: Memory spike
**Fix**: Use streaming for CSV/JSONL operations

### Issue: Style copying detected
**Fix**: Adjust hash threshold, strengthen prompt prefix

### Issue: Slow analysis
**Fix**: Reduce image size for palette extraction

### Issue: "Could not process image" error in Claude
**Cause**: Truncating base64 image data (e.g., using `head -c 50`)
**Fix**: Extract and decode complete base64 data:
```bash
# Correct way to extract generated images:
curl -s "http://127.0.0.1:8787/batch/job-[JOB_ID]/results" | \
  jq -r '.results[0].outUrl' | \
  sed 's/^data:image\/[^;]*;base64,//' | \
  base64 -d > generated_image.png
```

### Issue: Batch job status 404
**Cause**: Job doesn't exist in memory or has expired
**Fix**: Jobs are stored in-memory only; restart clears all jobs

### Issue: CORS errors on proxy requests
**Fix**: Proxy now allows self-origin requests (ports 8787)

## Special Instructions

### When Implementing Gemini Adapter
- Use `@google-cloud/vertexai` with ADC-only authentication
- Implement 3-layer style-only defense
- Add exponential backoff for 429/503
- Never log credentials or sensitive data
- Default to dry-run mode

### When Building GUI
- Localhost only (127.0.0.1)
- Ephemeral bearer token
- Virtual scrolling for tables
- SSE for progress streaming
- No Redux (local state + URL params)

### When Writing Tests
- Test data in `tests/fixtures/`
- Mock Vertex responses
- Deterministic seeds
- Coverage target: 80%

## Review Checklist
- [ ] Tests written and passing
- [ ] Types validated with tsc
- [ ] Zod schemas strict
- [ ] Problem+JSON errors
- [ ] Files ≤300 LOC
- [ ] No secrets in code/logs
- [ ] Docs updated
- [ ] Benchmarks pass

## Contact Points
**User**: Bradley Tangonan  
**Project**: Nano Banana Runner  
**Priority**: Style-only conditioning, cost control, performance  
**Constraints**: No heavy deps, localhost GUI, ADC auth only