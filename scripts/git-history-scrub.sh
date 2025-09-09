#!/usr/bin/env bash

# ============================================================================
# Git History Scrub Script - Remove Sensitive Files from Git History
# ============================================================================
# This script uses BFG Repo-Cleaner to remove sensitive files from git history
# Usage: ./scripts/git-history-scrub.sh
# ============================================================================

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log() {
    echo -e "${BLUE}[$(date '+%H:%M:%S')]${NC} $1"
}

success() {
    echo -e "${GREEN}✅ $1${NC}"
}

warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

error() {
    echo -e "${RED}❌ $1${NC}"
    exit 1
}

# Check if we're in a git repository
if ! git rev-parse --git-dir > /dev/null 2>&1; then
    error "Not in a git repository!"
fi

# Create backup bundle
log "Creating backup bundle..."
git bundle create backup-$(date +%Y%m%d-%H%M%S).bundle --all
success "Backup created"

# Check for BFG
if ! command -v bfg &> /dev/null && ! [ -f bfg.jar ]; then
    warning "BFG Repo-Cleaner not found. Downloading..."
    curl -L https://repo1.maven.org/maven2/com/madgag/bfg/1.14.0/bfg-1.14.0.jar -o bfg.jar
    success "BFG downloaded"
fi

# Define patterns to remove
PATTERNS=(
    "*.env"
    ".env.*"
    "*.key"
    "*.pem"
    "*-key.json"
    "service-account*.json"
    "credentials.json"
    "nb-runner*.json"
)

log "Scanning for sensitive files in history..."

# Check if any sensitive files exist in history
FOUND_FILES=()
for pattern in "${PATTERNS[@]}"; do
    while IFS= read -r file; do
        if [ -n "$file" ]; then
            FOUND_FILES+=("$file")
            warning "Found: $file"
        fi
    done < <(git log --all --name-only --pretty=format: | grep -E "$pattern" | sort -u || true)
done

if [ ${#FOUND_FILES[@]} -eq 0 ]; then
    success "No sensitive files found in git history!"
    exit 0
fi

warning "Found ${#FOUND_FILES[@]} sensitive files in history"
echo ""
read -p "Do you want to remove these files from history? (y/N): " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    log "Aborted by user"
    exit 0
fi

# Use BFG to clean history
log "Cleaning git history..."
if [ -f bfg.jar ]; then
    BFG_CMD="java -jar bfg.jar"
else
    BFG_CMD="bfg"
fi

for pattern in "${PATTERNS[@]}"; do
    log "Removing pattern: $pattern"
    $BFG_CMD --delete-files "$pattern" --no-blob-protection .git
done

# Clean up
log "Running git garbage collection..."
git reflog expire --expire=now --all
git gc --prune=now --aggressive

success "Git history cleaned!"

# Verify
log "Verifying cleanup..."
REMAINING=0
for pattern in "${PATTERNS[@]}"; do
    COUNT=$(git log --all --name-only --pretty=format: | grep -c "$pattern" || echo "0")
    if [ "$COUNT" -gt 0 ]; then
        warning "Pattern $pattern still found $COUNT times"
        REMAINING=$((REMAINING + COUNT))
    fi
done

if [ $REMAINING -eq 0 ]; then
    success "All sensitive files removed from history!"
    echo ""
    warning "IMPORTANT: You must force-push to update remote:"
    echo "  git push --force-with-lease origin $(git branch --show-current)"
else
    error "Some files remain in history. Manual intervention required."
fi

# Final check
log "Running gitleaks scan..."
if command -v gitleaks &> /dev/null; then
    if gitleaks detect --no-git --verbose; then
        success "Gitleaks scan passed!"
    else
        warning "Gitleaks found potential issues. Review above."
    fi
else
    warning "Gitleaks not installed. Install with: brew install gitleaks"
fi

success "Script complete!"