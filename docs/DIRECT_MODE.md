# Direct Mode Documentation

## Overview
Direct Mode allows power users to bypass the remix step and submit `PromptRow[]` JSON directly to the Gemini batch API. This feature provides 90% code reduction by reusing existing types while maintaining safety through comprehensive guardrails.

## Status
- **Backend**: ✅ Complete and pushed to production
- **Frontend**: ⏳ Pending implementation
- **Feature Flag**: `NN_ENABLE_DIRECT_MODE=false` (OFF by default for safety)

## Configuration

### Environment Variables
```bash
# Feature flag (MUST be enabled to use Direct Mode)
NN_ENABLE_DIRECT_MODE=false         # Set to true to enable

# Validation caps
DIRECT_MAX_ROWS=200                 # Max rows per batch
DIRECT_MAX_PROMPT_LEN=4000          # Max characters per prompt
DIRECT_MAX_TAGS=16                  # Max tags per row
DIRECT_MAX_TAG_LEN=64               # Max characters per tag
DIRECT_RPM=10                       # Rate limit for Direct Mode
DIRECT_MAX_BODY_BYTES=1048576       # 1MB max body size
```

## Usage

### Enabling Direct Mode
```bash
# Option 1: Environment variable
export NN_ENABLE_DIRECT_MODE=true

# Option 2: .env file
echo "NN_ENABLE_DIRECT_MODE=true" >> .env

# Restart proxy after enabling
./start-clean.sh restart
```

### JSON Submission Format
```json
{
  "rows": [
    {
      "prompt": "A serene zen garden at sunset",
      "sourceImage": "optional-reference.jpg",
      "tags": ["zen", "garden", "peaceful"],
      "seed": 42
    }
  ],
  "variants": 1,
  "styleOnly": true,
  "styleRefs": ["./images/style1.jpg", "./images/style2.jpg"]
}
```

### Testing Direct Mode
```bash
# Test script available
./test-direct-mode.sh

# Manual test
curl -X POST http://127.0.0.1:8787/batch/submit \
  -H "Content-Type: application/json" \
  -d @direct-mode-test.json
```

## Frontend Implementation Guide (Pending)

### Required Components

#### 1. DirectJsonPanel Component (~100 LOC)
```typescript
interface DirectJsonPanelProps {
  onJsonReady: (json: DirectModeRequest) => void;
  initialJson?: string;
}

// Features needed:
- JSON editor with syntax highlighting
- Real-time validation against PromptRow schema
- Template dropdown for common patterns
- Import/export JSON files
- Preview of prompt count and validation status
```

#### 2. SubmitMonitor Integration (~50 LOC)
```typescript
// Add mode toggle
const [mode, setMode] = useState<'remix' | 'direct'>('remix');

// Conditional rendering
{mode === 'direct' ? (
  <DirectJsonPanel onJsonReady={handleDirectSubmit} />
) : (
  <RemixPanel {...existingProps} />
)}
```

#### 3. Validation & Safety
- Enforce dry-run first before live submission
- Display validation errors clearly
- Show cost estimates based on row count
- Require explicit confirmation for large batches

### UI/UX Considerations
1. **Toggle Location**: Settings panel or tab in RemixReview step
2. **Templates**: Provide pre-built JSON templates for common use cases
3. **Validation Feedback**: Real-time validation with clear error messages
4. **Progressive Disclosure**: Hide Direct Mode behind "Advanced" section
5. **Safety Gates**: Multiple confirmations for large/expensive batches

## Implementation Details

### How It Works
1. **Detection**: Proxy checks for `rows` array when `NN_ENABLE_DIRECT_MODE=true`
2. **Validation**: Applies all guardrails without creating new schemas
3. **Processing**: Routes through same batch submission pipeline
4. **Safety**: Automatically enforces `styleOnly=true` for all Direct Mode submissions

### Code Impact
- **Backend**: ~70 lines added to existing `/batch/submit` route
- **No New Schemas**: Reuses existing `PromptRow` type
- **Zero Breaking Changes**: Existing remix flow completely unaffected

## Security & Safety

### Guardrails
- ✅ Feature flag OFF by default
- ✅ Row count limits (max 200)
- ✅ Prompt length limits (max 4000 chars)
- ✅ Tag validation (count and length)
- ✅ Body size limits (1MB max)
- ✅ Automatic style-only enforcement
- ✅ Rate limiting (10 requests per minute)

### Best Practices
1. Always test with dry-run first
2. Start with small batches to verify format
3. Use templates to ensure valid structure
4. Monitor costs with larger batches
5. Keep feature flag OFF in production unless needed

## Troubleshooting

### Common Issues

**"Feature not enabled" error**
- Ensure `NN_ENABLE_DIRECT_MODE=true` is set
- Restart proxy after changing environment

**"Too many rows" error**
- Reduce batch size to ≤200 rows
- Consider splitting into multiple batches

**"Prompt too long" error**
- Keep prompts under 4000 characters
- Use tags for additional context instead

**Validation failures**
- Check JSON structure matches PromptRow schema
- Verify all required fields are present
- Ensure proper types (numbers vs strings)

---
*For implementation history and planning documents, see `/docs/archive/historical/direct-mode/`*