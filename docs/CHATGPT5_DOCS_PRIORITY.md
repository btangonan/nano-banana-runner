# Documentation Priority for ChatGPT-5 Onboarding

## Essential Documents (Submit These First)

### 1. Project Onboarding (NEW - MOST IMPORTANT)
**File**: `docs/CHATGPT5_PROJECT_ONBOARDING.md`  
**Why**: Complete project overview specifically written for AI onboarding  
**Content**: Architecture, current status, key decisions, troubleshooting  

### 2. Main Application README  
**File**: `apps/nn/README.md`  
**Why**: Technical implementation details, CLI commands, environment setup  
**Content**: Features, prerequisites, usage examples, safety features  

### 3. Implementation Plan
**File**: `IMPLEMENTATION_PLAN.md`  
**Why**: Original architecture and design decisions  
**Content**: System design, component breakdown, technical choices  

## Secondary Documents (If Context Allows)

### 4. Quick Reference
**File**: `QUICK_REFERENCE.md`  
**Why**: Command cheat sheet and common operations  
**Content**: CLI commands, workflows, troubleshooting  

### 5. Claude Operating Manual
**File**: `CLAUDE.md`  
**Why**: Shows how another AI successfully works with the codebase  
**Content**: Vibe principles, testing strategy, git workflow  
**Note**: Explains project-specific coding standards and practices

## Optional/Reference Documents

### 6. Vertex Setup Guide
**File**: `apps/nn/VERTEX_SETUP.md`  
**Why**: Shows authentication setup (though Vertex has issues)  
**Content**: GCP project setup, service account configuration  

### 7. Bug Resolution Summary  
**File**: `docs/bugs/RESOLUTION_SUMMARY_2025-09-08.md`  
**Why**: Recent bug fixes and patterns  
**Content**: Common issues and their solutions  

## Documents to SKIP (Outdated/Archived)

- ❌ `docs/archive/sprints/*` - Old sprint reports, superseded by current state
- ❌ `PHASE_2_3_ROADMAP.md` - Future plans not yet implemented
- ❌ Individual bug reports in `docs/bugs/BUG_*.md` - Covered in summary

## Submission Strategy for ChatGPT-5

### Initial Message Template:
```
I need help with the Nano Banana Runner project, an AI image generation system using Gemini. 

Key Context:
- Primary provider is Gemini Batch (Vertex has entitlement issues)  
- TypeScript/Node.js CLI with React GUI
- Style-transfer safety through perceptual hashing
- Current focus: [your specific task]

[Paste CHATGPT5_PROJECT_ONBOARDING.md here]

[Paste specific section from apps/nn/README.md if relevant to task]
```

### Follow-up Context (if needed):
- Add IMPLEMENTATION_PLAN.md for architecture questions
- Add QUICK_REFERENCE.md for command help
- Add CLAUDE.md for coding standards

## Key Information Updates

### Current Status (as of 2025-09-09)
- ✅ Batch provider is default and working
- ✅ Smoke tests passing
- ✅ Provider switching documented
- ❌ Vertex entitlements (404 on Gemini 1.5 models)
- ❌ Only Gemini 2.0 Flash Experimental works in new projects

### Recent Changes
- Implemented automatic fallback from Vertex to Batch
- Added probe system for model health checking
- Created comprehensive smoke tests
- Updated documentation for provider switching

### Known Issues
1. **Vertex Entitlements**: Projects lack access to Gemini 1.5 models
2. **Authentication**: Service accounts need proper IAM roles
3. **Batch Size**: Limited to 2000 images per job

### Environment Variables (Current)
```bash
# Required
NN_PROVIDER=batch        # Default provider
NN_OUT_DIR=./artifacts  # Output directory

# Optional
GOOGLE_CLOUD_PROJECT=nano-banana-20250908  # For Vertex (if needed)
GOOGLE_CLOUD_LOCATION=us-central1
```

## What ChatGPT-5 Needs to Know

1. **Always use Batch provider** - It's the only reliable option
2. **Never commit API keys** - Use proxy service for key management
3. **Test with --dry-run** - Prevent accidental API charges
4. **Follow existing patterns** - Check similar files before creating new ones
5. **Small files only** - Keep under 300 lines of code per file

## Questions ChatGPT-5 Should Ask

Before starting any task:
1. "Which provider should I use?" (Answer: Batch)
2. "Is this a dry-run or live operation?" (Default: dry-run)
3. "Are there existing patterns for this?" (Check similar files)
4. "What's the current git branch?" (Never work on main)
5. "Has the proxy been started?" (Required for Batch)