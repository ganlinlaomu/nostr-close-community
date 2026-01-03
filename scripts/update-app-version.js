#!/usr/bin/env node

/**
 * Update App Version in dexie.ts
 * 
 * Keeps APP_VERSION in sync with package.json
 */

const fs = require('fs');
const path = require('path');

const DEXIE_PATH = path.join(__dirname, '..', 'src', 'db', 'dexie.ts');
const PACKAGE_PATH = path.join(__dirname, '..', 'package.json');

// Read package.json to get version
const packageJson = JSON.parse(fs.readFileSync(PACKAGE_PATH, 'utf8'));
const version = packageJson.version;

// Read dexie.ts file
let dexieContent = fs.readFileSync(DEXIE_PATH, 'utf8');

// Update APP_VERSION
dexieContent = dexieContent.replace(
  /export const APP_VERSION = ["'][^"']+["']/,
  `export const APP_VERSION = "${version}"`
);

// Write back to file
fs.writeFileSync(DEXIE_PATH, dexieContent, 'utf8');

console.log(`✅ APP_VERSION updated to: ${version}`);
