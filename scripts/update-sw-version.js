#!/usr/bin/env node

/**
 * Update Service Worker Version
 * 
 * This script updates the VERSION and BUILD_TIME in the service worker
 * to ensure proper cache invalidation on deployment.
 * 
 * Usage:
 *   node scripts/update-sw-version.js
 * 
 * This should be run as part of the build process:
 *   "build": "node scripts/update-sw-version.js && vite build"
 */

const fs = require('fs');
const path = require('path');

const SW_PATH = path.join(__dirname, '..', 'public', 'service-worker.js');
const PACKAGE_PATH = path.join(__dirname, '..', 'package.json');

// Read package.json to get version
const packageJson = JSON.parse(fs.readFileSync(PACKAGE_PATH, 'utf8'));
const version = packageJson.version;

// Generate build time (ISO date format)
const buildTime = new Date().toISOString().split('T')[0];

// Read service worker file
let swContent = fs.readFileSync(SW_PATH, 'utf8');

// Update VERSION
swContent = swContent.replace(
  /const VERSION = ['"][\d.]+['"]/,
  `const VERSION = '${version}'`
);

// Update BUILD_TIME
swContent = swContent.replace(
  /const BUILD_TIME = ['"][\d-]+['"]/,
  `const BUILD_TIME = '${buildTime}'`
);

// Write back to file
fs.writeFileSync(SW_PATH, swContent, 'utf8');

console.log(`✅ Service Worker version updated:`);
console.log(`   VERSION: ${version}`);
console.log(`   BUILD_TIME: ${buildTime}`);
