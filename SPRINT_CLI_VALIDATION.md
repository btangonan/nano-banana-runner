# Claude Code Self-Prompt: CLI + Live Vertex Validation Sprint

**Execution Flags**: `--orchestrator --client --qc --guardrails`

## Sprint Objective ✅
Ship end-to-end CLI (analyze → remix → render) with verified live image generation via Vertex AI (Gemini 2.5 Flash Image Preview). Validate the 3-layer style-only defense under production conditions while maintaining strict Vibe coding standards.

## Context & Current State 📊
- **✅ Solid Foundation**: Core modules complete (types/env/logger/idempotency/analyze/remix)
- **✅ Architecture**: 1,652 LOC across 9 files, ≤300 LOC discipline, strict Zod validation
- **✅ Security**: ADC-only authentication, no secrets in code, RFC 7807 errors
- **⚠️ Critical Gap**: No verified live render against Vertex API (model id, request shape, parsing)
- **📝 Doc Drift**: Legacy Gen-AI SDK + GOOGLE_API_KEY references need purging

## Non-Negotiable Guardrails 🛡️
1. **File Size**: ≤300 LOC per file, ≤2 files per PR unless justified
2. **Type Safety**: Zod `.strict()` at all boundaries, TypeScript strict mode
3. **Authentication**: ADC-only, never use `GOOGLE_API_KEY`, purge all key-based examples
4. **Cost Control**: Default `--dry-run`, spending requires `--live --yes` confirmation
5. **Data Integrity**: Atomic writes + JSONL manifest, secret redaction in logs
6. **Style Defense**: System prompt + multimodal parts + hash validation (exactly as documented)

## Deliverable Breakdown (5 Small PRs) 📦

### PR-CLI-01: CLI Skeleton (2 files)
**Scope**: Commander CLI entry + env validation, no business logic
**Files**:
- `apps/nn/src/cli.ts` (NEW, ~150 LOC)
- `apps/nn/src/config/env.ts` (UPDATE, add CLI-friendly error messages)

**Acceptance**:
- `nn --help` shows analyze/remix/render subcommands
- Invalid env → RFC 7807 JSON on stderr
- All CLI flags validated and typed

**Tests**: `tests/cli.flags.spec.ts` - help text, invalid flag/env paths

### PR-WF-02: Workflow Orchestration (3 files)
**Scope**: Wire core modules, render = dry-run only initially
**Files**:
- `apps/nn/src/workflows/runAnalyze.ts` (NEW)
- `apps/nn/src/workflows/runRemix.ts` (NEW) 
- `apps/nn/src/workflows/runRender.ts` (NEW, dry-run cost plan only)

**Acceptance**:
- Fixtures run end-to-end: images → descriptors.json → prompts.jsonl
- Render prints cost/concurrency plan without network calls
- All workflow errors as Problem+JSON

**Tests**: `tests/e2e.dryrun.spec.ts` - golden outputs, no network calls
**Perf**: `scripts/bench.mjs` - prompt generation target <200ms for 1k rows

### PR-ADP-03: Live Vertex Integration (2 files + justified update)
**Scope**: Live Vertex calls + retries + hash validation + manifest tracking
**Files**:
- `apps/nn/src/adapters/geminiImage.ts` (UPDATE, add live path)
- `apps/nn/src/adapters/fs-manifest.ts` (UPDATE, append helpers)

**Justification**: 2 existing files, both stay <300 LOC, critical integration path

**Acceptance**:
- 429/503 → exponential backoff with jitter + retry
- Similarity guard rejects/reattempts (max 2) then Problem+JSON entry
- PNG files written atomically with manifest entries
- ADC authentication working with `vertex-system-471415` project

**Tests**:
- `tests/adapter.gemini.spec.ts` - mocked client: success/429/503/similarity-reject
- `tests/manifest.spec.ts` - append operations + idempotent behavior

### PR-QC-04: Live Validation & Smoke Testing (3 files)
**Scope**: Real API validation + performance smoke tests
**Files**:
- `tests/e2e.live.spec.ts` (NEW, gated by `NN_LIVE=1`)
- `scripts/smoke.sh` (NEW, ADC check + dry-run + optional live)
- `README.md` (UPDATE, "Live Validation" section)

**Acceptance**:
- `NN_LIVE=1 pnpm test -t live` generates one real PNG with style guards
- Cost plan within ±20% of `NN_PRICE_PER_IMAGE_USD` if configured
- Smoke script validates full pipeline health

### PR-DOC-05: Documentation Alignment (1 file)
**Scope**: Purge legacy API key references, enforce Vertex SDK + ADC
**Files**:
- `IMPLEMENTATION_PLAN.md` (UPDATE, replace Gen-AI SDK snippets)
- `CLAUDE.md` (UPDATE, use vertex-system-471415, btang.vertex@gmail.com)

**Acceptance**:
- `grep -r "GOOGLE_API_KEY" .` returns no results
- All examples show `@google-cloud/vertexai` with ADC
- Project ID updated to `vertex-system-471415`

## File Implementation Stubs 📝

### apps/nn/src/cli.ts
```typescript
#!/usr/bin/env node
import { Command } from "commander";
import { loadEnv } from "./config/env.js";
import { runAnalyze } from "./workflows/runAnalyze.js";
import { runRemix } from "./workflows/runRemix.js";
import { runRender } from "./workflows/runRender.js";

const program = new Command()
  .name("nn")
  .description("Nano Banana Runner CLI")
  .version("1.0.0");

program.command("analyze")
  .requiredOption("--in <dir>", "input images directory")
  .option("--out <file>", "descriptors output", "artifacts/descriptors.json")
  .option("--concurrency <n>", "parallel workers", "4")
  .action(async (opts) => {
    loadEnv();
    await runAnalyze({ 
      inDir: opts.in, 
      outPath: opts.out, 
      concurrency: parseInt(opts.concurrency) 
    });
  });

program.command("remix")
  .requiredOption("--descriptors <file>", "descriptors.json input")
  .option("--out <file>", "prompts JSONL output", "artifacts/prompts.jsonl")
  .option("--max-per-image <n>", "max prompts per image", "50")
  .option("--seed <n>", "deterministic seed", "42")
  .action(async (opts) => {
    loadEnv();
    await runRemix({
      descriptorsPath: opts.descriptors,
      outPath: opts.out,
      maxPerImage: Math.min(parseInt(opts.maxPerImage), 100),
      seed: parseInt(opts.seed)
    });
  });

program.command("render")
  .requiredOption("--prompts <file>", "prompts JSONL input")
  .requiredOption("--style-dir <dir>", "style reference images")
  .option("--out <dir>", "rendered images output", "artifacts/renders")
  .option("--variants <n>", "variants per prompt (1-3)", "1")
  .option("--concurrency <n>", "parallel requests (1-4)", "2")
  .option("--dry-run", "cost estimate only (default)", true)
  .option("--live", "actual generation", false)
  .option("--yes", "confirm spending", false)
  .action(async (opts) => {
    loadEnv();
    const dryRun = opts.live ? false : true;
    
    if (!dryRun && !opts.yes) {
      console.error(JSON.stringify({
        type: "about:blank",
        title: "Live render requires confirmation",
        detail: "Add --yes flag to proceed with actual generation",
        status: 400
      }));
      process.exit(2);
    }
    
    await runRender({
      promptsPath: opts.prompts,
      styleDir: opts.styleDir,
      outDir: opts.out,
      variants: Math.min(parseInt(opts.variants), 3),
      concurrency: Math.min(parseInt(opts.concurrency), 4),
      dryRun
    });
  });

program.parseAsync().catch((error) => {
  console.error(JSON.stringify({
    type: "about:blank",
    title: "CLI execution failed",
    detail: String(error?.message ?? error),
    status: 1
  }));
  process.exit(1);
});
```

### apps/nn/src/workflows/runRender.ts (Live Integration Point)
```typescript
import { readFile, readdir } from "fs/promises";
import { join, extname } from "path";
import type { RenderRequest } from "../types.js";
import { GeminiImageAdapter } from "../adapters/geminiImage.js";
import { createOperationLogger } from "../logger.js";

interface RenderOptions {
  promptsPath: string;
  styleDir: string;
  outDir: string;
  variants: number;
  concurrency: number;
  dryRun: boolean;
}

export async function runRender(opts: RenderOptions): Promise<void> {
  const log = createOperationLogger('runRender');
  
  // Load prompts JSONL
  const promptsContent = await readFile(opts.promptsPath, 'utf-8');
  const rows = promptsContent
    .trim()
    .split('\n')
    .filter(line => line.trim())
    .map(line => JSON.parse(line));
  
  // Map style references from styleDir
  const styleFiles = await readdir(opts.styleDir);
  const styleRefs = styleFiles
    .filter(f => ['.jpg', '.jpeg', '.png'].includes(extname(f).toLowerCase()))
    .map(f => join(opts.styleDir, f));
  
  // Create render request
  const request: RenderRequest = {
    rows,
    variants: opts.variants,
    styleOnly: true,
    styleRefs,
    runMode: opts.dryRun ? "dry_run" : "live"
  };
  
  // Execute via Gemini adapter
  const adapter = new GeminiImageAdapter({
    project: process.env.GOOGLE_CLOUD_PROJECT!,
    location: process.env.GOOGLE_CLOUD_LOCATION!
  });
  
  const result = await adapter.render(request);
  
  if (opts.dryRun) {
    log.info({ costPlan: result.costPlan }, 'Dry-run cost estimate complete');
  } else {
    log.info({ 
      generated: result.results.length,
      outputDir: opts.outDir 
    }, 'Live render complete');
  }
}
```

## Critical Validation Points 🎯

### 1. Vertex AI Integration (HIGHEST PRIORITY)
**Questions to Answer**:
- Does `gemini-2.5-flash-image-preview` model ID work?
- Is the multimodal request structure correct?
- Will ADC authentication work with `vertex-system-471415`?
- Does response parsing extract base64 image data correctly?

**Test Command**: 
```bash
export GOOGLE_CLOUD_PROJECT=vertex-system-471415
export GOOGLE_CLOUD_LOCATION=us-central1
gcloud auth application-default login --account=btang.vertex@gmail.com
NN_LIVE=1 pnpm test -t live
```

### 2. Style-Only Defense Validation
**Must Verify**:
- System prompt guides model behavior effectively
- Hash similarity threshold (10 Hamming distance) catches copying
- Rejection/retry mechanism handles edge cases
- No false positive storms from overly strict validation

### 3. Performance Benchmarks
**Targets from Documentation**:
- Generate 1k prompts: <200ms
- Hash validation: <100ms per image  
- Dry-run estimation: <50ms (no network)
- Style validation: Pass/fail with clear semantics

## Success Criteria ✅
- [ ] `nn --help` shows all commands with proper validation
- [ ] `nn analyze --in ./test-images` creates descriptors.json
- [ ] `nn remix --descriptors ./artifacts/descriptors.json` creates prompts.jsonl
- [ ] `nn render --prompts ./artifacts/prompts.jsonl --style-dir ./images --dry-run` shows cost plan
- [ ] `nn render --live --yes` generates actual PNG with style-only conditioning
- [ ] All tests pass including gated live integration test
- [ ] Performance benchmarks meet documented targets
- [ ] Documentation aligned (no GOOGLE_API_KEY references)
- [ ] ADC authentication working with production project

## Risk Mitigation 🛡️
1. **Model Deprecation**: Mock provider serves as fallback
2. **Cost Runaway**: Dry-run default + explicit confirmation required
3. **Style Copying**: Hash validation with clear rejection policy
4. **Authentication Issues**: Comprehensive ADC validation in smoke tests
5. **Performance Issues**: Benchmarking integrated into CI pipeline

## Next Actions (Execution Order)
1. **Implement CLI skeleton** (PR-CLI-01) - enables manual testing
2. **Wire workflow orchestration** (PR-WF-02) - enables end-to-end dry-run
3. **Add live Vertex integration** (PR-ADP-03) - the critical validation
4. **Create comprehensive tests** (PR-QC-04) - validates production readiness  
5. **Align all documentation** (PR-DOC-05) - ensures consistency

Execute this sprint with `--orchestrator` for optimal tool selection, `--client` for user-focused validation, `--qc` for quality gates, and `--guardrails` for Vibe coding compliance.

**Expected Timeline**: 3-5 days for complete implementation and validation.
**Critical Path**: Live Vertex integration test - this validates or invalidates the entire approach.