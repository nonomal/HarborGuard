#!/bin/bash

# Test script for the internal scanning API
set -e

API_BASE_URL="${API_BASE_URL:-http://localhost:3001/api}"
IMAGE="${1:-nginx}"
TAG="${2:-1.27}"

echo "Testing internal scanning API"
echo "API Base: $API_BASE_URL"
echo "Image: $IMAGE:$TAG"
echo ""

# 1. Start scan
echo "1. Starting scan..."
START_RESPONSE=$(curl -s -X POST "$API_BASE_URL/scans/start" \
  -H "Content-Type: application/json" \
  -d "{\"image\":\"$IMAGE\",\"tag\":\"$TAG\"}")

echo "Start response: $START_RESPONSE"

# Extract requestId from response
REQUEST_ID=$(echo "$START_RESPONSE" | grep -o '"requestId":"[^"]*"' | cut -d'"' -f4)
SCAN_ID=$(echo "$START_RESPONSE" | grep -o '"scanId":"[^"]*"' | cut -d'"' -f4)

if [[ -z "$REQUEST_ID" ]]; then
  echo "❌ Failed to start scan or get requestId"
  exit 1
fi

echo "✅ Scan started successfully"
echo "   Request ID: $REQUEST_ID"
echo "   Scan ID: $SCAN_ID"
echo ""

# 2. Monitor scan progress
echo "2. Monitoring scan progress..."
while true; do
  STATUS_RESPONSE=$(curl -s "$API_BASE_URL/scans/status/$REQUEST_ID")
  STATUS=$(echo "$STATUS_RESPONSE" | grep -o '"status":"[^"]*"' | cut -d'"' -f4)
  PROGRESS=$(echo "$STATUS_RESPONSE" | grep -o '"progress":[0-9]*' | cut -d':' -f2)
  
  echo "   Status: $STATUS, Progress: ${PROGRESS:-0}%"
  
  if [[ "$STATUS" == "SUCCESS" ]]; then
    echo "✅ Scan completed successfully!"
    break
  elif [[ "$STATUS" == "FAILED" ]]; then
    echo "❌ Scan failed"
    ERROR=$(echo "$STATUS_RESPONSE" | grep -o '"error":"[^"]*"' | cut -d'"' -f4)
    echo "   Error: $ERROR"
    exit 1
  elif [[ "$STATUS" == "CANCELLED" ]]; then
    echo "🛑 Scan was cancelled"
    exit 1
  fi
  
  sleep 5
done
echo ""

# 3. Get scan results
echo "3. Retrieving scan results..."
RESULTS_RESPONSE=$(curl -s "$API_BASE_URL/scans/$REQUEST_ID")

# Check if results contain vulnerability data
VULN_COUNT=$(echo "$RESULTS_RESPONSE" | grep -o '"vulnerabilityCount":{[^}]*}' || echo "")
RISK_SCORE=$(echo "$RESULTS_RESPONSE" | grep -o '"riskScore":[0-9]*' | cut -d':' -f2 || echo "N/A")

if [[ -n "$VULN_COUNT" ]]; then
  echo "✅ Scan results retrieved successfully"
  echo "   Risk Score: $RISK_SCORE"
  echo "   Vulnerabilities found in results"
else
  echo "⚠️  Scan completed but no vulnerability data found"
fi

echo ""

# 4. List all active jobs
echo "4. Checking active scan jobs..."
JOBS_RESPONSE=$(curl -s "$API_BASE_URL/scans/jobs")
ACTIVE_JOBS=$(echo "$JOBS_RESPONSE" | grep -o '"RUNNING"' | wc -l || echo "0")

echo "   Active jobs: $ACTIVE_JOBS"
echo ""

echo "🎉 API test completed successfully!"
echo "   You can view the full results at: $API_BASE_URL/scans/$REQUEST_ID"