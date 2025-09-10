# Feature Proposal: Direct Prompt Mode for Nano Banana Runner (Simplified)

## Executive Summary

Enable power users to bypass prompt remixing by directly submitting PromptRow objects - the **exact same format** already used internally. This achieves all goals with minimal code changes and zero breaking changes.

## Core Insight

The application already has the perfect data structure: `PromptRow`. Instead of creating new schemas, we simply let users provide PromptRows directly.

## Simplified Architecture

### Current Flow
```
Images → analyze.ts → ImageDescriptor → remix.ts → PromptRow[] → batch.ts → Gemini
```

### New Direct Mode
```
User-provided PromptRow[] → batch.ts → Gemini
```

That's it. Same endpoint, same validation, same everything after the initial entry point.

## Implementation (Total: ~50 lines of code)

### 1. Batch Route Modification (10 lines)

```typescript
// apps/nn/proxy/src/routes/batch.ts

app.post("/batch/submit", async (req, reply) => {
  const body = req.body;
  
  // Direct mode: user provides PromptRow[] directly
  if (body.rows && Array.isArray(body.rows)) {
    // Validate against existing PromptRowSchema
    const parsed = z.object({
      rows: z.array(PromptRowSchema),
      variants: z.union([z.literal(1), z.literal(2), z.literal(3)]),
      styleOnly: z.literal(true),
      styleRefs: z.array(z.string()).optional()
    }).safeParse(body);
    
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error });
    }
    
    // Continue with existing flow - no changes needed!
    return client.submit(parsed.data);
  }
  
  // Existing remix flow remains unchanged
  // ... existing code ...
});
```

### 2. No New Schemas Needed

Use the existing `PromptRowSchema` - it already has everything needed:
- `prompt`: The exact text to send to Gemini
- `sourceImage`: Optional reference image
- `tags`: Metadata for organization
- `seed`: For reproducibility

### 3. GUI Addition (30 lines)

```typescript
// Simple toggle in React component
function PromptEditor() {
  const [mode, setMode] = useState<'visual' | 'direct'>('visual');
  
  if (mode === 'direct') {
    return (
      <div>
        <h3>Direct Prompt Mode</h3>
        <p>Paste or write PromptRow JSON array:</p>
        <MonacoEditor
          language="json"
          value={promptJson}
          onChange={setPromptJson}
          height="400px"
          options={{
            minimap: { enabled: false },
            lineNumbers: 'on',
            theme: 'vs-dark'
          }}
        />
        <button onClick={() => validateAndSubmit(promptJson)}>
          Submit Direct Prompts
        </button>
      </div>
    );
  }
  
  // Existing visual editor for remix mode
  return <ExistingVisualEditor />;
}
```

### 4. Template System (0 additional lines)

Templates are just JSON files containing PromptRow arrays:

```json
// templates/artistic-portrait.json
[
  {
    "prompt": "Use reference images strictly for style...\\n\\nportrait photography; soft natural lighting; bokeh background; professional headshot composition",
    "tags": ["template:portrait", "style:professional"],
    "seed": 42
  }
]
```

Users can:
- Save these as .json files
- Share via GitHub, email, etc.
- Import with standard file upload
- Edit in any text editor
- Track in version control

## Benefits Over Original Proposal

### Simplicity
- **Original**: 290 lines of new schemas, complex nested objects
- **Simplified**: Reuse existing 30-line PromptRowSchema

### Implementation Time
- **Original**: 4-week phased rollout
- **Simplified**: 1-2 days total

### Maintenance
- **Original**: Two parallel flows, double the testing
- **Simplified**: Single flow with optional entry point

### User Experience
- **Original**: Learn new complex schema structure
- **Simplified**: Use the same PromptRow format visible in exports

### Risk Profile
- **Original**: Multiple risks requiring mitigation
- **Simplified**: Nearly risk-free - reusing proven code

## Migration Path

1. **Day 1**: Add direct mode support to batch.ts (10 lines)
2. **Day 2**: Add GUI toggle and JSON editor (30 lines)
3. **Done**: System fully functional

No breaking changes. Existing users unaffected. Power users get immediate access.

## FAQ

**Q: What about the structured format with style/lighting/camera objects?**  
A: Users can structure their prompt strings however they want. The system doesn't need to understand the structure - Gemini does.

**Q: How do users know the PromptRow format?**  
A: They can export existing prompts to see examples, or check the TypeScript types.

**Q: What about validation?**  
A: Reuse existing PromptRowSchema validation. It's already battle-tested.

**Q: Can this handle reference images?**  
A: Yes, via the existing styleRefs array in the submit payload.

**Q: Is this extensible for future features?**  
A: Yes, any new PromptRow fields automatically work in direct mode.

## Example Usage

### Basic Direct Submission
```bash
curl -X POST http://127.0.0.1:8787/batch/submit \
  -H "Content-Type: application/json" \
  -d '{
    "rows": [
      {
        "prompt": "A serene zen garden with cherry blossoms",
        "tags": ["direct", "zen", "garden"],
        "seed": 12345
      }
    ],
    "variants": 1,
    "styleOnly": true
  }'
```

### With Templates
```javascript
// Load template
const template = await fs.readFile('templates/cinematic.json');
const prompts = JSON.parse(template);

// Modify as needed
prompts[0].prompt += "; golden hour lighting";

// Submit
await fetch('/batch/submit', {
  method: 'POST',
  body: JSON.stringify({
    rows: prompts,
    variants: 1,
    styleOnly: true
  })
});
```

## Conclusion

This simplified approach achieves all objectives of the original proposal while being:
- **10x simpler** to implement
- **10x faster** to deploy  
- **10x easier** to maintain
- **100% backward compatible**
- **0% breaking changes**

The key insight: Don't create new complexity when existing structures already solve the problem perfectly.