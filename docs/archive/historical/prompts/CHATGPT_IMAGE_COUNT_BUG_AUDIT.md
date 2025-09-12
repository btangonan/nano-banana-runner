# Image Count Bug Audit Request for ChatGPT 5

## Bug Description
The Nano Banana Runner GUI application has a persistent state bug where the "Analyzed Images" count always shows a cumulative total across all sessions rather than just the images from the current upload session. This creates user confusion as they see more images analyzed than they uploaded.

**Observed Behavior:**
- User uploads 5 images → Analyze shows "5 images analyzed" ✅
- User uploads 3 more images → Analyze shows "8 images analyzed" ❌ (Expected: 3)
- User refreshes page, uploads 2 images → Analyze shows "10 images analyzed" ❌ (Expected: 2)

## Root Cause Analysis

After systematic investigation, the root cause has been identified:

### 1. Image Persistence Issue
**Location:** `apps/nn/proxy/src/routes/ui.upload.ts`
```typescript
// Line 13: Images are stored in a persistent directory
const UPLOAD_DIR = './images';

// Lines 74-80: clearExisting flag exists but defaults to false
let clearExisting = false;
// Can be passed as query param: /ui/upload?clearExisting=true
if (queryParams && (queryParams.clearExisting === 'true')) {
  clearExisting = true;
}
```

### 2. Frontend Not Clearing Images
**Location:** `apps/nn/apps/gui/src/pages/UploadAnalyze.tsx`
```typescript
// Line 36: Frontend doesn't pass clearExisting parameter
return apiClient.postFormData('/ui/upload', formData, UploadResponse)
// Should be: apiClient.postFormData('/ui/upload?clearExisting=true', ...)
```

### 3. Analyze Counts All Images
**Location:** `apps/nn/proxy/src/routes/ui.analyze.ts`
```typescript
// Lines 30-33: Reads ALL images from directory
const files = await readdir(opts.inDir);
const imagePaths = files.filter(isSupportedImage);

// Line 76: Returns total count of all images
count: descriptors.length,
```

## Solution Proposals

Please evaluate the following solution approaches and recommend the best path forward:

### Solution A: Session-Based Upload Directories
**Approach:** Create unique directories per upload session
```typescript
// ui.upload.ts modification
const sessionId = randomUUID();
const UPLOAD_DIR = `./images/session-${sessionId}`;
await mkdir(UPLOAD_DIR, { recursive: true });

// Pass sessionId back to frontend
return { 
  uploaded: files.length,
  sessionId,
  // ...
}

// ui.analyze.ts modification
const { sessionId } = request.body;
const inDir = sessionId ? `./images/session-${sessionId}` : './images';
```

**Pros:**
- True session isolation
- Supports multiple concurrent users
- No data loss between sessions

**Cons:**
- Requires cleanup mechanism for old sessions
- More complex state management
- Storage accumulation over time

### Solution B: Always Clear on New Upload (Simple)
**Approach:** Frontend always passes clearExisting=true
```typescript
// UploadAnalyze.tsx modification
return apiClient.postFormData('/ui/upload?clearExisting=true', formData, UploadResponse)
```

**Pros:**
- Minimal code change (1 line)
- Immediate fix
- No state management complexity

**Cons:**
- Destructive - loses previous uploads
- Can't accumulate images across multiple uploads in same session
- Poor UX if user wants to upload in batches

### Solution C: Clear on Session Start
**Approach:** Add "New Session" button or clear on component mount
```typescript
// UploadAnalyze.tsx modification
useEffect(() => {
  // Clear images when component mounts (new session)
  apiClient.post('/ui/clear-images');
}, []);

// Or add explicit button
<Button onClick={() => startNewSession()}>
  Start New Analysis Session
</Button>
```

**Pros:**
- Explicit user control
- Clear session boundaries
- Allows batch uploads within session

**Cons:**
- Requires new endpoint or modification
- May clear unintentionally on page refresh

### Solution D: Track Upload Batches
**Approach:** Maintain metadata about which images belong to current batch
```typescript
// Track uploaded files in current batch
const [currentBatchFiles, setCurrentBatchFiles] = useState<string[]>([]);

// On upload success
setCurrentBatchFiles(data.uploadedFiles);

// Pass to analyze
apiClient.post('/ui/analyze', { 
  files: currentBatchFiles  // Only analyze specific files
})
```

**Pros:**
- Precise control
- Non-destructive
- Supports complex workflows

**Cons:**
- Requires API changes
- More complex implementation
- State synchronization challenges

## Recommended Implementation

Please provide your recommendation considering:

1. **Immediate Fix Priority:** Which solution provides the quickest resolution with minimal risk?

2. **Long-term Architecture:** Which approach best aligns with application architecture and scalability needs?

3. **User Experience:** Which solution provides the most intuitive experience for users who may:
   - Upload images in multiple batches
   - Want to restart their analysis
   - Accidentally refresh the page

4. **Implementation Effort:** Rank solutions by implementation complexity and testing requirements

5. **Backward Compatibility:** Will the fix affect existing users or require migration?

## Additional Considerations

1. **Cleanup Strategy:** If implementing session directories, how should old sessions be cleaned?
   - Time-based (delete after 24 hours)
   - LRU cache (keep last N sessions)
   - Manual cleanup command

2. **Multi-user Environment:** Should the fix consider multiple concurrent users?
   - Current architecture assumes single-user (localhost)
   - Future cloud deployment may need user isolation

3. **Progress Indication:** Should the UI show:
   - "Analyzing 3 new images" vs "Analyzing 3 of 10 total images"
   - Session indicator: "Session started 10 minutes ago"
   - Clear session button visibility

## Code Quality Requirements

The chosen solution should:
- Maintain existing Vibe Top 5 principles (≤300 LOC files, typed, validated)
- Include appropriate error handling
- Add logging for debugging
- Include unit tests for new behavior
- Update documentation

## Test Cases

The fix should pass these scenarios:
1. Fresh session → Upload 5 images → Analyze shows 5 ✅
2. Same session → Upload 3 more → Analyze shows 3 (or 8 with option) ✅
3. Page refresh → Upload 2 images → Analyze shows 2 ✅
4. Error recovery → Failed upload → Retry → Correct count ✅
5. Concurrent sessions → Two tabs → Independent counts ✅

Please provide:
1. Your recommended solution with rationale
2. Implementation steps with code snippets
3. Migration strategy if needed
4. Test plan to verify the fix
5. Documentation updates required

---

**Context:** This is for a production application using TypeScript, React, Fastify, and Zod validation. The application is currently single-user (localhost) but may deploy to cloud in future. User experience and code quality are top priorities.