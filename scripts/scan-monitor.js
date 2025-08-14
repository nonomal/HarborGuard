#!/usr/bin/env node

/**
 * HarborGuard Scan Monitor CLI
 * Monitor scan status in real-time from the command line
 */

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000/api';

async function startScan(imageName, imageTag, registry) {
  console.log(`🚀 Starting scan for ${imageName}:${imageTag}${registry ? ` from ${registry}` : ''}`);
  
  try {
    const response = await fetch(`${API_BASE_URL}/scans/start`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        imageName,
        imageTag,
        registry,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to start scan');
    }

    const result = await response.json();
    console.log(`✅ Scan started successfully`);
    console.log(`   Request ID: ${result.requestId}`);
    console.log(`   Scan ID: ${result.scanId}`);
    
    return result.requestId;
  } catch (error) {
    console.error(`❌ Failed to start scan: ${error.message}`);
    process.exit(1);
  }
}

async function getScanStatus(requestId) {
  try {
    const response = await fetch(`${API_BASE_URL}/scans/status/${requestId}`);
    
    if (!response.ok) {
      if (response.status === 404) {
        return { error: 'Scan job not found' };
      }
      throw new Error(`HTTP ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    return { error: error.message };
  }
}

function formatStatus(status) {
  const statusEmojis = {
    RUNNING: '🔄',
    SUCCESS: '✅',
    FAILED: '❌',
    CANCELLED: '⏹️',
    PARTIAL: '⚠️'
  };
  
  return `${statusEmojis[status] || '❓'} ${status}`;
}

function formatProgress(progress) {
  if (progress === undefined || progress === null) return '';
  
  const barLength = 20;
  const filled = Math.round((progress / 100) * barLength);
  const empty = barLength - filled;
  
  const bar = '█'.repeat(filled) + '░'.repeat(empty);
  return `[${bar}] ${progress}%`;
}

async function monitorScan(requestId, showProgress = true) {
  console.log(`\n📊 Monitoring scan: ${requestId}`);
  console.log('Press Ctrl+C to stop monitoring\n');

  let lastStatus = null;
  let lastProgress = null;

  const poll = async () => {
    const result = await getScanStatus(requestId);
    
    if (result.error) {
      console.log(`\n❌ Error: ${result.error}`);
      return false; // Stop polling
    }

    const { status, progress, error } = result;
    
    // Only update if status or progress changed
    if (status !== lastStatus || progress !== lastProgress) {
      const timestamp = new Date().toLocaleTimeString();
      let line = `[${timestamp}] ${formatStatus(status)}`;
      
      if (showProgress && progress !== undefined) {
        line += ` ${formatProgress(progress)}`;
      }
      
      if (error) {
        line += ` - Error: ${error}`;
      }
      
      console.log(line);
      
      lastStatus = status;
      lastProgress = progress;
    }

    // Stop polling if scan is complete
    if (['SUCCESS', 'FAILED', 'CANCELLED'].includes(status)) {
      console.log(`\n🏁 Scan completed with status: ${formatStatus(status)}`);
      
      if (status === 'SUCCESS') {
        console.log(`\n🔗 View results at: ${API_BASE_URL.replace('/api', '')}/image/${result.imageId}/scan/${result.scanId}`);
      }
      
      return false; // Stop polling
    }

    return true; // Continue polling
  };

  // Initial poll
  if (!(await poll())) return;

  // Set up interval polling
  const interval = setInterval(async () => {
    if (!(await poll())) {
      clearInterval(interval);
    }
  }, 2000); // Poll every 2 seconds

  // Handle Ctrl+C
  process.on('SIGINT', () => {
    clearInterval(interval);
    console.log('\n\n👋 Monitoring stopped');
    process.exit(0);
  });
}

async function listJobs() {
  try {
    const response = await fetch(`${API_BASE_URL}/scans/jobs`);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const result = await response.json();
    const jobs = result.jobs || [];
    
    if (jobs.length === 0) {
      console.log('📋 No active scan jobs');
      return;
    }

    console.log('📋 Active scan jobs:');
    console.log('');
    
    jobs.forEach(job => {
      const timestamp = new Date().toLocaleTimeString();
      let line = `  ${job.requestId} - ${formatStatus(job.status)}`;
      
      if (job.progress !== undefined) {
        line += ` ${formatProgress(job.progress)}`;
      }
      
      if (job.error) {
        line += ` - ${job.error}`;
      }
      
      console.log(line);
    });
  } catch (error) {
    console.error(`❌ Failed to list jobs: ${error.message}`);
    process.exit(1);
  }
}

// CLI command parsing
function showHelp() {
  const scriptName = process.env.SCRIPT_NAME || 'node scan-monitor.js';
  console.log(`
HarborGuard Scan Monitor CLI

Usage:
  ${scriptName} start <image> <tag> [registry]  Start a new scan
  ${scriptName} monitor <requestId>             Monitor specific scan
  ${scriptName} list                           List active scan jobs
  ${scriptName} help                           Show this help

Environment Variables:
  API_BASE_URL    API base URL (default: http://localhost:3000/api)

Examples:
  ${scriptName} start nginx 1.27
  ${scriptName} start myapp latest docker.io
  ${scriptName} monitor 20250813-145041-8b11d0de
  ${scriptName} list
`);
}

async function main() {
  const [,, command, ...args] = process.argv;

  switch (command) {
    case 'start':
      if (args.length < 2) {
        console.error('❌ Usage: start <image> <tag> [registry]');
        process.exit(1);
      }
      const [imageName, imageTag, registry] = args;
      const requestId = await startScan(imageName, imageTag, registry);
      
      // Automatically start monitoring
      await monitorScan(requestId);
      break;

    case 'monitor':
      if (args.length < 1) {
        console.error('❌ Usage: monitor <requestId>');
        process.exit(1);
      }
      await monitorScan(args[0]);
      break;

    case 'list':
      await listJobs();
      break;

    case 'help':
    case '--help':
    case '-h':
      showHelp();
      break;

    default:
      console.error('❌ Unknown command:', command);
      showHelp();
      process.exit(1);
  }
}

// Run the CLI
main().catch(error => {
  console.error('❌ Unexpected error:', error.message);
  process.exit(1);
});