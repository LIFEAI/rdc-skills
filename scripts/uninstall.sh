#!/bin/bash
# Uninstall rdc-skills plugin from Claude Code
# Unix/macOS bash script

set -e

CLAUDE_HOME="${CLAUDE_HOME:-$HOME/.claude}"

echo "rdc-skills Uninstaller"
echo "======================"
echo ""

# Check CLAUDE_HOME exists
if [ ! -d "$CLAUDE_HOME" ]; then
    echo "CLAUDE_HOME does not exist: $CLAUDE_HOME"
    exit 0
fi

echo "CLAUDE_HOME: $CLAUDE_HOME"
echo ""

# Find files to remove
SKILLS_DIR="$CLAUDE_HOME/skills/user"
HOOKS_DIR="$CLAUDE_HOME/hooks"

TO_DELETE=()

if [ -d "$SKILLS_DIR" ]; then
    while IFS= read -r -d '' file; do
        TO_DELETE+=("$file")
    done < <(find "$SKILLS_DIR" -maxdepth 1 -name "rdc*.md" -print0 2>/dev/null)
fi

if [ -d "$HOOKS_DIR" ]; then
    while IFS= read -r -d '' file; do
        TO_DELETE+=("$file")
    done < <(find "$HOOKS_DIR" -maxdepth 1 -name "*open-epics*" -print0 2>/dev/null)
fi

if [ ${#TO_DELETE[@]} -eq 0 ]; then
    echo "No rdc-skills files found to remove."
    exit 0
fi

echo "Will remove the following files:"
for file in "${TO_DELETE[@]}"; do
    echo "  - $(basename "$file")"
done
echo ""

# Confirm
read -p "Continue? (y/N) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Cancelled."
    exit 0
fi

# Remove files
for file in "${TO_DELETE[@]}"; do
    rm -f "$file"
    echo "✓ Removed: $(basename "$file")"
done

echo ""
echo "Uninstall Complete"
echo ""
echo "Remaining guides and project overlays in docs/guides/ were NOT removed."
echo "Delete them manually if desired."
