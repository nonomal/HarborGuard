#!/bin/bash

# HarborGuard Scan Upload Script
# 
# Usage: ./upload-scan.sh <requestId> <reportsDir>
# 
# Environment variables:
#   IMAGE_NAME      - Image name (default: nginx)
#   IMAGE_TAG       - Image tag (default: latest)  
#   IMAGE_REGISTRY  - Registry URL (optional)
#   API_BASE_URL    - API base URL (default: http://localhost:3000/api)
#   TRIVY_VERSION   - Trivy version (optional)
#   GRYPE_VERSION   - Grype version (optional)
#   SYFT_VERSION    - Syft version (optional)
#   DOCKLE_VERSION  - Dockle version (optional)

set -e

REQUEST_ID="$1"
REPORTS_DIR="$2"
API_BASE_URL="${API_BASE_URL:-http://localhost:3000/api}"
IMAGE_NAME="${IMAGE_NAME:-nginx}"
IMAGE_TAG="${IMAGE_TAG:-latest}"

if [[ -z "$REQUEST_ID" || -z "$REPORTS_DIR" ]]; then
    echo "Usage: $0 <requestId> <reportsDir>"
    echo ""
    echo "Example: $0 \"20250813-145041-8b11d0de\" \"/reports\""
    exit 1
fi

if [[ ! -d "$REPORTS_DIR" ]]; then
    echo "Error: Reports directory '$REPORTS_DIR' does not exist"
    exit 1
fi

echo "Uploading scan data for request: $REQUEST_ID"
echo "Reading reports from: $REPORTS_DIR"

# Check for required files
METADATA_FILE="$REPORTS_DIR/metadata.json"
if [[ ! -f "$METADATA_FILE" ]]; then
    echo "Error: metadata.json is required but not found in $REPORTS_DIR"
    exit 1
fi

# Extract digest from metadata
DIGEST=$(jq -r '.Digest' "$METADATA_FILE" 2>/dev/null || echo "")
if [[ -z "$DIGEST" ]]; then
    echo "Error: Could not extract digest from metadata.json"
    exit 1
fi

# Extract OS and Architecture
OS=$(jq -r '.Os // "linux"' "$METADATA_FILE" 2>/dev/null)
ARCH=$(jq -r '.Architecture // "amd64"' "$METADATA_FILE" 2>/dev/null)
PLATFORM="$OS/$ARCH"

# Get current timestamp
START_TIME=$(date -d '5 minutes ago' -Iseconds 2>/dev/null || date -u -v-5M '+%Y-%m-%dT%H:%M:%S.000Z' 2>/dev/null || echo "$(date -u -d '5 minutes ago' '+%Y-%m-%dT%H:%M:%S.000Z')")
FINISH_TIME=$(date -Iseconds 2>/dev/null || date -u '+%Y-%m-%dT%H:%M:%S.000Z')

# Create temporary JSON file
TEMP_JSON=$(mktemp)
trap "rm -f $TEMP_JSON" EXIT

# Build JSON payload
cat > "$TEMP_JSON" << EOF
{
  "requestId": "$REQUEST_ID",
  "image": {
    "name": "$IMAGE_NAME",
    "tag": "$IMAGE_TAG",
    "digest": "$DIGEST",
    "platform": "$PLATFORM"
EOF

# Add registry if set
if [[ -n "$IMAGE_REGISTRY" ]]; then
    sed -i '$ s/$/,/' "$TEMP_JSON"
    echo "    \"registry\": \"$IMAGE_REGISTRY\"" >> "$TEMP_JSON"
fi

cat >> "$TEMP_JSON" << EOF
  },
  "scan": {
    "startedAt": "$START_TIME",
    "finishedAt": "$FINISH_TIME",
    "status": "SUCCESS",
    "reportsDir": "$REPORTS_DIR",
    "scannerVersions": {
EOF

# Add scanner versions if available
VERSIONS=()
[[ -n "$TRIVY_VERSION" ]] && VERSIONS+=("\"trivy\": \"$TRIVY_VERSION\"")
[[ -n "$GRYPE_VERSION" ]] && VERSIONS+=("\"grype\": \"$GRYPE_VERSION\"")
[[ -n "$SYFT_VERSION" ]] && VERSIONS+=("\"syft\": \"$SYFT_VERSION\"")
[[ -n "$DOCKLE_VERSION" ]] && VERSIONS+=("\"dockle\": \"$DOCKLE_VERSION\"")

if [[ ${#VERSIONS[@]} -gt 0 ]]; then
    printf "      %s\n" "${VERSIONS[@]}" | paste -sd, >> "$TEMP_JSON"
else
    echo "      \"unknown\": \"unknown\"" >> "$TEMP_JSON"
fi

cat >> "$TEMP_JSON" << EOF
    }
  },
  "reports": {
EOF

# Add report files if they exist
REPORTS=()
for scanner in trivy grype syft dockle metadata; do
    REPORT_FILE="$REPORTS_DIR/$scanner.json"
    if [[ -f "$REPORT_FILE" ]]; then
        echo "  Found: $scanner.json"
        REPORT_CONTENT=$(cat "$REPORT_FILE")
        REPORTS+=("\"$scanner\": $REPORT_CONTENT")
    fi
done

if [[ ${#REPORTS[@]} -eq 0 ]]; then
    echo "Error: No valid report files found"
    exit 1
fi

printf "    %s\n" "${REPORTS[@]}" | paste -sd, >> "$TEMP_JSON"

echo "  }" >> "$TEMP_JSON"
echo "}" >> "$TEMP_JSON"

# Upload to API
echo ""
echo "Uploading to API..."

RESPONSE=$(curl -s -w "HTTPSTATUS:%{http_code}" \
    -X POST \
    -H "Content-Type: application/json" \
    -H "User-Agent: HarborGuard-Scanner/1.0" \
    -d @"$TEMP_JSON" \
    "$API_BASE_URL/scans/upload")

HTTP_CODE=$(echo "$RESPONSE" | tr -d '\n' | sed -e 's/.*HTTPSTATUS://')
BODY=$(echo "$RESPONSE" | sed -e 's/HTTPSTATUS:.*//g')

if [[ "$HTTP_CODE" -eq 201 ]]; then
    echo "✅ Scan uploaded successfully!"
    SCAN_ID=$(echo "$BODY" | jq -r '.scanId // "unknown"')
    IMAGE_ID=$(echo "$BODY" | jq -r '.imageId // "unknown"')
    echo "   Scan ID: $SCAN_ID"
    echo "   Image ID: $IMAGE_ID" 
    echo "   Request ID: $REQUEST_ID"
else
    echo "❌ Upload failed (HTTP $HTTP_CODE)"
    echo "Response: $BODY"
    exit 1
fi