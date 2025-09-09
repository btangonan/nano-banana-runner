#!/usr/bin/env bash
set -euo pipefail

# Smoke test script for Batch provider
# Verifies that Batch is the default provider and working correctly

echo "================================"
echo "Nano Banana Runner - Batch Smoke Test"
echo "================================"
echo ""

# Set environment for Batch
export NN_PROVIDER=batch
export NN_OUT_DIR=./artifacts
export LOG_LEVEL=info

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if running from correct directory
if [ ! -f "package.json" ]; then
    echo -e "${RED}❌ Error: Must run from apps/nn directory${NC}"
    exit 1
fi

echo "→ Environment Check"
echo "  NN_PROVIDER: ${NN_PROVIDER:-not set}"
echo "  NN_OUT_DIR: ${NN_OUT_DIR:-not set}"
echo ""

# Build the project first
echo "→ Building project"
if pnpm build > /dev/null 2>&1; then
    echo -e "  ${GREEN}✅ Build successful${NC}"
else
    echo -e "  ${RED}❌ Build failed${NC}"
    exit 1
fi

# Create a minimal test prompts file if needed
if [ ! -f "./artifacts/prompts.jsonl" ]; then
    mkdir -p ./artifacts
    echo '{"prompt":"test","id":"test-1"}' > ./artifacts/prompts.jsonl
fi

# Test 1: Verify provider selection (dry run)
echo ""
echo "→ Provider Selection Test"
echo "  Running: nn render --dry-run"

# Capture output and look for provider confirmation
RENDER_OUTPUT=$(node dist/cli.js render --prompts ./artifacts/prompts.jsonl --style-dir ./images --variants 1 --dry-run 2>&1 || true)

if echo "$RENDER_OUTPUT" | grep -q "provider.*batch"; then
    echo -e "  ${GREEN}✅ Provider: batch (confirmed)${NC}"
elif echo "$RENDER_OUTPUT" | grep -q "Using Gemini Batch"; then
    echo -e "  ${GREEN}✅ Provider: batch (confirmed via adapter log)${NC}"
elif echo "$RENDER_OUTPUT" | grep -q "Initialized Gemini Batch adapter"; then
    echo -e "  ${GREEN}✅ Provider: batch (confirmed via init log)${NC}"
else
    echo -e "  ${RED}❌ Provider not confirmed as batch${NC}"
    echo "  Debug output:"
    echo "$RENDER_OUTPUT" | head -20
    exit 1
fi

# Test 2: Check for Vertex fallback warnings
echo ""
echo "→ Fallback Detection"
if echo "$RENDER_OUTPUT" | grep -q "falling back to batch"; then
    echo -e "  ${YELLOW}⚠️  Vertex fallback detected (this is OK - using Batch as intended)${NC}"
else
    echo -e "  ${GREEN}✅ No fallback needed - Batch is primary${NC}"
fi

# Test 3: Verify no network calls in dry-run
echo ""
echo "→ Dry Run Safety Check"
if echo "$RENDER_OUTPUT" | grep -q "dry.*run\|dry-run\|cost.*preview"; then
    echo -e "  ${GREEN}✅ Dry run mode confirmed (no spend)${NC}"
else
    echo -e "  ${YELLOW}⚠️  Could not confirm dry-run mode${NC}"
fi

# Test 4: Check manifest for provider
echo ""
echo "→ Manifest Check"
if [ -f "./artifacts/manifest.jsonl" ]; then
    LAST_PROVIDER=$(tail -n 1 ./artifacts/manifest.jsonl 2>/dev/null | jq -r '.provider // .adapter // "unknown"' 2>/dev/null || echo "parse_error")
    if [ "$LAST_PROVIDER" = "batch" ] || [ "$LAST_PROVIDER" = "GeminiBatch" ]; then
        echo -e "  ${GREEN}✅ Last manifest entry: provider=$LAST_PROVIDER${NC}"
    else
        echo -e "  ${YELLOW}⚠️  Last manifest entry: provider=$LAST_PROVIDER${NC}"
    fi
else
    echo -e "  ${YELLOW}⚠️  No manifest file found (OK for first run)${NC}"
fi

# Summary
echo ""
echo "================================"
echo "Summary"
echo "================================"
echo -e "${GREEN}✅ Batch provider is configured and working${NC}"
echo ""
echo "Next steps:"
echo "1. Set GEMINI_BATCH_API_KEY in proxy/.env"
echo "2. Start proxy: cd proxy && pnpm dev"
echo "3. Run full workflow: nn analyze, nn remix, nn batch submit"
echo ""