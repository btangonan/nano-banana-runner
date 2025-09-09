# 🚀 Nano Banana Runner - Quick Reference

## Current Status
**GUI**: ✅ Working (drag & drop upload, real-time analysis)  
**Proxy**: ✅ Working (batch routes registered, health checks)  
**Toast Fix**: ✅ Resolved (lucide-react icons updated)  
**Batch Routes**: ✅ Fixed (fastify-plugin removed)  
**Startup Script**: ✅ Created (bulletproof process management)  
**Batch Processing**: ✅ In-memory job tracking implemented  
**CORS**: ✅ Enhanced to support proxy self-origin requests

## Starting the Application

### Quick Start
```bash
# Recommended: Use the bulletproof startup script
./start-clean.sh

# Manual start (if script fails)
cd apps/nn/proxy && pnpm dev      # Terminal 1
cd apps/nn/apps/gui && pnpm dev   # Terminal 2
```

### Startup Script Commands
```bash
./start-clean.sh              # Start all services
./start-clean.sh --clear-cache # Start with cache clearing
./start-clean.sh stop         # Stop all services
./start-clean.sh restart      # Restart services
./start-clean.sh status       # Check service status
./start-clean.sh cleanup      # Aggressive cleanup
./start-clean.sh logs         # View recent logs
```

## Key URLs
- **GUI**: http://localhost:5174/app/
- **Proxy API**: http://127.0.0.1:8787
- **Health Check**: http://127.0.0.1:8787/healthz
- **Batch Submit**: http://127.0.0.1:8787/batch/submit

## Recent Fixes (2025-09-08)

### 1. Toast Component Crash
```typescript
// Problem: lucide-react v0.445.0 renamed icons
// Solution: Updated imports
import { CircleCheck, TriangleAlert } from "lucide-react"
```

### 2. Batch Routes 404
```typescript
// Problem: fastify-plugin wrapper prevented registration
// Solution: Removed wrapper
export default async function batchRoutes(app: FastifyInstance) {
  // routes...
}
```

### 3. Multiple Server Instances
```bash
# Problem: Old servers kept running
# Solution: Created start-clean.sh script
# - Kills processes on ports 8787, 5174, 24678
# - Tracks PIDs for clean shutdown
# - Verifies health checks
```

## Development Commands

```bash
# Development
pnpm dev              # Start dev server
pnpm test:watch       # Run tests in watch mode
pnpm typecheck        # Check TypeScript
pnpm lint            # Run linter

# Testing
pnpm test            # Run unit tests
pnpm test:e2e        # Run E2E tests
pnpm test:coverage   # Generate coverage report

# Building
pnpm build           # Build for production
pnpm preview         # Preview production build
```

## CLI Commands

```bash
# Core workflow
nn analyze --in ./images --out ./artifacts
nn remix --descriptors ./artifacts/descriptors.json
nn batch submit --prompts ./artifacts/prompts.jsonl --dry-run
nn gui                # Launch web interface

# Batch operations
nn batch poll --job <id> [--watch]
nn batch fetch --job <id> [--out <dir>]

# Extract generated images from batch results
curl -s "http://127.0.0.1:8787/batch/job-[JOB_ID]/results" | \
  jq -r '.results[0].outUrl' | \
  sed 's/^data:image\/[^;]*;base64,//' | \
  base64 -d > generated_image.png

# CSV operations
nn prompts export --in <jsonl> --out <csv>
nn prompts import --csv <file> --in <jsonl> --out <jsonl>

# Deduplication
nn prompts dedupe report --in <jsonl>
nn prompts dedupe collapse --in <jsonl> --out <jsonl> --yes
```

## Project Structure

```
/Users/bradleytangonan/Desktop/my apps/gemini image analyzer/
├── apps/nn/
│   ├── proxy/          # Batch relay proxy (Fastify)
│   ├── apps/gui/       # React UI (Vite + TypeScript)
│   └── src/            # Core CLI logic
├── docs/
│   ├── archive/        # Old documentation
│   │   ├── sprints/    # Sprint reports
│   │   └── bugs/       # Resolved bug reports
│   └── bugs/           # Active bug reports
├── start-clean.sh      # Bulletproof startup script
├── README.md           # Main documentation
├── CLAUDE.md           # Claude Code operating manual
└── QUICK_REFERENCE.md  # This file
```

## Environment Variables

```bash
# Batch-first Architecture
NN_PROVIDER=batch
BATCH_PROXY_URL=http://127.0.0.1:8787
BATCH_MAX_BYTES=104857600

# Optional: Vertex AI Fallback
GOOGLE_CLOUD_PROJECT=your-project-id
GOOGLE_CLOUD_LOCATION=us-central1

# General Configuration
NN_OUT_DIR=./artifacts
NN_CONCURRENCY=2
NN_MAX_PER_IMAGE=50
```

## Troubleshooting

### GUI Not Loading
```bash
# 1. Check if old processes are running
./start-clean.sh status

# 2. Kill all and restart
./start-clean.sh cleanup
./start-clean.sh --clear-cache
```

### Batch Routes 404
```bash
# Verify batch routes are registered
curl http://127.0.0.1:8787/healthz
# Should show: {"status":"ok"}

# Check proxy logs
./start-clean.sh logs
```

### Toast Component Errors
```bash
# If you see "Element type is invalid...got: undefined"
# The fix is already applied in:
# - apps/nn/apps/gui/src/components/ui/Toast.tsx
# - apps/nn/apps/gui/src/hooks/useToast.ts
```

### Port Already in Use
```bash
# Use the cleanup command
./start-clean.sh cleanup

# Or manually kill processes
lsof -ti :8787 | xargs kill -9
lsof -ti :5174 | xargs kill -9
```

## Quick Checks

```bash
# Is proxy running?
curl http://127.0.0.1:8787/healthz

# Are batch routes registered?
curl -I http://127.0.0.1:8787/batch/submit

# Is GUI accessible?
curl -I http://localhost:5174/app/

# Check all services
./start-clean.sh status
```

## Git Workflow

```bash
# Always work on feature branches
git checkout -b feature/[name]

# Check status before committing
git status
git diff

# Commit with meaningful messages
git add [files]
git commit -m "feat: [description]"

# Never work on main
git branch  # Should show feature/*, not main
```

---
Updated: 2025-09-09 | All systems operational with batch processing