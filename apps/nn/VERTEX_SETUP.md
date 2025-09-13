# Vertex AI Setup Documentation

## Current Status
- ✅ Service Account Created: `nb-runner@vertex-system-471415.iam.gserviceaccount.com`
- ✅ IAM Roles Granted: `aiplatform.user`, `aiplatform.endpointUser`
- ✅ Service Account Key: `nb-runner-key.json` (gitignored)
- ✅ Automatic Fallback: System probes Vertex and falls back to Batch if unavailable
- ✅ Enhanced Error Handling: HTML responses detected and saved for debugging
- ❌ Model Access: **404 NOT_FOUND** - Project lacks entitlement to Gemini models

## Issue: Model Not Available (Entitlement Required)
The project `vertex-system-471415` does not have access to Gemini image generation models in `us-central1`. This is an **entitlement/access issue**, not a code or authentication problem.

### Error Message
```json
{
  "error": {
    "code": 404,
    "message": "Publisher Model `projects/vertex-system-471415/locations/us-central1/publishers/google/models/gemini-1.5-flash` was not found or your project does not have access to it.",
    "status": "NOT_FOUND"
  }
}
```

## Solution: Automatic Fallback to Batch API
The application now includes **automatic fallback** functionality:
1. **Probe on Startup**: When Vertex is selected, the system probes availability
2. **Cached Results**: Probe results are cached for 5 minutes to reduce overhead
3. **Automatic Fallback**: If Vertex is unavailable, system automatically uses Batch API
4. **Transparent Operation**: No manual intervention required - system handles fallback seamlessly

## Setup Instructions (for when model access is granted)

### 1. Use Existing Service Account
```bash
export GOOGLE_APPLICATION_CREDENTIALS="$(pwd)/nb-runner-key.json"
export GOOGLE_CLOUD_PROJECT=vertex-system-471415
export GOOGLE_CLOUD_LOCATION=us-central1
```

### 2. Test Connectivity
```bash
# Quick probe test
node dist/cli.js probe vertex-ai

# Direct API test
export TOKEN="$(gcloud auth print-access-token)"
curl -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/json" \
     "https://us-central1-aiplatform.googleapis.com/v1/projects/vertex-system-471415/locations/us-central1/publishers/google/models/gemini-1.5-flash:generateContent" \
     -d '{"contents":[{"role":"user","parts":[{"text":"test"}]}]}'
```

### 3. Override Provider (once working)
```bash
# Use Vertex AI instead of Batch
NN_PROVIDER=vertex node dist/cli.js render --prompts ./prompts.jsonl
```

## To Request Model Access

### Option 1: Google Cloud Support Ticket
Submit a support ticket with the following template:

```
Subject: Enable Gemini Model Access for Project vertex-system-471415

Dear Google Cloud Support,

We are requesting access to Gemini models for our project. Currently receiving 404 errors when attempting to use the models via Vertex AI API.

Project Details:
- Project ID: vertex-system-471415
- Project Number: [Your project number]
- Region: us-central1
- Models Required: gemini-1.5-flash, gemini-2.0-flash-exp (or latest available)
- Use Case: Image generation and analysis for creative workflows

Current Error:
"Publisher Model `projects/vertex-system-471415/locations/us-central1/publishers/google/models/gemini-1.5-flash` was not found or your project does not have access to it."

Service Account Configuration:
- Service Account: nb-runner@vertex-system-471415.iam.gserviceaccount.com
- IAM Roles: roles/aiplatform.user, roles/aiplatform.endpointUser (already granted)

Please enable access to the Gemini models for our project. We have already configured authentication and IAM permissions.

Thank you for your assistance.
```

### Option 2: Sales Representative
If you have a Google Cloud sales representative, contact them directly with:
- **Project ID**: `vertex-system-471415`
- **Required Models**: `gemini-1.5-flash` or latest
- **Region**: `us-central1`
- **Use Case**: Image generation via Vertex AI SDK

## Recent Improvements (PR-VTX-01 & PR-VTX-02)

### Enhanced Error Handling (PR-VTX-01)
- **HTML Detection**: Detects when Vertex returns HTML error pages instead of JSON
- **Error Artifacts**: Saves HTML responses to `./artifacts/errors/` for debugging
- **Detailed Problem+JSON**: Returns structured errors with specific guidance
- **Error Categories**: Distinguishes between entitlement, permission, rate limit, and service errors

### Automatic Probe & Fallback (PR-VTX-02)
- **Health Check**: Probes Vertex availability before use
- **Smart Caching**: Caches probe results for 5 minutes
- **Transparent Fallback**: Automatically switches to Batch API if Vertex unavailable
- **No Manual Intervention**: System handles provider selection automatically

## Production Recommendations
1. **Keep Batch as default**: Proven, stable, and working
2. **Use Vertex as override**: Only when explicitly needed and after access is granted
3. **For Cloud Run**: Bind service account directly (no key file needed)
4. **Monitor probe status**: Auto-fallback to Batch if Vertex fails
5. **Check error artifacts**: Review `./artifacts/errors/` for HTML responses

## Security Notes
- ⚠️ **NEVER commit** `nb-runner-key.json` to git
- ✅ Already added to `.gitignore`
- For production, use Workload Identity or service account binding instead of key files

## Testing the Solution

### Test Probe Functionality
```bash
# Test Vertex probe (will fall back to Batch if unavailable)
NN_PROVIDER=vertex node dist/cli.js probe

# Force Vertex without probe (for testing error handling)
node dist/cli.js render --provider vertex --prompts ./test.jsonl
```

### Monitor Logs
```bash
# Watch for probe results and fallback behavior
tail -f artifacts/logs/app.log | grep -E "probe|fallback|vertex"
```