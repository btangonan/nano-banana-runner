# SuperClaude Playbook for Nano Banana Runner

## Purpose
Get maximum depth, quality, and efficiency from Claude Code when developing and maintaining the Nano Banana Runner (nn) CLI and GUI application.

## Project Context
- **What**: Terminal image analyzer → prompt remixer → Gemini image generator with style-only conditioning
- **Stack**: TypeScript, Node 20, Gemini Batch API, Fastify, React, Zod
- **Principles**: Small slices (≤300 LOC), typed everything, zero secrets in code, fail fast + recover

## Development Modes

### Mode A: Implement
For building new features and components with maximum quality.

**Process**:
1. Write failing tests first
2. Implement in small, typed diffs
3. Keep files ≤300 LOC
4. Validate with Zod at all boundaries
5. Update tests to pass
6. Document changes

**Example**:
```
"Implement CSV export" → 
1. Write export.spec.ts with expected behavior
2. Create core/csv.ts with streaming logic
3. Add Zod schema for CSVRow
4. Wire CLI command
5. Verify tests pass
```

### Mode B: Debug
For investigating and fixing issues systematically.

**Process**:
1. Collect context pack (error logs, stack traces, inputs)
2. Write failing test that reproduces issue
3. Implement minimal fix
4. Verify fix doesn't break other tests
5. Document root cause in CLAUDE.md

**Example**:
```
"Dedupe not finding similar prompts" →
1. Capture problem prompts
2. Write test showing expected clustering
3. Debug SimHash/Jaccard logic
4. Fix normalization or threshold
5. Document edge case
```

## SuperClaude Operating Guide

### Deepen Passes
When asked to "Think Deeper ×2", run these passes:
1. **PLAN**: Break down into atomic tasks
2. **RISKS**: List 5-10 potential failure modes
3. **TESTS**: Define test cases before code
4. **SCAFFOLD**: Create file structure
5. **SELF-CRITIQUE**: Review for Vibe Top 5 compliance
6. **TIGHTEN**: Remove unnecessary code/comments
7. **OUTPUT**: Deliver clean, tested solution

### Token Discipline
- Prefer lists/tables/diffs over paragraphs
- Omit filler words and explanations
- Keep logs terse (structured JSON)
- Use symbols for status: ✅ ❌ ⚠️ 🔄 ⏳
- Never repeat obvious context

### PR Discipline
- ≤2 files per PR unless scaffolding
- Update README on contract changes
- Update .env.example on new env vars
- Include tests with implementation
- Atomic commits with clear messages

### Ask-Less Heuristic
When unclear:
1. Choose the safest assumption
2. State assumption in PR/comment
3. Proceed with implementation
4. Let tests validate assumptions

## Guardrails Macros

Copy-paste these commands for focused reviews:

### --guardrails
"Review caps, retries, idempotency, and style-only enforcement; propose tests."

### --qc
"Produce QC_CHECKLIST.md and a Postman/cURL smoke set for analyze/remix/render."

### --audit
"Run code/arch/security audit; list PASS/FAIL per Vibe Top 5 with evidence."

### --debug
"Request context pack → write failing test → propose ≤2-file fix."

### --infra
"Generate minimal Terraform/IAM or Cloud Build only when asked; default OFF."

### --orchestrator
"Compose routes/workers; default OFF for this CLI."

## Performance Guidelines

### Benchmarks
- Export 1k prompts: <300ms
- Dedupe 5k prompts: <500ms p95
- GUI load 1k rows: <300ms TTI
- Render dry-run: instant (no network)

### Hot Paths to Optimize
1. SimHash computation (use rolling hash)
2. CSV streaming (never load full file)
3. Prompt table virtualization
4. Thumbnail generation (cache aggressively)

### Memory Limits
- Max in-memory prompts: 10k
- Max image buffer: 10MB
- Stream everything else

## Security Checklist

### Never Log
- API keys (GEMINI_API_KEY, etc.)
- Full signed URLs
- Service account credentials
- User file paths outside artifacts/

### Always Validate
- File paths constrained to artifacts/
- CSV injection protection (escape formulas)
- Zod schemas with .strict()
- RFC 7807 for all errors

### Authentication
- GUI: Ephemeral bearer token
- CLI: ADC for Google Cloud
- Never store creds in code

## Testing Strategy

### Unit Tests (vitest)
- Pure functions: normalize, simhash, jaccard
- Adapters with mocks: geminiImage, gcs
- Workflows with stubs: runAnalyze, runRemix

### Integration Tests
- CSV round-trip fidelity
- Dedupe cluster accuracy
- API endpoint validation

### E2E Tests (Playwright for GUI)
- Full pipeline: analyze → remix → render
- GUI workflows: edit → save → export
- Cost preview accuracy

### Test Data
- Fixtures in tests/fixtures/
- Mock responses for Gemini API
- Deterministic seeds for reproducibility

## Review Checklist

Before marking PR ready:
- [ ] Tests written and passing
- [ ] Types validated with tsc
- [ ] Zod schemas strict
- [ ] Problem+JSON errors
- [ ] Diffs ≤300 LOC/file
- [ ] Docs updated (README, CLAUDE.md)
- [ ] No secrets in code/logs
- [ ] Benchmarks still pass

## Quick Commands

### Development
```bash
pnpm dev          # Watch mode
pnpm test:watch   # Test watch mode
pnpm typecheck    # Validate types
pnpm lint         # Check code style
```

### Validation
```bash
pnpm validate     # Full pipeline test
pnpm bench        # Performance check
pnpm test:e2e     # End-to-end tests
```

### CLI Usage
```bash
nn analyze --in ./images --out ./artifacts
nn remix --descriptors ./artifacts/descriptors.json
nn render --dry-run  # Cost preview
nn gui              # Start QC interface
```

## Common Patterns

### Streaming CSV
```typescript
pipeline(
  createReadStream(input),
  parse({ delimiter: '\n' }),
  transform,
  stringify({ header: true }),
  createWriteStream(output)
)
```

### Retry with Backoff
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
      const delay = baseDelay * Math.pow(2, i) * (0.5 + Math.random());
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw new Error('Unreachable');
}
```

### Style-Only Guard
```typescript
const styleOnlyPrefix = {
  role: 'system',
  parts: [{
    text: 'Use reference images strictly for style, palette, texture, and mood. Do NOT copy subject geometry, pose, or layout.'
  }]
};
```

## Architecture Decisions

### ADR-001: Batch API over Direct SDK
- **Decision**: Use Gemini Batch API via proxy service
- **Reason**: Better scalability, cost control, and resource management
- **Trade-off**: Additional proxy complexity but improved batch processing

### ADR-002: SimHash for Dedupe
- **Decision**: SimHash + Jaccard over embeddings
- **Reason**: Fast, lightweight, no external deps
- **Trade-off**: Less semantic understanding, but good enough

### ADR-003: Localhost-only GUI
- **Decision**: Bind to 127.0.0.1 with ephemeral token
- **Reason**: Security simplicity for local tool
- **Trade-off**: No remote access, but safer

## Troubleshooting

### Issue: API Rate Limits
- **Cause**: Too many concurrent requests
- **Fix**: Reduce --concurrency to 2
- **Prevention**: Implement exponential backoff

### Issue: CSV Import Memory Spike
- **Cause**: Loading entire file
- **Fix**: Use streaming with csv-parse
- **Prevention**: Always stream large files

### Issue: GUI Slow with 5k+ Prompts
- **Cause**: Rendering all rows
- **Fix**: Implement virtual scrolling
- **Prevention**: Use react-window

## Evolution Notes

### Next Features (Post-MVP)
1. Batch GCS uploads for style refs
2. Parallel rendering with worker threads
3. Smart prompt variations with LLM
4. Web UI with real auth (OAuth/OIDC)

### Performance Optimizations
1. WASM SimHash for 10x speed
2. SQLite for prompt storage
3. CDN for generated images
4. Redis for dedupe cache

### Scale Considerations
- Current: 10k prompts, single machine
- Next: 100k prompts, distributed processing
- Future: 1M+ prompts, cloud-native architecture

## Commands Summary

### "Think Deeper ×2"
Run extra SELF-CRITIQUE + TIGHTEN pass before output.

### "Cut Scope"
Trim plan to 1-day shippable with tests.

### "Make It Deterministic"
Seed RNG, stabilize all outputs for testing.

### "Vibe Check"
Validate against the Vibe Top 5:
1. Small, composable slices
2. Typed + validated everything
3. Secrets stay secret
4. Minimal state, durable truth
5. Fail fast, loud, recover gracefully