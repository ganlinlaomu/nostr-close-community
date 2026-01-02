# Video Encryption Feature Documentation

## Overview

This document describes the video encryption and rendering features implemented in HaiNei. The implementation provides end-to-end encryption for videos uploaded to the platform, ensuring privacy and security similar to the existing image encryption system.

## Features

### 1. Direct Video Rendering (Task 1)
- **What Changed**: Removed thumbnail placeholders and play button overlays from video display on the Home page
- **Behavior**: Videos now render directly without requiring user interaction to load
- **Benefits**: 
  - Faster video access
  - Cleaner UI
  - Consistent experience across video types

### 2. Video Encryption (Task 2)

#### Encryption Process
1. **Client-side Encryption**: Videos are encrypted in the browser before upload
2. **Algorithm**: AES-GCM-256 (same as image encryption for consistency)
3. **Key Generation**: Each video gets a unique encryption key
4. **Metadata Storage**: Encryption metadata embedded in message content

#### Encryption Flow
```
User selects video file
    ↓
Generate AES-GCM key (256-bit)
    ↓
Encrypt video bytes with key + random IV
    ↓
Upload encrypted blob to Blossom server
    ↓
Create encrypted reference with metadata
    ↓
Store reference in message content
```

#### Decryption and Playback Flow
```
Receive message with encrypted video
    ↓
Parse encrypted video reference
    ↓
Fetch encrypted blob from Blossom
    ↓
Decrypt with embedded key + IV
    ↓
Create Blob URL for playback
    ↓
Play in HTML5 video element
```

## Technical Implementation

### New Files Created

#### 1. `src/utils/videoCrypto.ts`
Core video encryption/decryption utilities:
- `encryptVideoBytes()`: Encrypt video data with AES-GCM
- `decryptVideoBytes()`: Decrypt video data
- `encryptVideoFile()`: High-level file encryption
- `decryptVideoToBlob()`: Decrypt and create playable blob URL
- `generateVideoEncryptionKey()`: Generate AES-GCM key
- `exportKeyToBase64()`: Export key for storage
- `importKeyFromBase64()`: Import key from storage

#### 2. `src/utils/encryptedVideoRef.ts`
Metadata format and encoding:
- `EncryptedVideoMetadata`: Interface for video encryption metadata
- `encodeEncryptedVideoRef()`: Create encrypted reference string
- `decodeEncryptedVideoRef()`: Parse encrypted reference
- `isEncryptedVideoRef()`: Check if string is encrypted video reference

#### 3. `src/components/EncryptedVideoPlayer.vue`
Vue component for encrypted video playback:
- Fetches encrypted video from URL
- Decrypts video data
- Creates blob URL for playback
- Handles loading and error states
- Cleans up resources on unmount

### Modified Files

#### 1. `src/components/VideoPlayer.vue`
- Removed thumbnail/poster functionality
- Added encrypted video detection
- Integrates EncryptedVideoPlayer for encrypted videos
- Maintains support for YouTube, Vimeo, and direct URLs

#### 2. `src/components/PostEditorModal.vue`
- Updated video upload to include encryption
- Uses `encryptVideoFile()` utility function
- Generates encrypted video references
- Saves encrypted metadata to message content

## Metadata Format

### Encrypted Video Reference Format
```
blossom+aesgcm+video:<base64(json)>
```

### JSON Structure
```typescript
{
  v: 1,                    // Version number
  url: string,             // Blossom URL for encrypted blob
  mime: string,            // Original MIME type (e.g., "video/mp4")
  alg: "AES-GCM",         // Encryption algorithm
  iv: string,             // Base64-encoded IV (12 bytes)
  key: string,            // Base64-encoded key (32 bytes)
  size?: number,          // Optional: Original file size
  duration?: number       // Optional: Video duration in seconds
}
```

### Example
```
blossom+aesgcm+video:eyJ2IjoxLCJ1cmwiOiJodHRwczovL2Jsb3Nzb20uZXhhbXBsZS5jb20vYWJjMTIzLmVuYyIsIm1pbWUiOiJ2aWRlby9tcDQiLCJhbGciOiJBRVMtR0NNIiwiaXYiOiJhYmNkZWYxMjM0NTYiLCJrZXkiOiJ4eXo3ODlhYmNkZWZnaGlqa2xtbm9wcXJzdHV2d3h5eiJ9
```

## Security Considerations

### Strengths
1. **End-to-End Encryption**: Videos encrypted before leaving client
2. **Unique Keys**: Each video has its own encryption key
3. **Strong Algorithm**: AES-GCM-256 provides authenticated encryption
4. **Secure Key Derivation**: Uses Web Crypto API for key generation
5. **No Key Server**: Keys embedded in encrypted messages (Nostr-encrypted)

### Important Notes
1. **Key Distribution**: Encryption keys are embedded in message content and protected by Nostr's encryption layer
2. **Browser Storage**: Decrypted video blobs are temporary and cleaned up after use
3. **Memory Management**: Blob URLs are revoked on component unmount
4. **No Plaintext Storage**: Original videos are never stored unencrypted on server

## Browser Compatibility

### Requirements
- Modern browser with Web Crypto API support
- HTML5 video element support
- Blob URL support

### Tested Browsers
- Chrome/Edge 90+
- Firefox 90+
- Safari 14+

### PWA Support
- Full support in Progressive Web App mode
- Service worker compatible
- Offline playback support for cached encrypted videos

## Usage Examples

### Uploading Encrypted Video
1. Open post editor (+ button on Home page)
2. Click "上传图片/视频" button
3. Select video file(s)
4. Video is automatically encrypted during upload
5. Encrypted reference is embedded in post content

### Viewing Encrypted Video
1. Encrypted videos appear with loading indicator
2. Automatic decryption in background
3. Video plays in standard HTML5 player
4. Controls: play/pause, seek, volume, fullscreen

### Supported Video Types
- **Encrypted**: MP4, WebM, OGG (uploaded via Blossom)
- **External**: YouTube, Vimeo (embedded iframes)
- **Direct**: MP4, WebM, OGG (direct URLs)

## Performance Considerations

### Encryption Performance
- Large videos (>100MB) may take several seconds to encrypt
- Progress indicator shows upload status
- Encryption is CPU-intensive but runs asynchronously

### Decryption Performance
- Decryption happens on demand when video is viewed
- Loading indicator shows decryption progress
- Decrypted blob cached in memory during playback
- Blob URL revoked when user navigates away

### Optimization Tips
1. **Video Size**: Keep videos under 100MB for best performance
2. **Format**: Use MP4 with H.264 codec for best compatibility
3. **Resolution**: 720p recommended for balance of quality/size
4. **Compression**: Pre-compress videos before upload

## Troubleshooting

### Common Issues

#### Video Won't Decrypt
- Check browser console for errors
- Verify Blossom server is accessible
- Ensure encrypted reference format is correct

#### Video Won't Play
- Check video MIME type compatibility
- Try different browser
- Check browser console for codec errors

#### Upload Fails
- Verify Blossom server configuration in Settings
- Check file size limits
- Ensure proper authentication setup

### Debug Mode
Enable debug logging by opening browser console and checking for:
- Encryption progress messages
- Upload status
- Decryption errors
- Blob URL creation

## Future Enhancements

### Potential Improvements
1. **Video Compression**: Compress videos before encryption
2. **Thumbnail Generation**: Generate encrypted thumbnails
3. **Streaming**: Chunked encryption/decryption for large files
4. **Progress Indicators**: More detailed progress during encryption
5. **Quality Selection**: Multiple quality levels for playback
6. **Shared Keys**: Option to use Nostr key derivation for video keys

### Backward Compatibility
- All changes maintain compatibility with existing plain video URLs
- Encrypted videos can coexist with YouTube/Vimeo embeds
- Old posts with plain videos continue to work

## Related Documentation

- Image Encryption: `IMAGE_FEATURES_README.md`
- Image Compression: `IMAGE_COMPRESSION_IMPLEMENTATION.md`
- Blossom Integration: `src/utils/blossom.ts`
- Nostr Crypto: `src/nostr/crypto.ts`

## Credits

Implementation follows the same encryption patterns as the existing image encryption system, ensuring consistency and maintainability across the codebase.
