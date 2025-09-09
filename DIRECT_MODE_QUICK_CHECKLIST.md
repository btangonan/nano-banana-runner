# Direct Mode Implementation Checklist

## ✅ Backend (Already Complete)
- [x] Environment variables added to `env.ts`
- [x] Proxy configuration updated
- [x] Batch route guardrails implemented
- [x] Feature flag OFF by default
- [x] Validation caps in place
- [x] Tested with curl

## 📋 Frontend Implementation Steps

### Step 1: Create DirectJsonPanel Component
```bash
# Create new file
touch apps/nn/apps/gui/src/components/DirectJsonPanel.tsx
# Copy code from DIRECT_MODE_FRONTEND_GUIDE.md
```

### Step 2: Update SubmitMonitor.tsx
Add these changes in order:
1. **Import** DirectJsonPanel (line ~7)
2. **Add state** for mode toggle (line ~38)
3. **Add handler** for Direct submit (line ~198)
4. **Replace** Configuration Card section (line ~270)
5. **Update** Actions to hide preflight in Direct Mode (line ~486)

### Step 3: Enable Feature
```bash
# Add to .env
echo "NN_ENABLE_DIRECT_MODE=true" >> .env
```

### Step 4: Restart Services
```bash
# Terminal 1: Restart proxy
pkill -f "pnpm.*proxy.*dev"
cd apps/nn/proxy && pnpm dev

# Terminal 2: Restart GUI
cd apps/nn/apps/gui && pnpm dev
```

## 🧪 Testing Checklist

### Backend Tests
- [ ] Direct Mode OFF: Regular submission works
- [ ] Direct Mode ON: Direct submission works
- [ ] Validation: Rejects >200 rows
- [ ] Validation: Rejects >4000 char prompts
- [ ] Validation: Forces styleOnly=true

### Frontend Tests
- [ ] Mode toggle switches views
- [ ] URL param ?mode=direct persists
- [ ] JSON validation shows errors
- [ ] Templates load correctly
- [ ] Dry-run validates JSON
- [ ] Submit disabled until dry-run
- [ ] Job monitoring works after submit
- [ ] Toast notifications appear

### End-to-End Tests
- [ ] Visual Mode → Submit → Monitor → Complete
- [ ] Direct Mode → Dry-run → Submit → Monitor → Complete
- [ ] Invalid JSON → Shows error → Can't submit
- [ ] Switch modes → State preserved
- [ ] Refresh page → Mode persisted

## 📁 Files Modified

| File | Changes | LOC |
|------|---------|-----|
| `components/DirectJsonPanel.tsx` | NEW | ~100 |
| `pages/SubmitMonitor.tsx` | MODIFY | ~50 |
| `.env` | ADD FLAG | 1 |
| **Total** | **2 files** | **~150** |

## 🎯 Key Features

### Safety
- ✅ Dry-run required before submission
- ✅ Real-time JSON validation  
- ✅ Cost estimation visible
- ✅ Server-side validation enforced

### UX
- ✅ Mode toggle (Visual ↔ Direct)
- ✅ Template library
- ✅ URL persistence
- ✅ Progress tracking

### Technical
- ✅ TypeScript throughout
- ✅ Zod validation
- ✅ Reuses existing types
- ✅ Zero breaking changes

## 🚀 Quick Test Commands

```bash
# Test backend is ready
curl http://127.0.0.1:8787/healthz

# Test Direct Mode submission
curl -X POST http://127.0.0.1:8787/batch/submit \
  -H "Content-Type: application/json" \
  -d '{"rows":[{"prompt":"Test","tags":["test"],"seed":1}],"variants":1,"styleOnly":true,"styleRefs":[]}'

# Open GUI
open http://127.0.0.1:5174
```

## ⚠️ Common Issues & Fixes

| Issue | Fix |
|-------|-----|
| Direct Mode not visible | Check `NN_ENABLE_DIRECT_MODE=true` in .env |
| Proxy connection refused | Restart proxy: `cd apps/nn/proxy && pnpm dev` |
| CORS errors | Check proxy allows origin `http://127.0.0.1:5174` |
| Submit fails | Check proxy logs for validation errors |
| Mode doesn't persist | Check URL params are being set |

## 📊 Success Metrics

- [ ] Direct Mode toggle appears in UI
- [ ] Can paste and validate JSON
- [ ] Dry-run completes successfully
- [ ] Submit creates job with correct ID
- [ ] Job monitoring shows progress
- [ ] No console errors
- [ ] No breaking changes to Visual Mode

## 🎉 Done When

1. ✅ Backend accepting Direct Mode requests
2. ✅ Frontend shows mode toggle
3. ✅ JSON editor validates and submits
4. ✅ Job monitoring works for both modes
5. ✅ All tests pass
6. ✅ Documentation updated

---

**Total Time**: ~30-60 minutes  
**Risk Level**: Low (feature flag protected)  
**Rollback**: Set `NN_ENABLE_DIRECT_MODE=false` and restart