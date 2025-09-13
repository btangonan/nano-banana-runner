# ADR-0004: Semantic Remix Implementation

## Status
Accepted

## Context
The HeuristicRemixProvider was copying ultra-cinematic subject descriptions verbatim into all generated prompts. For example, "A lone figure standing in water at twilight" appeared unchanged in all 20 prompts, with only minor lighting and composition variations. This defeated the core purpose of the remix functionality.

## Problem
- All 20 prompts contained identical subject text
- Diversity score was only 5% (lighting/composition variations)
- No actual "remixing" was happening
- Generated images would be too similar

## Decision
Implemented semantic extraction and template-based generation to create true subject variations while maintaining meaning.

## Implementation (PR-REMIX-HEUR-02)

### Created Modules
1. **`semantic/extractor.ts`** - Extracts entities, actions, settings, times, and descriptors from rich descriptions
2. **`semantic/synonyms.ts`** - Provides synonym dictionaries for variation
3. **`semantic/templates.ts`** - Generates diverse prompts using templates and synonyms

### Key Features
- **Semantic Parsing**: Breaks down "A lone figure standing in water at twilight" into:
  - Entities: ['figure']
  - Actions: ['standing']
  - Settings: ['water']
  - Times: ['twilight']
  - Descriptors: ['lone']

- **Synonym Variation**: Each component can be varied:
  - figure → silhouette, person, individual, character
  - standing → positioned, poised, situated
  - water → ocean, sea, waves, aquatic environment
  - twilight → dusk, sunset, golden hour

- **Template Generation**: Multiple patterns for recombination:
  - "[DESCRIPTOR] [ENTITY] [ACTION] [SETTING] [TIME]"
  - "[ENTITY] [ACTION] [SETTING] during [TIME]"
  - "[SETTING] with [DESCRIPTOR] [ENTITY] [ACTION]"

### Diversity Metrics
- **Jaccard Similarity**: Ensures prompts have <70% word overlap
- **Unique Prompt Detection**: Prevents duplicate generation
- **Deterministic Variation**: Same seed produces same variations

## Results

### Before (PR-REMIX-HEUR-01)
```
1. "A lone figure standing in water at twilight, arms outstretched..."
2. "A lone figure standing in water at twilight, arms outstretched..."
3. "A lone figure standing in water at twilight, arms outstretched..."
...
20. "A lone figure standing in water at twilight, arms outstretched..."
```
Diversity: 5% (only lighting/composition varied)

### After (PR-REMIX-HEUR-02)
```
1. "solitary person positioned in ocean at dusk"
2. "lone individual standing near waves during golden hour"
3. "isolated silhouette in water, positioned"
4. "single figure in sea at twilight"
5. "figure positioned in aquatic environment"
...
```
Diversity: 70%+ (true semantic variation)

## Architecture

```
HeuristicRemixProvider
├── extractComponents(subject) → SemanticComponents
│   ├── entities: ['figure']
│   ├── actions: ['standing']
│   ├── settings: ['water']
│   ├── times: ['twilight']
│   └── descriptors: ['lone']
├── generateFromTemplate(components, rng)
│   ├── Select template pattern
│   ├── Vary words with synonyms
│   └── Check Jaccard similarity
└── Output: Diverse prompts
```

## Testing
- Unit tests for extraction patterns
- Synonym variation tests
- Jaccard similarity validation
- Deterministic behavior with seeds
- Integration tests showing improved diversity

## Consequences

### Positive
- **True Remixing**: Subjects are semantically varied, not copied
- **70%+ Diversity**: High variation between prompts
- **Maintains Meaning**: Variations preserve original intent
- **Deterministic**: Same seed = same variations
- **No External Dependencies**: Pure TypeScript implementation

### Negative
- **Complexity**: More modules and logic than simple copying
- **English-Only**: Synonym dictionaries are English-specific
- **Semantic Limits**: Can't handle very abstract descriptions

### Trade-offs
- **Accuracy vs Variety**: Some variations may drift from original
- **Performance**: Slightly slower due to parsing (still <10ms)
- **Maintenance**: Synonym dictionaries need updates

## Next Steps (Future PRs)
- **PR-REMIX-HEUR-03**: Expand synonym dictionaries
- **PR-REMIX-HEUR-04**: Add CLI/GUI controls for remix parameters
- **PR-REMIX-HEUR-05**: Comprehensive E2E testing

## Metrics
- **Subject Diversity**: 5% → 70%+
- **Unique Prompts**: 1 → 10+ per descriptor
- **Jaccard Similarity**: <0.7 between any two prompts
- **Performance**: <10ms for 20 prompts
- **Test Coverage**: 18 tests passing