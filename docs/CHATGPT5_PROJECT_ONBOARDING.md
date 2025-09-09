# Nano Banana Runner - Project Onboarding for ChatGPT-5

## Quick Start
**Project**: Nano Banana Runner (nn) - AI-powered image generation system with style-transfer safety  
**Purpose**: Generate images using Gemini AI while preventing style copying through perceptual hashing  
**Stack**: TypeScript, Node.js 20, Gemini Batch API, Vertex AI, React, Fastify  
**Status**: Production-ready with Batch as primary provider (Vertex entitlement issues)

## Project Structure
```
gemini-image-analyzer/
├── apps/nn/                    # Main CLI application
│   ├── src/
│   │   ├── adapters/           # Provider adapters (Batch, Vertex, Mock)
│   │   ├── core/              # Core functionality (analyze, remix, dedupe)
│   │   ├── workflows/         # High-level operations
│   │   └── cli.ts            # CLI entry point
│   ├── test/                  # Unit and integration tests
│   └── scripts/               # Utility scripts (smoke tests)
├── proxy/                     # API key relay service (Cloudflare Workers)
│   ├── src/
│   │   └── routes/           # API endpoints
│   └── wrangler.toml         # Cloudflare config
├── apps/gui/                  # React UI for prompt QC
└── docs/                      # Documentation

```

## Core Concepts

### 1. Provider System
- **Batch Provider** (Default): Asynchronous batch processing via Gemini Batch API
- **Vertex Provider** (Fallback): Synchronous processing via Vertex AI
- **Auto-fallback**: Vertex → Batch when entitlements missing or probe fails
- **Provider Factory**: Unified interface for all providers

### 2. Style-Only Conditioning
**Problem**: Prevent AI from copying exact poses/subjects from reference images  
**Solution**: Three-layer defense system:
1. System prompt enforcing style-only usage
2. Perceptual hash validation (SimHash < 0.85 threshold)
3. Automatic rejection of near-copies

### 3. Workflow Pipeline
```
1. Analyze → Extract colors, shapes, textures from images
2. Remix → Generate diverse prompts from descriptors
3. Render → Submit to Gemini for image generation
4. QC → GUI for prompt review and approval
```

## Current Implementation Status

### ✅ Completed
- Core modules (analyze, remix, idempotency)
- Gemini Batch adapter with guardrails
- Provider factory with auto-fallback
- Probe system for model health checking
- React GUI for prompt QC
- Proxy service for secure API key handling
- Comprehensive test coverage
- Smoke tests and validation scripts

### 🔄 In Progress
- Migration from Vertex to Batch (entitlement issues)
- Publisher model probe improvements
- GUI enhancements

### ⏳ Pending
- Production deployment
- Performance optimizations
- Advanced deduplication

## Key Technical Decisions

### 1. Batch as Primary Provider
**Reason**: Vertex AI entitlement issues (404 errors for Gemini 1.5 models)  
**Impact**: All operations default to Batch unless explicitly overridden  
**Fallback**: Automatic when Vertex unavailable

### 2. Proxy Architecture
**Reason**: Secure API key handling without exposing in CLI  
**Implementation**: Cloudflare Workers relay at http://127.0.0.1:8787  
**Benefits**: Key isolation, rate limiting, monitoring

### 3. Style Guard Implementation
**Approach**: Multi-layer validation with hash thresholds  
**Metrics**: SimHash for structure, color histogram for palette  
**Enforcement**: Automatic rejection of copies

## Environment Configuration

### Required
```bash
# For Batch (primary)
NN_PROVIDER=batch              # Force batch provider
NN_OUT_DIR=./artifacts        # Output directory

# For Vertex (if available)
GOOGLE_CLOUD_PROJECT=project-id
GOOGLE_CLOUD_LOCATION=us-central1

# Proxy (never in CLI)
GEMINI_BATCH_API_KEY=xxx      # Set in proxy/.env only
```

### Optional
```bash
NN_DEBUG_VERTEX=1             # Debug logging
NN_MAX_CONCURRENCY=2          # Parallel requests
NN_PRICE_PER_IMAGE_USD=0.0025 # Cost estimation
```

## Common Operations

### Setup
```bash
# Install and build
pnpm install
pnpm build

# Start proxy (required for Batch)
cd proxy && pnpm dev

# Run smoke test
./scripts/smoke_batch.sh
```

### Basic Workflow
```bash
# 1. Analyze images
nn analyze --in ./images --out ./artifacts

# 2. Generate prompts
nn remix --descriptors ./artifacts/descriptors.json

# 3. Review in GUI
open http://127.0.0.1:8787/app

# 4. Submit batch (dry-run first)
nn batch submit --prompts ./artifacts/prompts.jsonl --dry-run

# 5. Submit for real
nn batch submit --prompts ./artifacts/prompts.jsonl --live --yes
```

### Provider Switching
```bash
# Use Batch (default)
nn render --dry-run

# Force Vertex (if available)
nn render --provider vertex --dry-run

# Check current provider
nn render --dry-run 2>&1 | grep provider
```

## Known Issues & Solutions

### Issue: Vertex 404 Errors
**Cause**: Project lacks entitlement to Gemini 1.5 models  
**Solution**: System auto-falls back to Batch provider  
**Workaround**: Use Gemini 2.0 Flash Experimental for text-only

### Issue: Authentication Errors
**Cause**: Missing or invalid credentials  
**Solution**: 
- For Batch: Set GEMINI_BATCH_API_KEY in proxy/.env
- For Vertex: Configure ADC with gcloud auth

### Issue: Large Batch Failures
**Cause**: Exceeding size limits  
**Solution**: Auto-split enabled, max 2000 images per job

## Testing Strategy

### Unit Tests
```bash
pnpm test              # All tests
pnpm test:watch       # Watch mode
```

### Integration Tests
```bash
# Smoke test (verifies Batch working)
./scripts/smoke_batch.sh

# End-to-end test
pnpm test:e2e
```

### Manual Testing
1. Always use `--dry-run` first
2. Check logs for provider confirmation
3. Verify cost estimates before `--live`

## Code Quality Standards

### Vibe Principles (Top 5)
1. **Small, Composable**: ≤300 LOC per file
2. **Typed + Validated**: Zod schemas everywhere
3. **Secrets Stay Secret**: No keys in code/logs
4. **Minimal State**: Filesystem as truth
5. **Fail Fast**: RFC 7807 Problem+JSON errors

### Commit Guidelines
- Feature branches only (never main)
- Atomic commits with clear messages
- Run tests before committing
- No secrets in commits (use .gitignore)

## Troubleshooting Quick Reference

| Problem | Solution |
|---------|----------|
| "Provider not found" | Check NN_PROVIDER env var |
| "401 Unauthorized" | Verify API keys in proxy |
| "404 Model not found" | Auto-fallback to Batch |
| "Probe failed" | Run `nn probe` to refresh |
| "Too many images" | Reduce batch size or enable splitting |

## Contact & Resources

**Project Owner**: Bradley Tangonan  
**Primary Repo**: /Users/bradleytangonan/Desktop/my apps/gemini image analyzer  
**Documentation**: This file + README.md + IMPLEMENTATION_PLAN.md  

## For ChatGPT-5: Key Context

When working on this project:
1. **Always default to Batch provider** - Vertex has entitlement issues
2. **Never expose API keys** - Use proxy service only
3. **Test with --dry-run first** - Prevent accidental charges
4. **Follow Vibe principles** - Small files, strong typing, fail fast
5. **Check probe cache** - Determines provider availability

The project is functional but requires careful provider management due to Google Cloud entitlement restrictions. Batch mode works reliably for production use.