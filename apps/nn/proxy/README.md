# nn-batch-relay (Gemini Batch Proxy)

Local/Cloud Run proxy that holds the Gemini Batch API key and exposes a typed API for the CLI. No secrets in the CLI or logs.

## Security Model

- **API key stays server-side** - Never exposed to CLI
- **Redacted logging** - Pino redacts all sensitive fields
- **Local-only binding** - Default 127.0.0.1 (configure for production)
- **Secret Manager ready** - Production deployment uses Secret Manager

## Local Development

```bash
cd proxy
cp .env.example .env
# Edit .env and set GEMINI_BATCH_API_KEY for local dev only

pnpm install
pnpm run dev
# Listening on http://127.0.0.1:8787
```

## API Endpoints

### Submit Batch Job
```
POST /batch/submit
Body: {
  rows: [{ prompt: string, ... }],
  variants: 1|2|3,
  styleOnly: true,
  styleRefs: string[]
}
Response: { jobId: string, estCount: number }
```

### Poll Job Status
```
GET /batch/:id
Response: { 
  status: "pending"|"running"|"succeeded"|"failed",
  completed?: number,
  total?: number 
}
```

### Fetch Results
```
GET /batch/:id/results
Response: { 
  results: [{ id, prompt, outUrl }],
  problems: [] 
}
```

### Cancel Job
```
POST /batch/:id/cancel
Response: { status: "canceled"|"not_found" }
```

### Health Check
```
GET /healthz
Response: { ok: true, timestamp, apiKeyConfigured }
```

## Production Deployment

### Option 1: Cloud Run with Secret Manager

```dockerfile
FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npm run build
ENV NODE_ENV=production
CMD ["node", "dist/server.js"]
```

Deploy:
```bash
gcloud run deploy nn-batch-relay \
  --source . \
  --set-secrets="GEMINI_BATCH_API_KEY=gemini-batch-key:latest" \
  --region=us-central1 \
  --allow-unauthenticated
```

### Option 2: VM with systemd

```ini
[Unit]
Description=NN Batch Relay
After=network.target

[Service]
Type=simple
User=nn-relay
WorkingDirectory=/opt/nn-batch-relay
ExecStart=/usr/bin/node dist/server.js
Restart=on-failure
Environment="NODE_ENV=production"
Environment="PORT=8787"
Environment="BIND_HOST=127.0.0.1"

[Install]
WantedBy=multi-user.target
```

## Security Notes

1. **Never commit real API keys** - Use .env.example as template
2. **Rotate keys regularly** - Use Secret Manager versioning
3. **Monitor usage** - Track API calls and costs
4. **Rate limiting** - Consider adding rate limits in production
5. **Authentication** - Add bearer tokens or mTLS for public endpoints

## Testing

```bash
# Health check
curl http://127.0.0.1:8787/healthz

# Submit test batch
curl -X POST http://127.0.0.1:8787/batch/submit \
  -H "Content-Type: application/json" \
  -d '{
    "rows": [{"prompt": "test"}],
    "variants": 1,
    "styleOnly": true,
    "styleRefs": []
  }'
```