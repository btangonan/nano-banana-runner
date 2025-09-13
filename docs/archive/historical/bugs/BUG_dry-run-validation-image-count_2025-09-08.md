# Dry-Run Job Completion Fails Due to Schema Mismatch and Stale Image Accumulation
> Dry-run submissions appear stuck at 0% progress due to Zod validation errors, while image analysis counts accumulate stale files from previous sessions.

## Summary
- **Observed:** 
  - UI shows "Generating" with 0% progress indefinitely after dry-run submission
  - Console shows repeated Zod validation errors for `/ui/poll` responses
  - Image analysis reports 6 images when only 3 were uploaded in current session
  - Poll endpoint returns `completed` status but with incompatible `result` structure
- **Expected:** 
  - Dry-run results should display immediately showing estimated costs and images
  - Image analysis should only count newly uploaded files (3)
  - Poll responses should pass Zod validation
- **Impact:** 
  - Users cannot see dry-run results (blocker for cost estimation workflow)
  - Incorrect image counts confuse users about what will be processed
  - Affected envs: Development, potentially production
  - Frequency: 100% reproducible
- **Severity:** **High** - Core dry-run workflow completely broken, preventing cost estimation

## Root Causes

### 1. Schema Mismatch for Dry-Run Results
The backend stores dry-run statistics directly in `job.result`:
```javascript
// ui.submit.ts:341-351
dryRunOutput = {
  promptCount,
  variants: options.variants,
  estimatedImages,
  estimatedTime: `${estimatedTime}s`,
  estimatedCost: `$${(estimatedImages * 0.000125).toFixed(4)}`,
  message: 'Dry-run complete. Run with --live to submit actual job.',
  provider
};
// Later stored as: job.result = dryRunOutput
```

But the frontend expects `result` to have this structure:
```typescript
// contracts.ts:228-231
result: z.object({
  message: z.string(),
  outputLocation: z.string(),  // Required but missing in dry-run output
})
```

### 2. Stale Image Accumulation
The `./images` directory retains files from previous sessions:
```bash
# Current state shows 6 files (3 new + 3 old)
0c0b3c98_Screenshot... # Old session
7f20a52f_runner...     # Old session  
85c55c48_soccer...     # Old session
3367665e_soccer...     # New upload
8b36f881_runner...     # New upload
ca0bb7fc_Screenshot... # New upload
```

The analyze endpoint processes ALL files in the directory, not just new uploads.

## Repro Steps

```bash
# 1. Start servers
cd /Users/bradleytangonan/Desktop/my\ apps/gemini\ image\ analyzer/apps/nn/proxy
pnpm dev

# 2. Check existing images (shows accumulation)
ls -la ./images/ | wc -l  # Returns 8 (6 files + . and ..)

# 3. Upload 3 new images via GUI at http://127.0.0.1:8787/app

# 4. Analyze (will process all 6 images, not just 3)
curl -X POST http://127.0.0.1:8787/ui/analyze \
  -H "Content-Type: application/json" \
  -d '{"inDir": "./images", "concurrency": 4}'
# Response shows count: 6 instead of expected 3

# 5. Submit dry-run job
curl -X POST http://127.0.0.1:8787/ui/submit \
  -H "Content-Type: application/json" \
  -d '{
    "promptsPath": "./artifacts/prompts.jsonl",
    "styleDir": "./images",
    "provider": "gemini-batch",
    "runMode": "dry-run"
  }'
# Returns jobId

# 6. Poll for status (triggers validation error)
curl http://127.0.0.1:8787/ui/poll?jobId=<JOB_ID>
# Backend returns 200 but frontend Zod validation fails
```

## Proposed Fix Plan

### Fix 1: Update Poll Response for Dry-Run Mode
**File:** `/apps/nn/proxy/src/routes/ui.poll.ts`

```typescript
// Line 115-118, change from:
result: job.result || {
  message: 'Job completed successfully',
  outputLocation: './outputs',
},

// To:
result: job.result ? {
  message: job.result.message || 'Dry-run complete',
  outputLocation: job.result.outputLocation || './outputs',
  // Include dry-run stats as additional fields
  ...(job.result.promptCount !== undefined && {
    dryRunStats: {
      promptCount: job.result.promptCount,
      variants: job.result.variants,
      estimatedImages: job.result.estimatedImages,
      estimatedTime: job.result.estimatedTime,
      estimatedCost: job.result.estimatedCost,
      provider: job.result.provider
    }
  })
} : {
  message: 'Job completed successfully',
  outputLocation: './outputs',
},
```

### Fix 2: Clear Images Directory on Upload
**File:** `/apps/nn/proxy/src/routes/ui.upload.ts`

Add option to clear existing images before new upload:
```typescript
// Add to request schema
clearExisting: z.boolean().default(false),

// In upload handler, before processing files:
if (clearExisting) {
  const files = await readdir(uploadDir);
  for (const file of files) {
    if (ALLOWED_EXTENSIONS.some(ext => file.endsWith(ext))) {
      await unlink(join(uploadDir, file));
    }
  }
}
```

### Fix 3: Update Frontend Schema
**File:** `/apps/nn/apps/gui/src/lib/contracts.ts`

```typescript
// Line 228-231, update to:
result: z.object({
  message: z.string(),
  outputLocation: z.string(),
  dryRunStats: z.object({
    promptCount: z.number(),
    variants: z.number(),
    estimatedImages: z.number(),
    estimatedTime: z.string(),
    estimatedCost: z.string(),
    provider: z.string(),
  }).optional(),
}),
```

## Risks & Alternatives

### Risks
- **Breaking Change**: Updating the schema could break existing integrations
- **Data Loss**: Clearing images directory could delete wanted files
- **Migration**: Existing jobs in memory won't have the new structure

### Alternatives
1. **Separate Dry-Run Endpoint**: Create `/ui/dry-run` with its own response schema
2. **Session-Based Upload Dirs**: Use timestamped directories per session
3. **Two-Phase Fix**: First fix schema mismatch (urgent), then address image accumulation

## Acceptance Criteria
- [ ] Dry-run submission shows results immediately without validation errors
- [ ] Console shows no Zod validation errors during polling
- [ ] Image analysis count matches number of files uploaded in current session
- [ ] Poll response passes frontend validation for all job states
- [ ] Existing live job submissions continue to work
- [ ] Unit tests added for dry-run response structure
- [ ] E2E test validates full dry-run workflow

## Test Commands
```bash
# After fix, these should all succeed:
npm test -- ui.poll
npm test -- ui.submit
npm run e2e -- --grep "dry-run workflow"

# Manual validation
curl -X POST http://127.0.0.1:8787/ui/submit \
  -d '{"runMode": "dry-run", ...}' | \
  jq '.jobId' | \
  xargs -I {} curl "http://127.0.0.1:8787/ui/poll?jobId={}" | \
  jq '.result.dryRunStats'
```