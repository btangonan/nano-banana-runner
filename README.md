# Nano Banana Runner (nn)

Terminal image analyzer → prompt remixer → Gemini image generator with style-only conditioning.

## Features

- 🖼️ **Image Analysis**: Extract metadata, palette, and attributes from images
- 🎨 **Prompt Remixing**: Generate variations with deterministic control
- 🤖 **Mock Batch Processing**: In-memory job tracking for Gemini image generation
- 🔄 **Vertex AI Fallback**: Direct Vertex API for sync operations when needed
- 🎯 **Style-Only Conditioning**: Preserve style without copying composition
- 📊 **CSV Export/Import**: Round-trip prompt editing
- 🔍 **Duplicate Detection**: Find near-duplicates with SimHash
- 🖥️ **Local GUI**: Review and QC prompts before rendering
- 💾 **In-Memory Job Storage**: Track batch jobs with complete lifecycle management
- 🔐 **Enhanced CORS**: Support for proxy self-origin requests
- ⚡ **Direct Mode** (NEW): Power users can bypass remix and submit JSON directly (feature-flagged)
- 🛡️ **Zero-Risk Refactoring**: Feature-flagged code improvements with instant rollback capability

## Quick Start

```bash
# Install dependencies
pnpm install

# Configure environment (Batch-first, proxy-based)
cp .env.example .env
# Edit .env with:
#   BATCH_PROXY_URL=http://127.0.0.1:8787 (or your proxy URL)
#   NN_PROVIDER=batch (default)
#   PREFLIGHT_COMPRESS=true (auto-compress reference images)
#   PREFLIGHT_SPLIT=true (auto-split large jobs)

# Optional: For Vertex AI fallback
#   GOOGLE_CLOUD_PROJECT=your-project-id
#   gcloud auth application-default login

# Build the CLI
pnpm build

# Run analysis on images
pnpm nn analyze --in ./images --out ./artifacts

# Generate prompt variations
pnpm nn remix --descriptors ./artifacts/descriptors.json --out ./artifacts/prompts.jsonl

# Preview batch cost (dry-run) - uses proxy
pnpm nn batch submit --prompts ./artifacts/prompts.jsonl --style-dir ./images --dry-run

# Launch GUI for prompt QC
pnpm nn gui
```

## Starting the Application

### Using the Startup Script (Recommended)

A bulletproof startup script ensures clean launches by killing stale processes, clearing caches, and verifying services:

```bash
# Start all services with automatic cleanup
./start-clean.sh

# Start with cache clearing
./start-clean.sh --clear-cache

# Other commands
./start-clean.sh stop      # Stop all services
./start-clean.sh restart   # Restart services
./start-clean.sh status    # Check service status
./start-clean.sh cleanup   # Aggressive cleanup
./start-clean.sh logs      # View recent logs
```

The script handles:
- Killing processes on ports 8787 (proxy), 5174 (GUI), 24678 (Vite HMR)
- Health checks and batch route verification
- PID tracking for clean shutdowns
- Automatic log rotation

### Manual Start

```bash
# Terminal 1: Start proxy server
cd apps/nn/proxy
pnpm dev

# Terminal 2: Start GUI server
cd apps/nn/apps/gui
pnpm dev

# Access the application
open http://localhost:5174/app/
```

## CLI Commands

### Core Commands

```bash
# Analyze images
nn analyze --in <dir> --out <dir> [--concurrency 4]

# Remix prompts
nn remix --descriptors <file> --out <file> [--max-per-image 50] [--seed 42]

# Batch image generation (default, uses proxy)
nn batch submit --prompts <file> --style-dir <dir> [--dry-run] [--live --yes]
nn batch poll --job <id> [--watch]
nn batch fetch --job <id> [--out <dir>]

# Direct render (Vertex fallback)
nn render --prompts <file> --style-dir <dir> [--dry-run] [--live --yes]
```

### CSV Operations

```bash
# Export prompts to CSV
nn prompts export --in <jsonl> --out <csv>

# Import CSV with changes
nn prompts import --csv <file> --in <jsonl> --out <jsonl> [--dry-run]
```

### Duplicate Detection

```bash
# Find duplicates (report only)
nn prompts dedupe report --in <jsonl>

# Tag duplicates
nn prompts dedupe tag --in <jsonl> --out <jsonl>

# Remove duplicates
nn prompts dedupe collapse --in <jsonl> --out <jsonl> --yes
```

### GUI (Web Interface)

The Nano Banana Studio provides a web-based interface served by the proxy at `/app/`.

**Features:**
- **Drag & Drop Upload**: Visual file upload with previews and validation
- **Image Analysis**: Real-time analysis with progress tracking  
- **Session Management**: "New Session" button to clear previous uploads and fix image counts
- **Security**: Client and server-side validation, rate limiting
- **Responsive**: Works on desktop and tablet devices

**Session Management (NEW):**
- **New Session Button**: Clears all server-side images to start fresh analysis
- **Start Over Button**: Resets UI state without clearing server images
- **Batch Support**: Upload multiple times within same session until explicitly cleared

**Access:**
```bash
# Start proxy server (serves GUI at /app)
cd proxy && pnpm dev

# Or access directly
open http://127.0.0.1:8787/app
```

**Development:**
```bash
# GUI development server (with API proxy)
cd apps/gui && pnpm dev
open http://localhost:5173
```

**Architecture:**
- React + TypeScript frontend with Tailwind CSS
- Single-origin deployment (served by proxy)  
- Zod contracts shared between client/server
- RFC 7807 error handling with user-friendly messages

## Architecture

```
apps/nn/
├── src/
│   ├── cli.ts              # Commander CLI entry
│   ├── types.ts            # Zod schemas
│   ├── core/               # Business logic
│   │   ├── analyze.ts      # Image analysis
│   │   ├── remix.ts        # Prompt generation
│   │   └── dedupe.ts       # Duplicate detection
│   ├── adapters/           # External integrations
│   │   ├── providerFactory.ts   # Unified provider interface
│   │   ├── geminiBatch.ts       # Gemini Batch API client (default)
│   │   ├── batchRelayClient.ts  # Proxy client
│   │   ├── geminiImage.ts       # Vertex AI client (fallback)
│   │   └── fs-manifest.ts       # File operations
│   ├── workflows/          # Orchestration
│   │   └── preflight.ts    # Size limits and validation
│   └── types/              # Schema definitions
├── web/                    # React GUI
├── proxy/                  # Batch relay proxy service
│   ├── src/
│   │   ├── server.ts       # Fastify server
│   │   ├── routes/batch.ts # Batch API routes
│   │   └── clients/        # Gemini Batch client
└── tests/                  # Test suite
```

## Environment Variables

```bash
# Batch-first Architecture (Default)
NN_PROVIDER=batch           # 'batch' (default) | 'vertex' | 'mock'
BATCH_PROXY_URL=http://127.0.0.1:8787  # Proxy server URL
BATCH_MAX_BYTES=104857600   # 100MB batch size limit

# Batch Guardrails
JOB_MAX_BYTES=209715200     # 200MB job size limit
ITEM_MAX_BYTES=8388608      # 8MB item size limit
MAX_IMAGES_PER_JOB=2000     # Image count limit per job

# Optional: Vertex AI Fallback
GOOGLE_CLOUD_PROJECT=your-project-id  # Required for vertex provider
GOOGLE_CLOUD_LOCATION=us-central1     # Vertex AI region

# General Configuration
NN_OUT_DIR=./artifacts      # Output directory
NN_CONCURRENCY=2            # Parallel operations
NN_MAX_PER_IMAGE=50         # Max prompts per image
NN_PRICE_PER_IMAGE_USD=0.0025  # Cost estimation (optional)

# Feature Flags
NN_STYLE_GUARD_ENABLED=true # Style-only conditioning enforcement
NN_ENABLE_CACHE=true        # Response caching
PREFLIGHT_COMPRESS=true     # Reference image compression
PREFLIGHT_SPLIT=true        # Auto-split large jobs

# Direct Mode (Power User Feature)
NN_ENABLE_DIRECT_MODE=false # Enable Direct JSON submission (OFF by default)
DIRECT_MAX_ROWS=200         # Max rows per Direct Mode batch
DIRECT_MAX_PROMPT_LEN=4000  # Max prompt length in Direct Mode

# Zero-Risk Code Quality Improvements (NEW)
USE_REFACTORED_GEMINI=false # Use modularized gemini adapter (OFF by default)
USE_COMPUTED_HASH=false     # Use deterministic hash computation (OFF by default)
USE_MODEL_TAGGER=false      # Use ML-based image tagging (OFF by default)
USE_STRUCTURED_LOGGING=false # Use structured logging instead of console (OFF by default)
```

## Batch Processing Implementation

Since Gemini doesn't provide a true batch API, we implement a mock batch system with in-memory job tracking:

### Architecture
- **In-Memory Storage**: Jobs stored in a Map with complete lifecycle tracking
- **Job States**: `processing` → `completed` (or `failed`)
- **Result Format**: Base64 data URLs for generated images
- **CORS Support**: Proxy allows self-origin requests (ports 8787)

### Extracting Generated Images
```bash
# Extract base64 image from batch results
curl -s "http://127.0.0.1:8787/batch/job-[JOB_ID]/results" | \
  jq -r '.results[0].outUrl' | \
  sed 's/^data:image\/[^;]*;base64,//' | \
  base64 -d > generated_image.png
```

## Proxy Service

The Batch Relay Proxy securely manages Gemini Batch API keys server-side:

```bash
# Start proxy in development
cd proxy
cp .env.example .env
# Edit .env with GEMINI_BATCH_API_KEY
pnpm install
pnpm dev  # Runs on http://127.0.0.1:8787

# Health check
curl http://127.0.0.1:8787/healthz

# Production deployment (Cloud Run)
gcloud run deploy nn-batch-relay \
  --source proxy/ \
  --set-secrets="GEMINI_BATCH_API_KEY=gemini-batch-key:latest" \
  --region=us-central1
```

**Security Features:**
- API keys never exposed to CLI client
- Redacted logging (no sensitive data in logs)
- Local/Cloud Run deployment options
- Secret Manager integration for production

## Development

```bash
# Install dependencies
pnpm install

# Run in development mode
pnpm dev

# Run tests
pnpm test

# Type checking
pnpm typecheck

# Linting
pnpm lint

# Format code
pnpm format
```

## Testing

```bash
# Unit tests
pnpm test

# E2E tests
pnpm test:e2e

# Coverage report
pnpm test:coverage

# Performance benchmarks
pnpm bench

# Full validation
pnpm validate
```

## Security

- **Proxy-based API key management**: Keys stored server-side, never exposed to CLI
- **ADC fallback**: Vertex AI uses Application Default Credentials (when enabled)
- **Localhost only GUI**: Ephemeral token for session auth
- **Redacted logging**: No sensitive data in logs (API keys, responses)
- **CSV injection protection**: Escapes formula prefixes
- **Path validation**: Constrains file access to artifacts/
- **Style-only conditioning**: Prevents composition copying via perceptual hashing
- **Batch guardrails**: Cost estimation, size limits, auto-compression, job splitting
- **CLI safety**: --dry-run defaults, --live --yes confirmation gates

## Performance

- Export 1k prompts: <300ms
- Dedupe 5k prompts: <500ms p95
- GUI load 1k rows: <300ms TTI
- Streaming for large files

## License

MIT