# Image Counter Bug Fix Summary

## Problem
When uploading 3 images, the analysis showed 6 images analyzed instead of 3.

## Root Cause Analysis

### Investigation Findings
1. **Directory State**: Found 6 images in `/apps/nn/proxy/images/`:
   - 3 unique images uploaded at 07:16
   - Same 3 images re-uploaded at 08:59
   - Each with different hash prefixes (e.g., `573ec5ff_` vs `f008d5b6_` for same image)

2. **Workflow Issue**: 
   - Images from previous sessions persisted in the upload directory
   - New uploads didn't clear old images
   - Analysis counted ALL images in directory, not just newly uploaded ones

3. **Session Management Flaw**:
   - "New Session" button cleared images correctly
   - But users could upload without clicking "New Session" first
   - No automatic cleanup on first upload of new session

## Solution Implemented

### Code Changes in `UploadAnalyze.tsx`

1. **Added State Tracking**:
```typescript
const [isFirstUpload, setIsFirstUpload] = useState(true)
```

2. **Modified Upload Logic**:
```typescript
// Clear existing images on first upload to prevent accumulation
const url = isFirstUpload ? '/ui/upload?clearExisting=true' : '/ui/upload'
```

3. **State Management**:
   - Set `isFirstUpload = false` after successful upload
   - Reset `isFirstUpload = true` when "New Session" clicked
   - Ensures clean slate for each new session

## How It Works Now

### Upload Flow:
1. **First Upload**: Automatically clears any existing images before uploading
2. **Subsequent Uploads**: Add to current session without clearing
3. **New Session**: Resets flag so next upload clears again

### Benefits:
- ✅ Prevents image accumulation from previous sessions
- ✅ Maintains ability to upload multiple batches in same session
- ✅ Accurate image count in analysis
- ✅ No manual "New Session" click required before first upload

## Testing Results

### Before Fix:
- Upload 3 images → Shows 6 analyzed (includes old images)
- Directory had duplicates from multiple sessions

### After Fix:
- Upload 3 images → Shows 3 analyzed ✅
- Directory only contains current session images
- Automatic cleanup on session start

## Technical Details

### Server-Side (`ui.upload.ts`):
- Already had `clearExisting` query parameter support
- Clears all images when `?clearExisting=true` passed

### Client-Side (`UploadAnalyze.tsx`):
- Intelligently passes flag based on session state
- Maintains user workflow without manual intervention

## Impact
- **User Experience**: Seamless, accurate image counting
- **Data Integrity**: No cross-session contamination
- **Backward Compatible**: Existing workflows unchanged

## Files Modified
1. `/apps/nn/apps/gui/src/pages/UploadAnalyze.tsx`
   - Added `isFirstUpload` state
   - Modified upload URL logic
   - Updated state management in mutations

## Verification
```bash
# Clear test
curl -X POST http://127.0.0.1:8787/ui/clear-images -d '{}'

# Check directory
ls -la apps/nn/proxy/images/ | grep -E "\.(jpg|jpeg|png|webp)" | wc -l
# Result: 0 (clean)

# Upload and analyze shows correct count
```

## Status
✅ **FIXED** - Image counter now shows accurate count without manual intervention