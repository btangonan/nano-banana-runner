# 🤖 Gemini AI Image Analysis Setup

## Quick Start

### 1. Get Your API Key
1. Visit https://aistudio.google.com/app/apikey
2. Create a new API key for Gemini
3. Copy the key

### 2. Configure Environment
```bash
# Edit .env file
nano apps/nn/.env

# Add your existing API key (same as for Gemini 2.5 Flash):
GEMINI_API_KEY=your-actual-api-key-here
```

### 3. Restart Services
```bash
./start-clean.sh restart
```

### 4. Test AI Analysis
Upload an image in the GUI and check the analysis results - you should now see:
- Detailed object descriptions
- Scene understanding
- Style analysis
- Lighting conditions
- Confidence scores

## What Changed

### ❌ Before (Sharp Provider)
```json
{
  "provider": "sharp",
  "palette": ["#ff0000", "#00ff00"],
  "subjects": ["sunset", "ocean"],  // From filename only
  "style": ["wide", "bright"],      // Basic heuristics
  "lighting": "high-contrast"       // Color-based guess
}
```

### ✅ After (Gemini AI Provider)
```json
{
  "provider": "gemini", 
  "objects": ["sailing boat", "sunset", "calm ocean", "golden clouds"],
  "scene": "A peaceful harbor at sunset with boats anchored",
  "style": ["impressionistic", "warm tones", "romantic"],
  "composition": "Rule of thirds with horizon in lower third",
  "colors": ["#ff6b35", "#f7931e", "#ffcb05"],
  "lighting": "Golden hour backlighting creates dramatic silhouettes",
  "qualityIssues": [],
  "safetyTags": [],
  "confidence": 0.95
}
```

## Cost Management

### Rollout Strategy (Recommended)
Start with a small percentage to test costs and quality:

```bash
# In .env file:
NN_ANALYZE_ROLLOUT_PERCENT=10  # Only 10% use Gemini initially
```

Gradually increase as you validate results and monitor costs.

### Expected Costs
- **$0.0025 per image** analyzed
- **100 images = $0.25**
- **1,000 images = $2.50**
- **10,000 images = $25.00**

### Cost Reduction Features
- **Caching**: Results cached in memory and disk (enabled by default)
- **Deduplication**: Identical images analyzed only once
- **Gradual rollout**: Test with small percentage first
- **Kill switch**: `NN_ANALYZE_KILL_SWITCH=true` to disable instantly

## Monitoring

### Check API Usage
```bash
# View analysis metrics
curl http://127.0.0.1:8787/analyze/metrics

# Check proxy logs
tail -f logs/proxy.log
```

### Switch Back to Sharp
If you want to disable Gemini and return to free Sharp analysis:

```bash
# In .env:
NN_ANALYZE_PROVIDER=sharp
# OR use kill switch:
NN_ANALYZE_KILL_SWITCH=true
```

## Troubleshooting

### "Analysis failed" Error
1. Check API key is valid: `echo $GEMINI_API_KEY`
2. Check proxy logs: `tail -f logs/proxy.log`
3. Test endpoint: `curl http://127.0.0.1:8787/analyze/describe -d '{"image":"test"}'`

### Large Images Failing (413 Error)
- Images are automatically preprocessed
- Max size ~4-5MB before compression
- WebP/JPEG compression applied automatically

### Rate Limits (429 Error)
- Reduce `ANALYZE_CHUNK_SIZE` to process fewer images concurrently
- Increase retry delays in proxy configuration
- Use gradual rollout to spread load

## API Key Security

- Never commit `.env` file to git
- Use different keys for development/production
- Monitor usage in Google AI Studio
- Set billing alerts in Google Cloud Console

---

**Ready to experience real AI image analysis!** 🎨✨