#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Test the ultra cinematic mode with a simple Node.js script
async function testUltraCinematic() {
    console.log('🎬 Ultra Cinematic Mode Test');
    console.log('=============================');
    
    // Find first image
    const imagesDir = path.join(__dirname, 'apps/nn/proxy/images');
    const files = fs.readdirSync(imagesDir).filter(f => f.match(/\.(png|jpg|jpeg)$/i));
    
    if (files.length === 0) {
        console.log('❌ No images found');
        return;
    }
    
    const imagePath = path.join(imagesDir, files[0]);
    console.log(`📸 Testing with: ${files[0]}`);
    
    // Read and encode image
    const imageBuffer = fs.readFileSync(imagePath);
    const base64Image = imageBuffer.toString('base64');
    
    const payload = JSON.stringify({ image: base64Image });
    
    // Test standard mode first
    console.log('\n🎥 Standard Cinematic Mode:');
    console.log('-----------------------------');
    
    try {
        const standardResponse = await fetch('http://127.0.0.1:8787/analyze/cinematic', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: payload
        });
        
        if (standardResponse.ok) {
            const data = await standardResponse.json();
            console.log(`Title: ${data.descriptor?.title || 'N/A'}`);
            console.log(`Purpose: ${data.descriptor?.purpose || 'N/A'}`);
            console.log(`Shot: ${data.descriptor?.shot?.type || 'N/A'}`);
        } else {
            console.log('❌ Standard mode failed:', await standardResponse.text());
        }
    } catch (error) {
        console.log('❌ Standard mode error:', error.message);
    }
    
    // Test ultra mode
    console.log('\n🎭 ULTRA Cinematic Mode:');
    console.log('-------------------------');
    
    try {
        const ultraResponse = await fetch('http://127.0.0.1:8787/analyze/cinematic?ultra=true', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: payload
        });
        
        if (ultraResponse.ok) {
            const data = await ultraResponse.json();
            console.log(`Title: ${data.descriptor?.title || 'N/A'}`);
            console.log(`Narrative: ${data.descriptor?.narrative || 'N/A'}`);
            console.log(`Camera Model: ${data.descriptor?.camera?.model || 'N/A'}`);
            console.log(`Director Notes: ${data.descriptor?.director_notes || 'N/A'}`);
            console.log(`Film Reference: ${data.descriptor?.references?.[0] || 'N/A'}`);
        } else {
            const errorText = await ultraResponse.text();
            console.log('❌ Ultra mode failed:', errorText);
        }
    } catch (error) {
        console.log('❌ Ultra mode error:', error.message);
    }
}

testUltraCinematic().catch(console.error);