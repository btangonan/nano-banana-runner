# Nano Banana Runner (nn)

Style-transfer-safe batch image generation using Gemini Batch API (primary) with comprehensive guardrails and Vertex AI fallback.

## Features

- **Async batch processing** via Gemini Batch API (primary provider)
- **Comprehensive guardrails**: Cost estimation, size limits, auto-compression
- **Style-only image generation** with perceptual hash validation
- **Resumable jobs** with manifest tracking
- **Secure API key handling** via proxy service
- **Vertex AI fallback** for synchronous operations
- **CLI safety**: --dry-run defaults, --live --yes confirmation
- **Provider factory** with unified interface (batch/vertex/mock)
- **Debug mode** with request/response logging

## Prerequisites

1. **Google Cloud Project** with Vertex AI API enabled
2. **Application Default Credentials (ADC)** configured
3. **Node.js 20+** and pnpm

## Setup

### 1. Install Dependencies
```bash
pnpm install
pnpm build
```

### 2. Start Batch Relay Proxy
The proxy keeps API keys server-side, never exposing them to the CLI.

```bash
# Setup proxy
cd proxy
cp .env.example .env
# Edit .env and set GEMINI_BATCH_API_KEY for local dev

pnpm install
pnpm run dev
# Proxy now running on http://127.0.0.1:8787
```

### 3. Configure Google Cloud (for Vertex fallback)
```bash
# Set your project
gcloud config set project YOUR_PROJECT_ID

# Authenticate with ADC
gcloud auth application-default login

# Enable Vertex AI
gcloud services enable aiplatform.googleapis.com
```

### 4. Verify Setup
```bash
# Check proxy health
curl http://127.0.0.1:8787/healthz

# Verify Vertex connectivity (optional, for fallback)
nn probe
```

## Commands

### Batch Commands (Primary - Gemini Batch)

#### `nn batch submit`
Submit a batch job for asynchronous image generation.

```bash
# Dry run (estimate only - default)
nn batch submit --prompts artifacts/prompts.jsonl --style-dir ./styles

# Live submission (requires confirmation)
nn batch submit --prompts artifacts/prompts.jsonl --style-dir ./styles --live --yes
```

#### `nn batch poll`
Check batch job status.

```bash
# Single status check
nn batch poll --job JOB_ID

# Watch until complete
nn batch poll --job JOB_ID --watch
```

#### `nn batch fetch`
Download completed batch results.

```bash
nn batch fetch --job JOB_ID --out artifacts/renders
```

#### `nn batch resume`
Resume a job (poll and fetch if complete).

```bash
nn batch resume --job JOB_ID --out artifacts/renders
```

#### `nn batch cancel`
Cancel a running batch job.

```bash
nn batch cancel --job JOB_ID
```

### Vertex AI Commands (Fallback)

#### `nn probe`
Verify Vertex AI connectivity and model availability. Creates a 24-hour cache file to prevent accidental API calls.

```bash
nn probe
```

### `nn analyze`
Extract metadata and attributes from images for prompt generation.

```bash
nn analyze --in ./images --out artifacts/descriptors.json
```

### `nn remix`
Generate prompt variations from image descriptors.

```bash
nn remix --descriptors artifacts/descriptors.json --out artifacts/prompts.jsonl
```

### `nn render`
Generate images using Gemini 2.5 Flash with style-only conditioning.

```bash
# Dry run (cost estimation only - default)
nn render --prompts artifacts/prompts.jsonl --style-dir ./styles

# Live generation (requires confirmation)
nn render --prompts artifacts/prompts.jsonl --style-dir ./styles --live --yes
```

Options:
- `--variants <n>`: Number of variants per prompt (1-3)
- `--concurrency <n>`: Parallel requests (1-4)
- `--dry-run`: Cost estimation only (default)
- `--live`: Perform actual generation
- `--yes`: Confirm spending for live generation

## Environment Variables

### Batch Relay (Primary)
- `NN_PROVIDER`: Provider selection (default: 'batch', options: 'batch'|'vertex'|'mock')
- `BATCH_PROXY_URL`: Batch relay URL (default: http://127.0.0.1:8787)
- `GEMINI_BATCH_API_KEY`: API key for proxy (set in proxy/.env, never in CLI)
- `BATCH_MAX_BYTES`: Batch size limit (default: 100MB)

### Batch Guardrails
- `JOB_MAX_BYTES`: Job size limit (default: 200MB)
- `ITEM_MAX_BYTES`: Item size limit (default: 8MB)
- `MAX_IMAGES_PER_JOB`: Image count limit (default: 2000)
- `PREFLIGHT_COMPRESS`: Auto-compress images (default: true)
- `PREFLIGHT_SPLIT`: Auto-split large jobs (default: true)

### Vertex AI (Fallback)
- `GOOGLE_CLOUD_PROJECT`: Your GCP project ID (or set via gcloud)
- `GOOGLE_CLOUD_LOCATION`: Vertex AI location (default: us-central1)

### Optional
- `NN_DEBUG_VERTEX=1`: Enable debug logging with request/response tapping
- `NN_MAX_CONCURRENCY`: Max parallel requests (default: 2, max: 4)
- `NN_OUT_DIR`: Output directory (default: artifacts)
- `NN_PRICE_PER_IMAGE_USD`: Cost per image for estimation
- `NN_STYLE_GUARD_ENABLED`: Enable/disable style guard (default: true)

## Provider Switching

### Default Provider: Batch
The application defaults to **Gemini Batch** provider for all operations unless explicitly configured otherwise. This ensures cost-effective batch processing and prevents accidental Vertex AI usage.

### Provider Selection Priority
1. **Command-line flag**: `--provider vertex` (per-command override)
2. **Environment variable**: `NN_PROVIDER=vertex` (session default)
3. **Default**: `batch` (when neither flag nor env is set)

### Switching to Batch (Default)
```bash
# Option 1: Use default (no configuration needed)
nn render --dry-run  # Uses batch by default

# Option 2: Explicit environment variable
export NN_PROVIDER=batch
nn render --dry-run

# Option 3: Create .env file for persistence
echo "NN_PROVIDER=batch" > .env
```

### Switching to Vertex AI
```bash
# Option 1: Per-command override
nn render --provider vertex --dry-run

# Option 2: Session-wide
export NN_PROVIDER=vertex
nn render --dry-run
```

### Automatic Fallback
When Vertex AI is requested but unavailable (missing credentials, entitlement issues, or probe failures), the system automatically falls back to Batch provider with a warning log:
- `reason: missing_project_config` - GOOGLE_CLOUD_PROJECT not set
- `reason: model_unhealthy` - Model marked unhealthy in probe cache
- `reason: vertex_probe_failed` - Vertex AI probe failed

### Verify Current Provider
```bash
# Run smoke test to verify Batch is active
./scripts/smoke_batch.sh

# Check logs for provider confirmation
nn render --dry-run 2>&1 | grep -i "provider\|batch\|vertex"
```

## Safety Features

### Probe Requirement
Live generation requires a recent probe (within 24 hours) to prevent accidental API calls:
```bash
nn probe  # Creates probe.ok cache
nn render --live --yes  # Now allowed
```

### Style Guard
Perceptual hash validation prevents generating exact copies:
- 64-bit pHash on 32x32 grayscale
- Configurable Hamming distance threshold
- Automatic retry on style copy detection

### Debug Mode
Enable request/response logging for troubleshooting:
```bash
NN_DEBUG_VERTEX=1 nn render --live --yes
# Logs saved to debug/vertex-*.json with redacted sensitive data
```

## Testing

### Gated Live Test
Single-shot validation with explicit confirmation:
```bash
node test/live/gated-test.js --yes
```

### Style Guard Calibration
Tune thresholds with known copy/original pairs:
```bash
# Prepare calibration dataset:
# calibration/references/*.png  # Style references
# calibration/copies/*.png      # Known copies (should reject)
# calibration/originals/*.png   # Good transfers (should pass)

node scripts/calibrate-guard.js calibration
```

## Architecture

### Security Architecture
- **Proxy-based API management**: Keys server-side only, never exposed to CLI
- **ADC fallback**: Vertex AI uses Application Default Credentials (when enabled)
- **Redacted logging**: No sensitive data in logs

### Batch Guardrails
- **Cost estimation**: Preview costs before live execution
- **Size limits**: Job, item, and image count boundaries
- **Auto-compression**: Resize images to 1024px, JPEG quality 75
- **Deduplication**: SHA256 hashing prevents duplicate references
- **Job splitting**: Large jobs automatically chunked
- **CLI safety**: --dry-run defaults, --live --yes confirmation gates

### Three-Layer Style Defense
1. System prompt with style-only instruction
2. Multimodal parts with style references
3. Post-generation perceptual hash validation

### Provider Factory Pattern
- **Unified interface**: Abstract async batch vs sync vertex differences
- **Automatic selection**: Batch (primary) → Vertex (fallback) → Mock (testing)
- **Result handling**: Batch jobs vs direct results seamlessly managed

## Troubleshooting

### "No recent probe found"
Run `nn probe` first to verify connectivity.

### "GOOGLE_CLOUD_PROJECT is required"
Set your project: `gcloud config set project YOUR_PROJECT_ID`

### "Permission denied" errors
Ensure your account has Vertex AI permissions:
```bash
gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="user:YOUR_EMAIL" \
  --role="roles/aiplatform.user"
```

### Debug API calls
```bash
NN_DEBUG_VERTEX=1 nn probe
# Check debug/*.json for request/response details
```

## License

MIT