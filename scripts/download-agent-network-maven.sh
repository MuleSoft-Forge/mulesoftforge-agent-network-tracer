#!/usr/bin/env bash
# Download the published agent-network zip from the Exchange Maven facade.
#
# Needs a normal Anypoint OAuth bearer (user token or whatever your org allows for Maven).
#
# Usage (groupId usually equals organizationId for Exchange):
#   export ACCESS_TOKEN='eyJ...'
#   ./scripts/download-agent-network-maven.sh <organizationId> <assetId> <version> [maven_base]
#   ./scripts/download-agent-network-maven.sh <organizationId> <groupId> <assetId> <version> [maven_base]
#
# maven_base defaults to US. Examples:
#   https://maven.anypoint.mulesoft.com
#   https://maven.eu1.anypoint.mulesoft.com
#   https://maven.ca1.platform.mulesoft.com
#   https://maven.jp1.platform.mulesoft.com
#
set -euo pipefail

if [[ -z "${ACCESS_TOKEN:-}" ]]; then
  echo "Set ACCESS_TOKEN to an Anypoint Bearer token." >&2
  exit 1
fi

MAVEN_DEFAULT="https://maven.anypoint.mulesoft.com"

if [[ $# -eq 3 ]]; then
  ORG_ID="$1"
  _GROUP="$1"
  ASSET_ID="$2"
  VERSION="$3"
  MAVEN_BASE="$MAVEN_DEFAULT"
elif [[ $# -eq 4 ]]; then
  if [[ "$4" == http* ]]; then
    ORG_ID="$1"
    _GROUP="$1"
    ASSET_ID="$2"
    VERSION="$3"
    MAVEN_BASE="$4"
  else
    ORG_ID="$1"
    _GROUP="$2"
    ASSET_ID="$3"
    VERSION="$4"
    MAVEN_BASE="$MAVEN_DEFAULT"
  fi
elif [[ $# -eq 5 ]]; then
  ORG_ID="$1"
  _GROUP="$2"
  ASSET_ID="$3"
  VERSION="$4"
  MAVEN_BASE="$5"
else
  echo "Usage: $0 <organizationId> <assetId> <version> [maven_base]" >&2
  echo "   or: $0 <organizationId> <groupId> <assetId> <version> [maven_base]" >&2
  exit 1
fi

ZIP_NAME="${ASSET_ID}-${VERSION}-agent-network.zip"
URL="${MAVEN_BASE%/}/api/v1/organizations/${ORG_ID%%/}/maven/${_GROUP%%/}/${ASSET_ID}/${VERSION}/${ZIP_NAME}"

echo "GET $URL" >&2
curl -sS -f -o "${ZIP_NAME}" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  "${URL}"
echo "Wrote $(pwd)/${ZIP_NAME}" >&2
