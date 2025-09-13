# 🏗️ Architecture Decision Record: Direct JSON Mode for Image Generation

**Request Type**: Technical Architecture Review  
**Decision Status**: Pending Expert Evaluation  
**Impact Level**: Medium (New Feature, Core System)  
**Review Urgency**: High (Implementation Ready)

---

## 📋 Executive Summary

**What**: Adding "direct mode" to bypass prompt randomization in our image generation pipeline  
**Why**: Power users need exact control over prompts sent to Gemini 2.5 Flash API  
**Choice**: Complex new schema (500+ lines) vs. Reuse existing types (50 lines)

---

## 🎯 The Decision Point

### We Must Choose Between:

**Option A - Complex Architecture**
- ✅ Structured format with detailed control
- ❌ 500+ lines of new code
- ❌ 4-week implementation
- ❌ New schemas, handlers, tests
- ❌ Potential breaking changes

**Option B - Simplified Approach**
- ✅ Reuse existing PromptRow type
- ✅ 50 lines total change
- ✅ 1-day implementation  
- ✅ Zero breaking changes
- ❓ Sufficient for power users?

---

## 🔧 Technical Details

### Current System Flow
```
1. Images → analyze.ts → ImageDescriptor
2. ImageDescriptor → remix.ts → PromptRow[]
3. PromptRow[] → batch.ts → Gemini API
```

### Existing PromptRow Structure (Already In Production)
```typescript
interface PromptRow {
  prompt: string;        // Text sent to Gemini
  sourceImage?: string;  // Reference image
  tags: string[];        // Metadata
  seed?: number;         // Reproducibility
}
```

### Option A: New Complex Schema
```typescript
const DirectGenerationSchema = z.object({
  mode: z.literal("direct"),
  requests: z.array(z.object({
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
        intensity: z.enum(["soft", "moderate", "harsh"])
      }),
      camera: z.object({
        lens: z.string(),
        aperture: z.number()
      }),
      // ... 15 more nested objects
    })
  }))
});

// New handler function
async function handleDirectGeneration(data: DirectGeneration) {
  // Transform structured format to prompts
  // Validate all nested fields
  // Convert to Gemini format
  // ~200 lines of logic
}
```

### Option B: Reuse Existing Types
```typescript
// The ENTIRE implementation (not pseudocode):
app.post("/batch/submit", async (req, reply) => {
  // Only addition: detect if direct mode
  const isDirectMode = req.body.rows && Array.isArray(req.body.rows);
  
  // Rest is UNCHANGED
  const parsed = SubmitSchema.safeParse(req.body);
  if (!parsed.success) return reply.code(400).send(error);
  
  app.log.info({ mode: isDirectMode ? 'direct' : 'remix' });
  return client.submit(parsed.data); // Same flow!
});
```

---

## 📊 Comparison Matrix

| Criteria | Option A (Complex) | Option B (Simple) | Winner |
|----------|-------------------|-------------------|---------|
| **Code Added** | 500-800 lines | 50 lines | B ✅ |
| **Time to Ship** | 4 weeks | 1-2 days | B ✅ |
| **Breaking Risk** | Medium | Zero | B ✅ |
| **Test Coverage** | New suite | Existing | B ✅ |
| **Maintenance** | High | Minimal | B ✅ |
| **Flexibility** | Structured | Free-form | A ❓ |
| **User Learning** | High | None | B ✅ |
| **Future Proof** | Rigid | Adaptable | B ✅ |

---

## ❓ Critical Questions Requiring Expert Input

### 1. Architectural Integrity
- Does reusing PromptRow violate any SOLID principles?
- Is this an appropriate use of existing types?
- Are we creating hidden coupling?

### 2. User Requirements
- Will power users accept free-form strings over structured input?
- Example: Is `"golden hour lighting, 85mm lens"` sufficient vs. structured objects?

### 3. Edge Cases & Risks
- Large batches (1000+ prompts) - any concerns?
- Validation - should we validate prompt content or just structure?
- Security - injection risks with direct prompt submission?

### 4. Future Evolution
- If we start simple, can we add structure later without breaking?
- How would each approach handle new Gemini API features?

### 5. Best Practices
- Are we falling into any anti-patterns?
- Is there a third approach we haven't considered?

---

## 📝 Specific Evaluation Requested

Please evaluate and provide:

### 1. **Recommendation** (Choose One)
- [ ] Implement Option A (Complex)
- [ ] Implement Option B (Simple)
- [ ] Neither - suggest alternative
- **Rationale**: _____

### 2. **Risk Assessment**
Rate risks for Option B (Simple):
- Technical Debt: [Low/Medium/High]
- Scalability: [Low/Medium/High]
- Maintainability: [Low/Medium/High]
- User Acceptance: [Low/Medium/High]

### 3. **Required Modifications**
If choosing Option B, what changes/additions are mandatory?
- [ ] Additional validation
- [ ] Rate limiting specifics
- [ ] Documentation requirements
- [ ] Monitoring/logging
- [ ] Other: _____

### 4. **Go/No-Go Decision**
Can Option B ship to production as-is?
- [ ] Yes - Ship it
- [ ] Yes with modifications (list above)
- [ ] No - Critical issues (explain)

### 5. **Long-term Perspective**
In 2 years with 10x users and evolving APIs:
- Which approach ages better?
- What refactoring might be needed?

---

## 🎬 Action Items After Review

Based on your recommendation:
1. **If Option B Approved**: Implement in 1 day, ship immediately
2. **If Option A Required**: Begin 4-week development cycle
3. **If Alternative Suggested**: Scope and estimate new approach

---

## 📎 Additional Context

- **Current Scale**: 100 users → expecting 1000+ soon
- **Team Size**: Small (2-3 developers)
- **Philosophy**: "Simple > Complex" when possible
- **Gemini API**: Still evolving, need flexibility

---

**Please provide critical, honest feedback. We specifically want to know if the simplified approach has any fatal flaws we're not seeing.**

*Thank you for your technical expertise in evaluating this architectural decision.*