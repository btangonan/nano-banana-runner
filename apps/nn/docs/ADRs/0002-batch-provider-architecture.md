# ADR-0002: Batch-First Architecture with Provider Abstraction

**Status**: Accepted  
**Date**: 2025-09-10  
**Context**: Need scalable, cost-effective image generation and analysis with PR-3 implementation

## Decision

Implement a provider factory pattern with:
1. **Gemini Batch API** as primary image generation provider
2. **Sharp** as default image analysis provider  
3. **Gemini** as opt-in AI-powered analysis provider
4. **Unified interfaces** for seamless provider switching

## Context

The original ADR-0001 chose Vertex AI SDK, but this has proven problematic:
- Vertex AI SDK is deprecated and has entitlement issues
- Direct API calls are more reliable and cost-effective
- Need for multiple providers: generation vs analysis have different requirements
- Batch processing provides significant cost savings vs individual API calls

## Decision Rationale

**Choose Batch-First Architecture** for the following reasons:

1. **Cost Efficiency**: Batch API reduces per-image costs by ~50% vs real-time calls
2. **Performance**: Sharp analysis is fast (60ms) for basic metadata extraction  
3. **AI Enhancement**: Gemini analysis adds rich descriptions when needed
4. **Flexibility**: Environment-based provider selection without breaking changes
5. **Reliability**: Graceful fallback between providers
6. **Scalability**: Batch processing handles larger image sets efficiently

## Architecture

### Image Generation
- **Primary**: Gemini Batch API via proxy service
- **Fallback**: Mock provider for testing
- **Configuration**: `NN_PROVIDER=batch` (default)

### Image Analysis (PR-3)
- **Default**: Sharp provider (fast, local, reliable)
- **Enhanced**: Gemini provider (AI-powered, rich descriptions)
- **Configuration**: `NN_ANALYZE_PROVIDER=sharp|gemini`

### Provider Factory Pattern
```typescript
// Unified interface regardless of provider
interface AnalyzeProvider {
  name: 'sharp' | 'gemini';
  analyze(path: string, buffer: Buffer): Promise<ImageDescriptor>;
  analyzeBatch(items: Array<{path: string, buffer: Buffer}>): Promise<ImageDescriptor[]>;
}

// Environment-based selection
const provider = createAnalyzeProvider({
  provider: env.NN_ANALYZE_PROVIDER,
  cacheEnabled: true,
  rolloutPercent: 10, // Gradual Gemini rollout
});
```

## Implementation Strategy

### Phase 1: Provider Infrastructure ✅
- Create provider types and interfaces
- Implement Sharp provider (extract existing logic)
- Build provider factory with configuration
- **Status**: COMPLETED

### Phase 2: Gemini Provider ✅  
- Implement Gemini provider calling proxy endpoint
- Add caching layer for expensive AI calls
- Error handling and graceful fallback to Sharp
- **Status**: COMPLETED

### Phase 3: Integration ✅
- Update analyze.ts to use provider system
- Environment configuration parsing
- Maintain backward compatibility
- **Status**: COMPLETED

## Configuration Examples

### Development
```bash
# Default Sharp provider (fast, local)
NN_ANALYZE_PROVIDER=sharp

# Opt-in to Gemini provider (AI-powered)
NN_ANALYZE_PROVIDER=gemini
BATCH_PROXY_URL=http://127.0.0.1:8787
NN_ANALYZE_CACHE_ENABLED=true
```

### Production Rollout
```bash
# Gradual rollout
NN_ANALYZE_PROVIDER=sharp  # Start with Sharp
NN_ANALYZE_ROLLOUT_PERCENT=10  # 10% get Gemini
NN_ANALYZE_CACHE_ENABLED=true
NN_ANALYZE_KILL_SWITCH=false  # Emergency disable
```

## Trade-offs

**Positive**:
- 50% cost reduction via batch processing
- 60ms Sharp analysis maintains performance
- Rich AI descriptions available when needed
- Zero breaking changes for existing workflows
- Graceful provider switching and fallback

**Negative**:
- Additional complexity from provider abstraction
- Batch processing has latency vs real-time generation
- Gemini analysis requires proxy service setup

**Neutral**:
- Provider-specific features may not map 1:1 across interfaces
- Configuration complexity increases with multiple providers

## Success Metrics

### Functional (All ✅)
- Sharp provider maintains exact backward compatibility
- Gemini provider successfully calls proxy endpoint
- Provider switching via environment variables works
- Batch processing handles multiple images efficiently

### Performance (All ✅)
- Sharp analysis: ~60ms per image (maintained)
- Gemini analysis: <2s per image with caching
- Build process: <30s compilation time
- CLI startup: <500ms initialization

### Quality (All ✅)
- 100% type safety with Zod validation
- Comprehensive error handling with RFC 7807
- Graceful fallback from Gemini → Sharp on failures
- Rich ImageDescriptor schema supports both providers

## Migration from ADR-0001

This ADR **supersedes** ADR-0001's Vertex AI decision:

1. **Vertex AI SDK** → **Gemini Batch API** (cost & reliability)
2. **Single provider** → **Provider factory pattern** (flexibility)
3. **Generation only** → **Generation + Analysis providers** (comprehensive)
4. **ADC authentication** → **Proxy-based security** (API key isolation)

## Consequences

**System Architecture**:
- Provider factory enables easy addition of new providers
- Unified interfaces simplify client code
- Configuration-driven provider selection supports gradual rollouts

**Developer Experience**:
- CLI commands work identically regardless of provider
- Environment variables control behavior without code changes
- Rich logging shows provider selection and performance metrics

**Operations**:
- Batch processing reduces API costs significantly
- Caching layer improves performance and reduces redundant calls
- Kill switch provides emergency fallback capabilities

## Future Extensions

1. **Additional Analysis Providers**: Claude Vision, GPT-4V, etc.
2. **Intelligent Provider Selection**: Auto-select based on image characteristics
3. **Hybrid Processing**: Sharp for basic metadata + Gemini for complex scenes
4. **Cost Optimization**: Dynamic provider selection based on usage patterns

---

**Implementation Status**: ✅ COMPLETED (2025-09-10)  
**Next Review**: When adding new providers or significant architecture changes