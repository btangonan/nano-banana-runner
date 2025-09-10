# Feature Advisory Request: Direct JSON Image Generation Mode for Nano Banana Runner

## Context & Application Overview

I need your expert advice on implementing a new feature for "Nano Banana Runner" - an advanced image generation pipeline application. The system currently follows this workflow: Image Analysis → Prompt Remixing → Batch Image Generation. We're using TypeScript, Node.js 20, Fastify, React, and the Gemini 2.5 Flash API for image generation (recently migrated from Imagen 3.0 due to quality issues).

### Current Architecture

**Core Pipeline:**
1. **Image Analysis** (`src/core/analyze.ts`): Extracts visual features from source images using Sharp, producing ImageDescriptor objects containing:
   - Subjects (detected objects/themes)
   - Style attributes (vibrant, muted, textured, etc.)
   - Lighting conditions (natural, studio, golden hour, etc.)
   - Camera settings (lens type, f-stop)
   - Color palette (dominant colors)

2. **Prompt Remixing** (`src/core/remix.ts`): Takes ImageDescriptors and generates multiple prompt variations using:
   - Seeded RNG for deterministic variations
   - Style adjective randomization (max 3 per prompt)
   - Lighting term variations (max 2 per prompt)
   - Composition directives (rule of thirds, centered, etc.)
   - Mandatory style-only prefix: "Use reference images strictly for style, palette, texture, and mood. Do NOT copy subject geometry, pose, or layout."
   - Generates 1-100 prompts per source image

3. **Batch Processing** (`proxy/src/clients/geminiBatch.ts`): 
   - Accepts prompt batches via proxy at http://127.0.0.1:8787
   - Sends to Gemini 2.5 Flash API endpoint
   - Manages job queuing, polling, and result retrieval
   - In-memory job tracking with status updates

**Current Data Flow:**
```typescript
// Current ImageDescriptor (from analysis)
{
  path: "image.jpg",
  hash: "sha256...",
  subjects: ["sunset", "ocean", "pier"],
  style: ["vibrant", "warm"],
  lighting: ["golden hour"],
  camera: { lens: "wide-angle", f: 8 }
}

// After Remix (PromptRow)
{
  prompt: "Use reference images strictly...\\n\\nsunset, ocean, pier; vibrant, warm, saturated style; lighting: golden hour, backlighting; lens: wide-angle; f/8; composition: rule of thirds",
  sourceImage: "image.jpg",
  tags: ["subject:sunset", "style:vibrant", "lighting:golden-hour"],
  seed: 12345
}

// To Gemini API
{
  contents: [{
    parts: [
      { text: "full prompt text..." },
      { inline_data: { mime_type: "image/jpeg", data: "base64..." } }
    ]
  }]
}
```

## Proposed Feature: Direct JSON Mode

### Core Concept
Allow users to bypass the remix step entirely and submit structured JSON descriptions directly to the image generation API. This gives power users complete control over the exact parameters sent to Gemini, avoiding the randomization and variation generation of the remix process.

### Proposed Implementation

**New Schema for Direct Mode:**
```typescript
const DirectGenerationSchema = z.object({
  mode: z.literal("direct"),  // vs "remix" for existing flow
  jobId: z.string().optional(),
  requests: z.array(z.object({
    // Direct Gemini API structure
    prompt: z.string().optional(),  // Text prompt if any
    parts: z.array(z.union([
      z.object({ text: z.string() }),
      z.object({ 
        inline_data: z.object({
          mime_type: z.string(),
          data: z.string()  // base64
        })
      })
    ])).optional(),
    // OR simplified structured format
    structured: z.object({
      subjects: z.array(z.string()),
      style: z.object({
        adjectives: z.array(z.string()).max(5),
        movement: z.string().optional(),
        era: z.string().optional()
      }),
      lighting: z.object({
        type: z.string(),
        direction: z.string().optional(),
        intensity: z.enum(["soft", "moderate", "harsh"]).optional()
      }),
      camera: z.object({
        lens: z.string(),
        aperture: z.number(),
        iso: z.number().optional(),
        shutterSpeed: z.string().optional()
      }).optional(),
      composition: z.object({
        rule: z.string(),
        angle: z.string(),
        distance: z.enum(["extreme-close", "close", "medium", "wide", "extreme-wide"])
      }),
      atmosphere: z.object({
        mood: z.string(),
        time: z.string().optional(),
        weather: z.string().optional()
      }).optional(),
      quality: z.object({
        resolution: z.string().optional(),
        style: z.enum(["photorealistic", "artistic", "illustration", "3d-render"]),
        detail: z.enum(["low", "medium", "high", "ultra"])
      }).optional()
    }).optional(),
    metadata: z.object({
      sourceImage: z.string().optional(),
      tags: z.array(z.string()).optional(),
      priority: z.number().optional()
    }).optional()
  })),
  variants: z.number().min(1).max(3).default(1),
  styleRefs: z.array(z.string()).optional()
});
```

### Use Cases & Benefits

**Primary Use Cases:**
1. **Precision Control**: Professional users needing exact specifications without randomization
2. **API Integration**: External systems sending pre-formatted generation requests
3. **Template Systems**: Reusable generation templates with specific parameters
4. **A/B Testing**: Comparing exact parameter sets without variation noise
5. **Batch Consistency**: Ensuring identical parameters across large batches

**Benefits:**
- Complete parameter control without remix interference
- Reduced processing time (skip remix computation)
- Better reproducibility with exact parameter sets
- Enable advanced users to leverage full Gemini API capabilities
- Support for future Gemini features without remix modifications

### Technical Considerations

**1. Routing & Mode Detection:**
- Add mode detection at proxy endpoint
- Route to appropriate processor (remix vs direct)
- Maintain backward compatibility with existing remix flow

**2. Validation & Safety:**
- Validate JSON structure against Gemini API requirements
- Ensure style-only prefix injection when reference images present
- Implement parameter limits (prompt length, part count, etc.)
- Sanitize user inputs for security

**3. Integration Points:**
```typescript
// Modified batch route handler
app.post("/batch/submit", async (req, reply) => {
  const mode = req.body.mode || "remix";  // Default to existing behavior
  
  if (mode === "direct") {
    const parsed = DirectGenerationSchema.safeParse(req.body);
    // Process direct JSON submission
    return handleDirectGeneration(parsed.data);
  } else {
    const parsed = SubmitSchema.safeParse(req.body);
    // Existing remix flow
    return handleRemixGeneration(parsed.data);
  }
});
```

**4. UI/UX Considerations:**
- Add mode toggle in GUI (Remix/Direct)
- JSON editor with syntax highlighting for direct mode
- Template library for common direct configurations
- Real-time JSON validation with error hints
- Preview of how JSON will be sent to API

**5. Conversion Utilities:**
- Helper to convert ImageDescriptor → Direct JSON
- Template generator from successful generations
- Batch converter for existing prompt collections

### Implementation Strategy

**Phase 1: Backend Support (Week 1)**
- Extend proxy routes to accept direct mode
- Add DirectGenerationSchema validation
- Implement direct-to-Gemini pathway
- Maintain job tracking for both modes

**Phase 2: API Refinement (Week 2)**
- Add structured format processor
- Implement parameter validation
- Add conversion utilities
- Create comprehensive test suite

**Phase 3: Frontend Integration (Week 3)**
- Add mode selector to GUI
- Implement JSON editor component
- Add template management
- Create preview functionality

**Phase 4: Documentation & Polish (Week 4)**
- API documentation for direct mode
- Template library creation
- Performance optimization
- User guides and examples

### Testing Strategy

**Unit Tests:**
- Schema validation for all JSON formats
- Conversion utility accuracy
- Parameter limit enforcement
- Mode detection logic

**Integration Tests:**
- End-to-end direct generation flow
- Compatibility with existing remix flow
- Batch processing for both modes
- Error handling and recovery

**Performance Tests:**
- Compare generation times (remix vs direct)
- Memory usage with large JSON payloads
- Concurrent request handling
- API rate limit compliance

### Risk Assessment & Mitigation

**Risks:**
1. **Complexity**: Two parallel flows increase maintenance burden
   - *Mitigation*: Share common components, comprehensive testing

2. **User Confusion**: Mode selection might confuse users
   - *Mitigation*: Clear UI, helpful documentation, sensible defaults

3. **Invalid JSON**: Users might submit malformed requests
   - *Mitigation*: Real-time validation, helpful error messages

4. **API Changes**: Gemini API updates might break direct mode
   - *Mitigation*: Version tracking, compatibility layer

### Questions for Consideration

1. Should we support batch operations mixing remix and direct modes?
2. How should we handle partial failures in direct mode batches?
3. Should direct mode support reference image upload inline or require pre-upload?
4. What analytics should we track for direct vs remix usage?
5. Should we implement rate limiting differently for direct mode?
6. How do we handle migration of existing users to dual-mode system?
7. Should templates be user-specific or globally shared?
8. What level of Gemini API feature exposure is appropriate?

### Performance & Cost Analysis

**Expected Impact:**
- 30-40% reduction in processing time for direct mode (skip remix)
- Same API costs (Gemini charges per generation, not complexity)
- Reduced server CPU usage for direct submissions
- Potentially higher memory usage for JSON parsing/validation

### Success Metrics

- Adoption rate of direct mode among power users
- Reduction in generation time for direct submissions
- User satisfaction scores for control/precision
- API error rate comparison between modes
- Template reuse frequency

### Conclusion

This direct JSON mode feature would position Nano Banana Runner as a professional-grade tool serving both casual users (remix mode) and power users (direct mode). The implementation is technically feasible with minimal disruption to existing architecture. The key challenges lie in UI/UX design and maintaining simplicity while adding power.

Please provide your assessment of this feature proposal, particularly regarding:
1. Technical architecture decisions
2. API design and schema structure
3. Risk mitigation strategies
4. Implementation prioritization
5. Any overlooked considerations or potential improvements

Your expertise would be invaluable in refining this feature before we begin implementation.