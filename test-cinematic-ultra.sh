#!/bin/bash

# Test script for Ultra Cinematic mode
# Compares standard vs ultra cinematic descriptions

echo "🎬 Testing Ultra Cinematic Mode Enhancement"
echo "=========================================="

# Check if proxy is running
if ! curl -s http://127.0.0.1:8787/healthz > /dev/null 2>&1; then
    echo "❌ Proxy server not running. Start with: ./start-clean.sh"
    exit 1
fi

# Find first image in proxy/images directory
IMAGE_PATH="apps/nn/proxy/images/"
if [ ! -d "$IMAGE_PATH" ]; then
    echo "❌ No images directory found at $IMAGE_PATH"
    exit 1
fi

# Get first image file
IMAGE_FILE=$(find "$IMAGE_PATH" -name "*.png" -o -name "*.jpg" -o -name "*.jpeg" | head -1)
if [ -z "$IMAGE_FILE" ]; then
    echo "❌ No image files found in $IMAGE_PATH"
    echo "Upload some images through the GUI first"
    exit 1
fi

echo "📸 Testing with image: $(basename "$IMAGE_FILE")"
echo

# Convert image to base64
BASE64_IMAGE=$(base64 -i "$IMAGE_FILE")

# Create temporary JSON files for requests
TEMP_DIR="/tmp/cinematic-test"
mkdir -p "$TEMP_DIR"
echo "{\"image\":\"$BASE64_IMAGE\"}" > "$TEMP_DIR/request.json"

echo "🎥 Standard Cinematic Mode:"
echo "----------------------------"

# Test standard cinematic mode
curl -s -X POST http://127.0.0.1:8787/analyze/cinematic \
  -H "Content-Type: application/json" \
  -d @"$TEMP_DIR/request.json" | \
  jq -r '.descriptor | {title, purpose, "narrative/subject": .subject, mood: .mood[0:3], "camera": .shot.type, "style": .style[0:3]}'

echo
echo "🎭 ULTRA Cinematic Mode (Enhanced):"
echo "------------------------------------"

# Test ultra cinematic mode
curl -s -X POST "http://127.0.0.1:8787/analyze/cinematic?ultra=true" \
  -H "Content-Type: application/json" \
  -d @"$TEMP_DIR/request.json" | \
  jq -r '.descriptor | {title, purpose, narrative: .narrative // "N/A", "camera_model": .camera.model // "N/A", "film_reference": .references[0] // "N/A", "director_notes": .director_notes // "N/A"}'

# Cleanup
rm -rf "$TEMP_DIR"

echo
echo "✅ Comparison complete. Ultra mode should show:"
echo "   - Richer narrative descriptions"
echo "   - Specific camera/film references" 
echo "   - Director notes and production context"
echo "   - More cinematic language and depth"