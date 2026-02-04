# Windows Packaging Fix - TODO List

## Steps to Complete:

### 1. Fix package.json build configuration ✅ COMPLETED
- [x] Update `files` array in build config to include all necessary files
- [x] Fix `main` field to point to correct entry file (dist/main.cjs)
- [x] Verify electron-builder configuration

### 2. Update vite.config.ts ✅ COMPLETED
- [x] Ensure `outDir` is set to `dist`
- [x] Verify base path configuration

### 3. Update main.cjs ✅ COMPLETED
- [x] Fix path resolution for production builds
- [x] Ensure __dirname is properly defined

### 4. Build the Windows executable
- [x] Run `npm install`
- [x] Run `npm run build`
- [x] Run `npm run electron:build`

## Notes:
- Project is Electron + React + Vite
- Target: Windows Portable executable
- App ID: com.buildwhilebleeding.studio

