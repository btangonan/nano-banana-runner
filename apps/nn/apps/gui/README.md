# Nano Banana Studio - GUI

Web-based interface for the Nano Banana Runner image analysis and generation pipeline.

## Features

- **Drag & Drop Upload**: Upload multiple images with visual previews
- **Security Validation**: Client and server-side file type and size validation  
- **Image Analysis**: Extract metadata, palette, and attributes from images
- **Progress Tracking**: Real-time progress indicators and status updates
- **Error Handling**: Comprehensive error handling with user-friendly messages
- **Responsive Design**: Works on desktop and tablet devices

## Technology Stack

- **Frontend**: React 18 + TypeScript + Vite
- **Styling**: Tailwind CSS with custom component system
- **State Management**: TanStack Query for server state + Zustand for client state
- **File Handling**: react-dropzone for drag/drop uploads
- **Validation**: Zod schemas shared between client and server
- **Icons**: Lucide React icon library

## Development

### Prerequisites

- Node.js 20+
- pnpm package manager
- Proxy server running on port 8787

### Setup

```bash
# Install dependencies
pnpm install

# Start development server (with proxy to API)
pnpm dev

# Build for production
pnpm build

# Type checking
pnpm typecheck
```

### Development Server

The Vite dev server runs on `http://localhost:5173` and proxies API calls to the Fastify server on `http://127.0.0.1:8787`.

### Production Build

Built assets are served by the proxy server at `/app/*` for single-origin deployment.

## Security Features

### Client-Side Validation

- File type validation (JPEG, PNG, WebP only)
- File size limits (15MB per file)
- Filename sanitization
- MIME type verification

### Server-Side Security

- Path traversal prevention
- File extension allowlisting  
- MIME type validation
- Rate limiting (10 requests/minute per IP)
- Multipart form validation
- Size limits enforced at transport layer

### API Error Handling

- RFC 7807 Problem+JSON error responses
- Structured error logging (no secrets)
- User-friendly error messages
- Correlation IDs for debugging

## API Endpoints

### POST /ui/upload

Upload image files with multipart/form-data.

**Request**: Multipart form with `files` field
**Response**: 
```json
{
  "uploaded": 3,
  "files": [
    {
      "filename": "image1.jpg", 
      "path": "./images/abc12345_image1.jpg",
      "size": 256000
    }
  ],
  "warnings": ["Optional warning messages"]
}
```

### POST /ui/analyze

Analyze uploaded images and extract metadata.

**Request**:
```json
{
  "inDir": "./images",
  "concurrency": 4
}
```

**Response**:
```json
{
  "count": 10,
  "successful": 9,
  "failed": 1,
  "duration": "3.2s",
  "sample": [
    {
      "path": "./images/abc12345_image1.jpg",
      "hash": "sha256hash",
      "width": 1920,
      "height": 1080,
      "palette": ["#ff0000", "#00ff00"],
      "subjects": ["person", "building"],
      "style": ["realistic", "outdoors"],
      "lighting": ["natural", "daylight"]
    }
  ],
  "outputPath": "./artifacts/descriptors.json"
}
```

## File Structure

```
apps/gui/
├── src/
│   ├── components/ui/         # Reusable UI components
│   │   ├── Button.tsx
│   │   ├── Card.tsx  
│   │   ├── Progress.tsx
│   │   └── Toast.tsx
│   ├── lib/                   # Utilities and API client
│   │   ├── client.ts         # Typed API client with Zod validation
│   │   ├── contracts.ts      # Shared Zod schemas
│   │   └── utils.ts          # Helper utilities
│   ├── pages/                 # Page components
│   │   └── UploadAnalyze.tsx # Upload and analysis page
│   ├── App.tsx               # Main app with stepper navigation
│   ├── main.tsx              # React entry point
│   └── index.css             # Tailwind styles
├── package.json
├── vite.config.ts            # Vite configuration
├── tailwind.config.js        # Tailwind configuration
└── README.md                 # This file
```

## Component Architecture

### App.tsx
- Main application shell
- Step-based navigation (Upload → Remix → Submit)
- Global toast notifications
- Query client provider

### UploadAnalyze.tsx
- File drag & drop interface
- Upload progress and validation
- Image analysis trigger
- Results display with sample data

### API Client (lib/client.ts)
- Type-safe API calls with Zod validation
- RFC 7807 error handling
- FormData and JSON request support
- Automatic error transformation

## Testing

The GUI includes client-side validation testing and integration tests for the upload/analyze flow.

## Roadmap

- **Session 2**: Remix & Review page with prompt editing
- **Session 3**: Submit & Monitor page with batch job tracking
- **Future**: Gallery view, job history, settings panel

## Troubleshooting

### Upload Issues

1. **Files not uploading**: Check file types (must be JPEG/PNG/WebP under 15MB)
2. **Server errors**: Ensure proxy server is running on port 8787
3. **Validation errors**: Check browser console for detailed error messages

### Development Issues

1. **API calls fail**: Verify Vite proxy configuration in `vite.config.ts`
2. **Type errors**: Run `pnpm typecheck` to validate TypeScript
3. **Styling issues**: Check Tailwind configuration and CSS imports

### Production Issues

1. **404 on refresh**: Ensure proxy serves `index.html` for SPA routes
2. **Static assets missing**: Verify build output in `dist/` directory
3. **API CORS issues**: Single-origin deployment should prevent CORS issues