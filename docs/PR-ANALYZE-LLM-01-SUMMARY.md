# PR-ANALYZE-LLM-01: Quick Summary

## What We're Building
Adding **Gemini-powered image descriptions** as an opt-in alternative to Sharp metadata extraction.

## Why It Matters
- **Current**: Sharp provides basic metadata (dimensions, colors)
- **New**: Gemini provides rich descriptions (objects, mood, composition)
- **Result**: Better prompts → Better generated images

## Implementation Plan

### 3 Small PRs (Sequential)
1. **PR-1**: Provider Interface (~250 LOC)
   - Create abstraction layer
   - Refactor Sharp into provider
   
2. **PR-2**: Gemini Provider (~280 LOC)
   - Implement Gemini vision provider
   - Add secure proxy route
   
3. **PR-3**: Integration (~120 LOC)
   - Wire everything together
   - Add configuration

### Timeline
- **Total**: 12 business days
- **PR-1**: 3 days
- **PR-2**: 4 days  
- **PR-3**: 3 days
- **Testing/Docs**: 2 days

## Key Design Decisions

### ✅ Opt-in Only
```bash
# Default (no change)
NN_ANALYZE_PROVIDER=sharp

# Opt-in to Gemini
NN_ANALYZE_PROVIDER=gemini
```

### ✅ Backward Compatible
- Sharp remains default
- No breaking changes
- Feature flag controlled

### ✅ Secure by Design
- API keys in proxy only
- Never exposed to frontend
- Cached to reduce costs

## Cost Analysis
- **Per Image**: $0.002
- **With Caching**: ~$0.0004 (80% cache hits)
- **Monthly (1000 sessions)**: ~$20

## Risk Mitigation
1. **Rate Limits**: Exponential backoff + caching
2. **Large Images**: Auto-resize before API call
3. **Fallback**: Always fall back to Sharp on error
4. **Cost Control**: Quotas and monitoring

## Success Metrics
- ⚡ Latency <2s per image
- 💾 Cache hit rate >80%
- 📊 3x more detailed descriptions
- 💰 Cost <$0.01 per session

## Next Steps
1. **Review** this plan
2. **Approve** approach
3. **Start PR-1** (provider interface)

## Questions to Resolve
1. Which Gemini model? (1.5 Pro vs 2.0 Flash)
2. Cache strategy? (In-memory LRU vs Redis)
3. Cost limits? (Soft warnings vs hard stops)

---

**Ready to Start**: Just need approval to begin PR-1