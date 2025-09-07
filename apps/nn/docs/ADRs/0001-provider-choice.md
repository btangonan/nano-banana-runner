# ADR-0001: Provider Choice and Authentication Strategy

**Status**: Accepted  
**Date**: 2025-01-17  
**Context**: Nano Banana Runner image generation provider selection

## Decision

Use **@google-cloud/vertexai** with **Application Default Credentials (ADC)** only.

## Context

Two viable paths for Google's Gemini image generation:

### Option A: Vertex AI SDK (@google-cloud/vertexai)
- **Pros**: Direct Vertex API access, mature enterprise features, ADC native
- **Cons**: Announced deprecation (mid-2026), migration required eventually
- **Auth**: ADC only (gcloud auth application-default login)

### Option B: Google Gen AI SDK (@google/generative-ai) 
- **Pros**: Future-proof, actively developed, unified Google AI surface
- **Cons**: Less enterprise features, newer codebase
- **Auth**: API key or ADC via Vertex routing

## Decision Rationale

**Choose Option A (Vertex SDK)** for the following reasons:

1. **Stability Window**: 18+ months until deprecation provides sufficient runway
2. **Enterprise Features**: Better quota management, VPC-SC support, audit logging
3. **ADC Integration**: Native ADC support aligns with security requirements
4. **Known API Surface**: Mature documentation and patterns
5. **Migration Path**: Clear upgrade path to Gen AI SDK when needed

## Authentication Policy

**ADC-Only Enforcement**:
- NO `GOOGLE_API_KEY` environment variables
- NO API keys in code, configuration, or documentation  
- ALL authentication via ADC (Application Default Credentials)
- Development: `gcloud auth application-default login`
- Production: Service account with appropriate IAM roles

**Required Environment**:
```bash
GOOGLE_CLOUD_PROJECT=your-project-id
GOOGLE_CLOUD_LOCATION=us-central1
```

**Forbidden**:
```bash
GOOGLE_API_KEY=xxx  # NEVER use this path
```

## Implementation

```typescript
import { VertexAI } from '@google-cloud/vertexai';

// ADC-only initialization
const project = mustEnv('GOOGLE_CLOUD_PROJECT');
const location = mustEnv('GOOGLE_CLOUD_LOCATION'); 
const vertex = new VertexAI({ project, location });
const model = vertex.preview.getGenerativeModel({ 
  model: 'gemini-2.5-flash-image-preview' 
});
```

## Security Constraints

1. **No API Keys**: CI/CD enforces no `GOOGLE_API_KEY` references
2. **Fail Closed**: Missing ADC → immediate failure with RFC 7807 error
3. **No Logging**: Never log credentials, tokens, or full signed URLs
4. **Validation**: Strict Zod validation of all environment variables

## Migration Plan

When Vertex SDK deprecation approaches:
1. Evaluate Gen AI SDK maturity and enterprise features
2. Create ADR-000X for migration decision  
3. Implement parallel provider support
4. Gradual migration with feature parity validation

## Alternatives Considered

- **Imagen via AI Platform**: More complex setup, less integrated
- **Direct REST API**: Higher maintenance, manual retry logic
- **Mixed approach**: Complexity without clear benefits

## Consequences

**Positive**:
- Clear authentication model
- Enterprise-grade features
- Stable API for 18+ months
- Strong security posture

**Negative**:
- Future migration required
- Potential feature lag vs Gen AI SDK
- Tighter coupling to Google Cloud ecosystem

**Neutral**:
- Standard ADC setup required for all environments
- Documentation must emphasize ADC setup steps