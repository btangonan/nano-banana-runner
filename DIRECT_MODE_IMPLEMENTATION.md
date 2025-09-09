# Direct Mode: 10-Minute Implementation Guide

## Step 1: Modify Batch Route (5 minutes)

### File: `apps/nn/proxy/src/routes/batch.ts`

#### Current Code (Line ~28)
```typescript
app.post("/batch/submit", async (req, reply) => {
  const parsed = SubmitSchema.safeParse(req.body);
  if (!parsed.success) {
    return reply.code(400).send({ 
      type: "about:blank", 
      title: "Invalid body", 
      detail: parsed.error.message, 
      status: 400 
    });
  }
  
  try {
    const res = await client.submit(parsed.data);
    // ... rest of existing code
```

#### Modified Code (Add 5 lines)
```typescript
app.post("/batch/submit", async (req, reply) => {
  // NEW: Check if this is direct mode (user provided rows directly)
  const isDirectMode = req.body.rows && Array.isArray(req.body.rows);
  
  // Use existing schema validation for both modes!
  const parsed = SubmitSchema.safeParse(req.body);
  if (!parsed.success) {
    return reply.code(400).send({ 
      type: "about:blank", 
      title: "Invalid body", 
      detail: parsed.error.message, 
      status: 400 
    });
  }
  
  try {
    // NEW: Log mode for debugging
    app.log.info({ mode: isDirectMode ? 'direct' : 'remix' }, "Processing batch");
    
    const res = await client.submit(parsed.data);
    // ... rest of existing code unchanged
```

That's it for the backend! The existing `SubmitSchema` already validates `rows: PromptRow[]`.

## Step 2: Test Direct Mode (2 minutes)

### Create test file: `test-direct.json`
```json
{
  "rows": [
    {
      "prompt": "Use reference images strictly for style, palette, texture, and mood. Do NOT copy subject geometry, pose, or layout.\\n\\nA majestic mountain landscape at sunrise, photorealistic style, dramatic lighting with golden hour glow, wide-angle lens perspective",
      "sourceImage": "test.jpg",
      "tags": ["landscape", "sunrise", "mountain"],
      "seed": 42
    }
  ],
  "variants": 1,
  "styleOnly": true,
  "styleRefs": []
}
```

### Test with curl
```bash
# Start the proxy
cd apps/nn/proxy && pnpm dev

# Submit direct prompt
curl -X POST http://127.0.0.1:8787/batch/submit \
  -H "Content-Type: application/json" \
  -d @test-direct.json

# Response should be identical to remix mode:
# {"jobId":"job-xxxxx","estCount":1}
```

## Step 3: Add GUI Support (Optional, 3 minutes)

### File: `apps/nn/apps/gui/src/components/PromptEditor.tsx`

```typescript
import { useState } from 'react';
import { Button } from './ui/button';

export function PromptEditor() {
  const [mode, setMode] = useState<'visual' | 'json'>('visual');
  const [jsonContent, setJsonContent] = useState('');
  
  const handleDirectSubmit = async () => {
    try {
      const parsed = JSON.parse(jsonContent);
      const response = await fetch('http://127.0.0.1:8787/batch/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed)
      });
      const result = await response.json();
      console.log('Job submitted:', result.jobId);
    } catch (error) {
      console.error('Invalid JSON:', error);
    }
  };
  
  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Button 
          variant={mode === 'visual' ? 'default' : 'outline'}
          onClick={() => setMode('visual')}
        >
          Visual Mode
        </Button>
        <Button 
          variant={mode === 'json' ? 'default' : 'outline'}
          onClick={() => setMode('json')}
        >
          Direct JSON Mode
        </Button>
      </div>
      
      {mode === 'json' ? (
        <div className="space-y-2">
          <label className="text-sm text-gray-600">
            Paste PromptRow[] JSON:
          </label>
          <textarea
            className="w-full h-96 font-mono text-sm p-2 border rounded"
            value={jsonContent}
            onChange={(e) => setJsonContent(e.target.value)}
            placeholder='{"rows": [{"prompt": "...", "tags": [...]}], "variants": 1, "styleOnly": true}'
          />
          <Button onClick={handleDirectSubmit}>
            Submit Direct Prompts
          </Button>
        </div>
      ) : (
        <div>
          {/* Existing visual editor components */}
          <p>Visual editor (existing code)</p>
        </div>
      )}
    </div>
  );
}
```

## Done! 🎉

Total implementation time: **10 minutes**
Total code added: **~50 lines**
Breaking changes: **Zero**

## How It Works

1. **User Choice**: Users can either:
   - Use visual mode → triggers remix → generates PromptRow[]
   - Use JSON mode → provide PromptRow[] directly

2. **Same Endpoint**: Both modes POST to `/batch/submit`

3. **Same Validation**: Both use `SubmitSchema` which expects `rows: PromptRow[]`

4. **Same Processing**: After validation, both follow identical flow through `client.submit()`

5. **Same Output**: Both get back job IDs and results in same format

## Template Examples

Users can save and share these JSON templates:

### Artistic Style Template
```json
{
  "rows": [
    {
      "prompt": "impressionist painting style, broken color technique, visible brushstrokes, outdoor light study",
      "tags": ["template:impressionist", "artistic"],
      "seed": 100
    }
  ],
  "variants": 2,
  "styleOnly": true
}
```

### Photographic Template  
```json
{
  "rows": [
    {
      "prompt": "professional product photography, white background, soft box lighting, 85mm lens, f/8 aperture",
      "tags": ["template:product", "photography"],
      "seed": 200
    }
  ],
  "variants": 1,
  "styleOnly": true
}
```

## FAQ

**Q: Do we need to modify geminiBatch.ts?**  
A: No, it receives the same data structure regardless of mode.

**Q: Do we need new TypeScript types?**  
A: No, we reuse the existing PromptRow type.

**Q: Will existing tests still work?**  
A: Yes, they test the same data flow.

**Q: Can users mix modes in one batch?**  
A: No need - they either provide PromptRow[] (direct) or let remix generate them.

**Q: How do users learn the format?**  
A: Export any existing batch to see the exact PromptRow format.

## Next Steps (Optional Enhancements)

1. **JSON Schema Validation**: Add JSON schema to Monaco editor for auto-complete
2. **Template Library**: Add dropdown with pre-built templates  
3. **Import/Export**: Add buttons to save/load JSON files
4. **Preview**: Show how prompts will look before submission

But none of these are required - the feature is fully functional with just Step 1!