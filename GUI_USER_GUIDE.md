# Nano Banana Studio - GUI User Guide

## Overview
The Nano Banana Studio is a web-based interface for uploading, analyzing, and generating AI images using the Gemini API. Access it at `http://127.0.0.1:8787/app/` after starting the proxy server.

## Key Features

### 1. Session Management (NEW)
The GUI now includes proper session management to control your analysis workflow:

- **New Session Button**: Clears all previously uploaded images from the server
  - Use this when you want to start fresh with a clean image count
  - Located in the top-right corner of the Upload & Analyze page
  - Shows loading state while clearing

- **Start Over Button**: Resets only the UI state without clearing server images
  - Use this to clear the current view while keeping images for later
  - Only appears when you have files or results in the UI

### 2. Upload & Analyze Workflow

#### Step 1: Upload Images
1. **Drag & Drop**: Drag image files directly onto the drop zone
2. **Click to Browse**: Click the upload area to select files
3. **Supported Formats**: JPEG, PNG, WebP (up to 15MB each)
4. **Batch Upload**: Upload up to 500 images at once

#### Step 2: Analyze Images
1. Click **"Analyze"** after uploading
2. View analysis results including:
   - Total images analyzed
   - Successful count
   - Failed count (if any)
   - Processing duration
   - Sample preview of analyzed images

#### Step 3: Remix Prompts
1. After analysis, proceed to prompt remixing
2. Configure remix parameters:
   - Max prompts per image
   - Random seed for variations
3. Generate diverse prompt variations

#### Step 4: Submit for Generation
1. Review generated prompts
2. Perform preflight check
3. Submit batch for AI image generation
4. Monitor job progress

## Session Management Best Practices

### When to Use "New Session"
- Starting a completely new project
- After completing a batch and wanting fresh counts
- When you see unexpected image counts (fixes cumulative count bug)
- Before uploading a new set of unrelated images

### When to Use "Start Over"
- Clearing the UI to reduce clutter
- Resetting form state after an error
- Starting the upload process again without losing server images

### Batch Upload Strategy
Within a single session, you can:
1. Upload initial batch → Analyze
2. Upload more images → Analyze (cumulative within session)
3. Continue until session complete
4. Click "New Session" to start fresh

## Common Issues & Solutions

### Issue: Image count shows more than uploaded
**Solution**: Click "New Session" to clear previous uploads and start fresh

### Issue: Analysis fails with "No images found"
**Solution**: 
1. Ensure images are valid JPEG/PNG/WebP format
2. Check file size is under 15MB
3. Try "New Session" and re-upload

### Issue: Upload progress stuck
**Solution**:
1. Check browser console for errors
2. Refresh page and try again
3. Use "Start Over" to reset UI state

### Issue: Can't see uploaded images
**Solution**: Images are stored server-side. The UI only shows upload status and analysis results.

## Tips & Tricks

1. **Optimal Batch Size**: Upload 10-50 images at a time for best performance
2. **File Naming**: Use descriptive filenames - they're preserved in analysis
3. **Preview Before Submit**: Always check analysis results before proceeding
4. **Session Hygiene**: Start new sessions between unrelated projects
5. **Error Recovery**: Use "Start Over" for UI issues, "New Session" for server issues

## Keyboard Shortcuts
- **Drag & Drop**: Works anywhere on the upload zone
- **Escape**: Cancel current operation (where applicable)
- **Enter**: Confirm dialogs

## API Endpoints Used

The GUI interacts with these backend endpoints:
- `POST /ui/upload` - Upload images
- `POST /ui/analyze` - Analyze uploaded images
- `POST /ui/clear-images` - Clear session (New Session button)
- `POST /ui/remix` - Generate prompt variations
- `POST /ui/preflight` - Validate before submission
- `POST /ui/submit` - Submit for generation
- `GET /ui/poll` - Check job status
- `GET /ui/fetch` - Retrieve results

## Browser Requirements
- **Recommended**: Chrome, Firefox, Safari (latest versions)
- **Required Features**: JavaScript enabled, LocalStorage for preferences
- **Network**: Stable connection to localhost:8787

## Security Notes
- All operations are localhost-only
- No data leaves your machine unless explicitly submitted
- Images are temporarily stored in `./images` directory
- Use "New Session" to clear stored images

## Getting Help
1. Check browser console for detailed error messages
2. Review proxy logs at `./logs/proxy.log`
3. Restart services with `./start-clean.sh restart`
4. See `TROUBLESHOOTING.md` for common issues

---

**Version**: 1.0.0  
**Last Updated**: 2025-09-09  
**Feature**: Session Management with New Session button