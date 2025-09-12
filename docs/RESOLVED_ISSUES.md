# Resolved Issues & Learnings

This document consolidates key learnings from resolved bugs and issues in the Nano Banana Runner project.

## Important Fixes & Learnings

### 1. Image Count Accumulation Bug (2025-09-09)
**Issue**: GUI showed cumulative image count across all sessions instead of current batch only.  
**Solution**: Added "New Session" button that clears `./images` directory via `POST /ui/clear-images` endpoint.  
**Key Learning**: Session management is critical for multi-upload workflows.  
**Implementation**: ~50 LOC total across backend endpoint and UI button.

### 2. Gallery Display Bug (2025-09-10)
**Issue**: Gallery showed "0 generated images" despite successful generation.  
**Root Causes**:
- Overly strict filtering logic requiring searchTerm to exist
- React Query caching stale data
- JobId not properly propagated from SubmitMonitor to Gallery

**Solutions**:
```typescript
// Fixed filtering
const matchesSearch = !searchTerm || item.name.toLowerCase().includes(searchTerm.toLowerCase())

// Disabled caching
queryOptions: { staleTime: 0, gcTime: 0 }

// Fixed jobId propagation
onNext={(completedJobId?: string) => { if (completedJobId) setJobId(completedJobId) }}
```

### 3. Toast Component Crash (2025-09-08)
**Issue**: React "Element type is invalid" error due to lucide-react v0.445.0 icon renames.  
**Solution**: Updated imports from `CheckCircle` → `CircleCheck`, `AlertTriangle` → `TriangleAlert`.  
**Key Learning**: Pin UI library versions or monitor breaking changes in patch releases.

### 4. Batch Routes 404 (2025-09-08)
**Issue**: `/batch/*` routes returning 404 despite being registered.  
**Cause**: `fastify-plugin` wrapper prevented proper route registration.  
**Solution**: Removed plugin wrapper from batch.ts route file.  
**Key Learning**: Fastify plugins have specific registration requirements.

### 5. Silent Image Generation Failures
**Issue**: Individual image failures in batch not clearly reported.  
**Solution**: Enhanced error logging with specific image identification:
```typescript
console.error(`Failed to generate image_${i}_variant_${v}:`, error);
job.problems.push({
  title: `Image generation failed for image_${i}_variant_${v}`,
  detail: error.message,
  instance: `image_${i}_variant_${v}`
});
```

## Common Patterns & Prevention

1. **State Management**: Always consider session boundaries and cleanup
2. **React Query**: Be careful with caching when data changes frequently
3. **Error Reporting**: Provide specific context for failures in batch operations
4. **Dependency Updates**: Monitor breaking changes even in patch versions
5. **Framework Integration**: Understand plugin/wrapper requirements

## Testing Recommendations

- Test multi-session workflows explicitly
- Verify cache invalidation for dynamic data
- Test partial batch failures, not just complete success/failure
- Include dependency update testing in CI/CD

---
*For historical bug reports and detailed investigations, see `/docs/archive/historical/bugs/`*