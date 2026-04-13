#!/bin/bash
# Update rdc-skills plugin to latest version
# Unix/macOS bash script

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"

echo "rdc-skills Updater"
echo "=================="
echo ""

# Get current version before pulling
OLD_VERSION="unknown"
if [ -f "$REPO_ROOT/package.json" ]; then
    OLD_VERSION=$(grep '"version"' "$REPO_ROOT/package.json" | head -1 | sed 's/.*"version": "\(.*\)".*/\1/')
fi

echo "Current version: $OLD_VERSION"

# Pull latest from git
echo "Pulling latest from git..."
cd "$REPO_ROOT"
git fetch origin
git pull origin main --ff-only || true

# Get new version after pulling
NEW_VERSION="unknown"
if [ -f "$REPO_ROOT/package.json" ]; then
    NEW_VERSION=$(grep '"version"' "$REPO_ROOT/package.json" | head -1 | sed 's/.*"version": "\(.*\)".*/\1/')
fi

echo "New version: $NEW_VERSION"

if [ "$OLD_VERSION" = "$NEW_VERSION" ]; then
    echo ""
    echo "Already up to date."
else
    echo ""
    echo "Reinstalling..."
    bash "$REPO_ROOT/scripts/install.sh"
fi
