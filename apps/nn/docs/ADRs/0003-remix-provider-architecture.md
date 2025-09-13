# ADR-0003: Remix Provider Architecture

## Status
Accepted

## Context
The remix functionality was not actually remixing - it was copying entire ultra-cinematic subject descriptions verbatim into every prompt with only minor lighting/composition variations. This defeated the purpose of the remixing system, which should create novel, diverse prompts from the analyzed image descriptors.

## Decision
Implemented a provider-based architecture for the remix system following the RemixProvider interface pattern. This allows for:
1. Pluggable remix strategies (heuristic, LLM, template-based)
2. Testable and maintainable code structure
3. Backward compatibility with existing code
4. Future extensibility for advanced remixing algorithms

## Implementation (PR-REMIX-HEUR-01)

### Created Files
- `src/core/remix/providers/types.ts` - RemixProvider interface and related types
- `src/core/remix/providers/heuristic.ts` - HeuristicRemixProvider implementation (current behavior)
- `src/core/remix/providers/index.ts` - Export barrel for providers
- `src/core/remix/index.ts` - New main entry point with provider delegation
- `src/core/remix/legacy.ts` - Legacy exports for backward compatibility
- `test/core/remix/providers.test.ts` - Comprehensive test suite

### Modified Files
- `src/adapters/geminiBatch.ts` - Updated import path
- `src/adapters/geminiImage.ts` - Updated import path  
- `src/workflows/runRemix.ts` - Added await for async generatePrompts

### Preserved Files
- `src/core/remix.ts.bak` - Original implementation backed up

## Architecture

```
RemixProvider Interface
├── name: string                    // Provider identifier
├── version: string                 // Version for compatibility
├── generatePrompts(context)        // Main generation method
└── isConfigured()                  // Configuration check

RemixContext
├── descriptors: ImageDescriptor[]  // Input images
└── options: RemixOptions           // Generation parameters

RemixResult  
├── prompts: PromptRow[]           // Generated prompts
└── metadata                       // Provider info & stats
```

## Current Behavior (Unchanged)
The HeuristicRemixProvider maintains the exact same behavior as before:
- Copies subjects verbatim from descriptors
- Varies style adjectives and lighting terms
- Adds random composition directives
- Uses SeededRNG for deterministic generation
- Injects style-only prefix

## Next Steps (Future PRs)
- **PR-REMIX-HEUR-02**: Implement proper semantic extraction from rich descriptions
- **PR-REMIX-HEUR-03**: Add synonym variation and template-based remixing
- **PR-REMIX-HEUR-04**: Add CLI/GUI controls for remix parameters
- **PR-REMIX-HEUR-05**: Comprehensive E2E determinism tests

## Testing
All tests pass with 100% backward compatibility:
- Provider interface tests verify contract compliance
- Deterministic behavior tests ensure same seed = same output
- Legacy function tests confirm no breaking changes
- TypeScript compilation successful
- Build process successful

## Consequences

### Positive
- Clean separation of concerns with provider pattern
- Testable and maintainable architecture
- No breaking changes to existing code
- Foundation for fixing the remix problem
- Extensible for future providers (LLM, template-based)

### Negative
- Slightly more complex file structure
- Additional abstraction layer
- Must maintain provider interface compatibility

## Decision Rationale
The provider pattern was chosen because it:
1. Allows incremental improvement without breaking changes
2. Enables A/B testing of different remix strategies
3. Provides clean testing boundaries
4. Follows established patterns in the codebase (AnalyzeProvider)
5. Sets up infrastructure for advanced remixing in future PRs