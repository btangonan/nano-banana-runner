# Claude Code Operating Manual for Nano Banana Runner

## Quick Reference
**Project**: Nano Banana Runner (nn) - Image analyzer → prompt remixer → Gemini generator  
**Location**: `/Users/bradleytangonan/Desktop/my apps/gemini image analyzer/`  
**Stack**: TypeScript, Node 20, Vertex AI SDK, Fastify, React, Zod  
**Status**: Core modules implemented, adapters in progress

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
- Git repository initialized
- TypeScript configuration (strict mode)
- Zod schemas for all data types
- Environment validation with ADC
- Pino logger with request tracing
- Idempotency helpers (SHA256)
- Image analysis with Sharp
- CLAUDE.md playbook

🔄 **In Progress**:
- Gemini adapter with Vertex AI SDK
- Prompt remix engine
- CLI with commander

⏳ **Pending**:
- GUI with Fastify + React
- CSV export/import
- Duplicate detection
- E2E tests

### Key Files and Locations
```
apps/nn/
├── src/
│   ├── types.ts           # ✅ Zod schemas (strict validation)
│   ├── config/env.ts      # ✅ Environment with ADC support
│   ├── logger.ts          # ✅ Pino with no secrets logging
│   ├── core/
│   │   ├── analyze.ts     # ✅ Sharp-based image analysis
│   │   ├── idempotency.ts # ✅ SHA256 and similarity checks
│   │   ├── remix.ts       # 🔄 Prompt generation (next task)
│   │   └── dedupe.ts      # ⏳ SimHash duplicate detection
│   └── adapters/
│       ├── geminiImage.ts # 🔄 Vertex AI SDK integration
│       └── mockImage.ts   # ⏳ Test adapter
```

### Environment Requirements
```bash
# Required for ADC-only authentication
GOOGLE_CLOUD_PROJECT=your-project-id
GOOGLE_CLOUD_LOCATION=us-central1

# Optional
NN_PROVIDER=gemini|mock
NN_CONCURRENCY=2
NN_MAX_PER_IMAGE=50
NN_PRICE_PER_IMAGE_USD=0.0025
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
1. 🔄 Update CLAUDE.md with SuperClaude commands
2. ⏳ Implement core/remix.ts for prompt generation
3. ⏳ Create geminiImage.ts with Gen AI SDK
4. ⏳ Build mockImage.ts for testing
5. ⏳ Implement fs-manifest.ts
6. ⏳ Create CLI with commander
7. ⏳ Build workflows (analyze, remix, render)
8. ⏳ Add retry logic
9. ⏳ Write tests

### Next Actions
1. Complete remix.ts with seeded RNG
2. Implement Gemini adapter with style-only guards
3. Wire up CLI commands
4. Test with mock provider first

## Troubleshooting

### Issue: Vertex API 429
**Fix**: Reduce `--concurrency` to 2, implement backoff

### Issue: Memory spike
**Fix**: Use streaming for CSV/JSONL operations

### Issue: Style copying detected
**Fix**: Adjust hash threshold, strengthen prompt prefix

### Issue: Slow analysis
**Fix**: Reduce image size for palette extraction

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