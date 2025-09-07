# Nano Banana Runner (nn)

Terminal image analyzer → prompt remixer → Gemini image generator with style-only conditioning.

## Features

- 🖼️ **Image Analysis**: Extract metadata, palette, and attributes from images
- 🎨 **Prompt Remixing**: Generate variations with deterministic control
- 🤖 **Vertex AI Integration**: Generate images using Gemini 2.5 Flash
- 🎯 **Style-Only Conditioning**: Preserve style without copying composition
- 📊 **CSV Export/Import**: Round-trip prompt editing
- 🔍 **Duplicate Detection**: Find near-duplicates with SimHash
- 🖥️ **Local GUI**: Review and QC prompts before rendering

## Quick Start

```bash
# Install dependencies
pnpm install

# Copy and configure environment
cp .env.example .env
# Edit .env with your GOOGLE_CLOUD_PROJECT

# Set up Google Cloud auth
gcloud auth application-default login
gcloud config set project YOUR_PROJECT_ID

# Build the CLI
pnpm build

# Run analysis on images
pnpm nn analyze --in ./images --out ./artifacts

# Generate prompt variations
pnpm nn remix --descriptors ./artifacts/descriptors.json --out ./artifacts/prompts.jsonl

# Preview render cost (dry-run)
pnpm nn render --prompts ./artifacts/prompts.jsonl --style-dir ./images --dry-run

# Launch GUI for prompt QC
pnpm nn gui
```

## CLI Commands

### Core Commands

```bash
# Analyze images
nn analyze --in <dir> --out <dir> [--concurrency 4]

# Remix prompts
nn remix --descriptors <file> --out <file> [--max-per-image 50] [--seed 42]

# Render images
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

### GUI

```bash
# Start local GUI (opens browser)
nn gui [--port 4173] [--open]
```

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
│   │   ├── geminiImage.ts  # Vertex AI client
│   │   └── fs-manifest.ts  # File operations
│   └── workflows/          # Orchestration
├── web/                    # React GUI
└── tests/                  # Test suite
```

## Environment Variables

```bash
# Required for Vertex AI
GOOGLE_CLOUD_PROJECT=your-project-id
GOOGLE_CLOUD_LOCATION=us-central1

# Optional configuration
NN_PROVIDER=gemini          # or 'mock' for testing
NN_OUT_DIR=./artifacts      # Output directory
NN_CONCURRENCY=2            # Parallel operations
NN_MAX_PER_IMAGE=50         # Max prompts per image
```

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

- **No secrets in code**: Uses ADC for Google Cloud auth
- **Localhost only GUI**: Ephemeral token for session auth
- **CSV injection protection**: Escapes formula prefixes
- **Path validation**: Constrains file access to artifacts/

## Performance

- Export 1k prompts: <300ms
- Dedupe 5k prompts: <500ms p95
- GUI load 1k rows: <300ms TTI
- Streaming for large files

## License

MIT