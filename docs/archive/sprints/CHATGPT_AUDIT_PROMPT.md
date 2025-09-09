# ChatGPT Architecture Audit Prompt

Please conduct a comprehensive technical audit of the following implementation plan for a TypeScript image processing system. Your audit should identify potential issues, suggest improvements, and validate architectural decisions.

## System Context
**Project**: Nano Banana Runner - Image analyzer → prompt generator → Gemini AI image renderer  
**Tech Stack**: TypeScript, Node 20, Google Gen AI SDK, Zod validation, Pino logging  
**Constraints**: 
- Style-only conditioning (no compositional copying)
- Cost control with dry-run default  
- Localhost GUI only
- ≤300 LOC per file
- No secrets in code/logs

## Implementation Plan to Audit
[Include the full IMPLEMENTATION_PLAN.md content here]

## Audit Framework

### 1. Architectural Soundness (Critical)
**Evaluate:**
- Module separation and interfaces
- Dependency injection patterns
- Error propagation strategy
- Scalability to 5k+ prompts
- Memory usage patterns

**Key Questions:**
- Is the seeded RNG approach robust for deterministic output?
- Will the three-layer style-only defense actually prevent copying?
- Are the interfaces between remix.ts and geminiImage.ts clean?
- How will this handle concurrent processing?

### 2. Security Analysis (Critical)  
**Evaluate:**
- Credential handling (ADC vs API keys)
- Input validation completeness
- Secret logging prevention
- Hash-based validation security

**Key Questions:**
- Could the hash similarity algorithm be exploited?
- Are there injection risks in prompt composition?
- Is the style-only enforcement actually enforceable?
- What happens if ADC fails or expires?

### 3. Performance & Scalability (High Priority)
**Evaluate:**
- Algorithmic complexity
- Memory allocation patterns  
- I/O optimization
- Batch processing efficiency

**Key Questions:**
- Will the seeded RNG scale to 50+ variations per image?
- How does hash validation perform with large images?
- Are there bottlenecks in the retry logic?
- Could concurrent API calls cause rate limiting issues?

### 4. Error Handling & Reliability (High Priority)
**Evaluate:**
- Failure modes and recovery
- Retry logic soundness
- Graceful degradation
- Observability/debugging

**Key Questions:**
- What happens if the Gemini API changes unexpectedly?
- Are there edge cases in the exponential backoff?
- How does the system handle partial batch failures?
- Is error logging sufficient for debugging without exposing secrets?

### 5. Testing Strategy (Medium Priority)
**Evaluate:**
- Test coverage completeness
- Mock strategy effectiveness
- Determinism validation
- Integration test scope

**Key Questions:**
- Are the deterministic tests actually deterministic?
- Can we test style-only enforcement without real images?  
- How do we validate cost estimation accuracy?
- Are there untestable code paths?

### 6. Code Quality & Maintainability (Medium Priority)
**Evaluate:**
- Type safety completeness
- Function purity
- Code organization
- Documentation quality

**Key Questions:**
- Are there any `any` types or unsafe casts?
- Are the pure functions actually pure?
- Is the 300 LOC constraint realistic for these modules?
- Are the interfaces future-proof for new providers?

## Specific Technical Concerns

### Seeded RNG Implementation
```typescript
class SeededRNG {
  private seed: number;
  
  next(): number {
    this.seed = (this.seed * 1664525 + 1013904223) % 2**32;
    return this.seed / 2**32;
  }
}
```
**Audit Points:**
- Is this LCG implementation high-quality enough?
- Will the same seed produce identical results across platforms?
- Are there better alternatives for cryptographic applications?

### Hash Distance Validation
```typescript
function hashSimilarity(hash1: string, hash2: string): number {
  const bin1 = BigInt(`0x${hash1}`);
  const bin2 = BigInt(`0x${hash2}`);
  let xor = bin1 ^ bin2;
  // ... Hamming distance calculation
}
```
**Audit Points:**
- Is Hamming distance appropriate for image similarity?
- Could this produce false positives/negatives?
- Should we use perceptual hashing instead?

### Google Gen AI SDK Integration
```typescript
const model = genAI.getGenerativeModel({
  model: 'gemini-2.5-flash-image-preview',
  generationConfig: { temperature: 0.8 }
});
```
**Audit Points:**
- Is this model ID stable for production?
- Are the generation parameters optimal?
- How do we handle model deprecation?

### Cost Estimation Logic
```typescript
const VERTEX_PRICING = {
  'gemini-2.5-flash-image-preview': 0.0025
};
```
**Audit Points:**
- How do we keep pricing current?
- Are there hidden costs (bandwidth, storage)?
- What's the margin of error on estimates?

## Red Team Scenarios

### Attack Vectors
1. **Prompt Injection**: Can malicious image names inject code?
2. **Resource Exhaustion**: Can someone trigger expensive operations?
3. **Style Bypass**: Can the style-only enforcement be circumvented?
4. **Rate Limit Abuse**: Can someone trigger API bans?

### Failure Modes
1. **API Outage**: Google services down for 6+ hours
2. **Rate Limiting**: Unexpected 429 responses
3. **Model Changes**: Breaking changes to Gemini API
4. **Memory Pressure**: Processing 10k+ images simultaneously

### Edge Cases
1. **Corrupt Images**: Malformed files that crash Sharp
2. **Extreme Batches**: 100+ prompts with 3 variants each
3. **Network Instability**: Intermittent connection issues
4. **Disk Space**: Running out of storage during processing

## Expected Deliverables

### Critical Issues (Must Fix)
- Security vulnerabilities
- Data corruption risks
- Unhandled failure modes
- Performance blockers

### High Priority Issues (Should Fix)
- Architectural improvements
- Error handling gaps
- Testing inadequacies
- Scalability concerns

### Medium Priority Issues (Consider)
- Code quality improvements
- Documentation gaps  
- Performance optimizations
- Maintainability concerns

### Low Priority Issues (Nice to Have)
- Style improvements
- Minor optimizations
- Documentation enhancements

## Audit Format

For each issue identified, provide:

1. **Category**: [Critical|High|Medium|Low]
2. **Component**: [remix.ts|geminiImage.ts|Architecture|Testing|etc.]
3. **Issue**: Brief description
4. **Impact**: What could go wrong
5. **Recommendation**: Specific fix or improvement
6. **Code Example**: If applicable, show before/after

## Validation Questions

1. Would you deploy this to production with confidence?
2. What's the biggest risk in this implementation?
3. Are there industry-standard alternatives we should consider?
4. How would this perform under 10x load?
5. What would you change if you were implementing this?

## Success Criteria

A successful audit should:
- Identify real issues, not theoretical ones
- Provide actionable recommendations
- Consider the project's specific constraints
- Balance perfection with pragmatism
- Focus on business impact over academic purity

Please conduct this audit with the rigor of a senior engineer reviewing production-bound code for a system that will process thousands of images and generate hundreds of AI images daily.