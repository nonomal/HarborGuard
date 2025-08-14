#!/usr/bin/env node

/**
 * Example script to upload scan data to HarborGuard API
 * 
 * Usage:
 *   node upload-scan.js <requestId> <reportsDir>
 * 
 * Example:
 *   node upload-scan.js "20250813-145041-8b11d0de" "/reports"
 */

const fs = require('fs');
const path = require('path');

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000/api';

async function readJsonFile(filePath) {
  try {
    const content = await fs.promises.readFile(filePath, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    console.warn(`Could not read ${filePath}:`, error.message);
    return null;
  }
}

async function uploadScan(requestId, reportsDir) {
  console.log(`Uploading scan data for request: ${requestId}`);
  console.log(`Reading reports from: ${reportsDir}`);

  // Read all scanner reports
  const reports = {};
  const reportFiles = {
    trivy: 'trivy.json',
    grype: 'grype.json',
    syft: 'syft.json',
    dockle: 'dockle.json',
    metadata: 'metadata.json'
  };

  for (const [scanner, filename] of Object.entries(reportFiles)) {
    const filePath = path.join(reportsDir, filename);
    const data = await readJsonFile(filePath);
    if (data) {
      reports[scanner] = data;
    }
  }

  if (Object.keys(reports).length === 0) {
    console.error('No valid report files found in', reportsDir);
    process.exit(1);
  }

  // Extract image information from metadata
  const metadata = reports.metadata;
  if (!metadata) {
    console.error('metadata.json is required but not found');
    process.exit(1);
  }

  // Parse image name and tag from environment or derive from available data
  const imageName = process.env.IMAGE_NAME || 'nginx';  // fallback
  const imageTag = process.env.IMAGE_TAG || 'latest';   // fallback
  const imageRegistry = process.env.IMAGE_REGISTRY;     // optional

  const uploadData = {
    requestId,
    image: {
      name: imageName,
      tag: imageTag,
      registry: imageRegistry,
      digest: metadata.Digest,
      platform: `${metadata.Os}/${metadata.Architecture}`,
      sizeBytes: calculateImageSize(metadata.Layers)
    },
    scan: {
      startedAt: new Date(Date.now() - 300000).toISOString(), // 5 minutes ago
      finishedAt: new Date().toISOString(),
      status: 'SUCCESS',
      reportsDir,
      scannerVersions: {
        trivy: process.env.TRIVY_VERSION || 'unknown',
        grype: process.env.GRYPE_VERSION || 'unknown',
        syft: process.env.SYFT_VERSION || 'unknown',
        dockle: process.env.DOCKLE_VERSION || 'unknown'
      },
      scanConfig: {
        scanners: Object.keys(reports).filter(k => k !== 'metadata'),
        timestamp: new Date().toISOString()
      }
    },
    reports
  };

  try {
    console.log('Sending scan data to API...');
    const response = await fetch(`${API_BASE_URL}/scans/upload`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'HarborGuard-Scanner/1.0'
      },
      body: JSON.stringify(uploadData)
    });

    const result = await response.json();

    if (!response.ok) {
      console.error('Upload failed:', result);
      process.exit(1);
    }

    console.log('✅ Scan uploaded successfully!');
    console.log(`   Scan ID: ${result.scanId}`);
    console.log(`   Image ID: ${result.imageId}`);
    console.log(`   Request ID: ${requestId}`);

  } catch (error) {
    console.error('Error uploading scan:', error.message);
    process.exit(1);
  }
}

function calculateImageSize(layers) {
  // Simple estimation - in reality you'd get this from the actual image manifest
  return layers.length * 50 * 1024 * 1024; // 50MB per layer estimate
}

// Main execution
async function main() {
  const [,, requestId, reportsDir] = process.argv;

  if (!requestId || !reportsDir) {
    console.error('Usage: node upload-scan.js <requestId> <reportsDir>');
    console.error('');
    console.error('Environment variables:');
    console.error('  IMAGE_NAME      - Image name (default: nginx)');
    console.error('  IMAGE_TAG       - Image tag (default: latest)');
    console.error('  IMAGE_REGISTRY  - Registry URL (optional)');
    console.error('  API_BASE_URL    - API base URL (default: http://localhost:3000/api)');
    console.error('  *_VERSION       - Scanner versions (optional)');
    process.exit(1);
  }

  await uploadScan(requestId, reportsDir);
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { uploadScan };