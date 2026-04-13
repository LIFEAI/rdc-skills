#!/bin/bash
# Install rdc-skills plugin to Claude Code
# Unix/macOS bash script

set -e

CLAUDE_HOME="${CLAUDE_HOME:-$HOME/.claude}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"

echo "rdc-skills Installer"
echo "==================="
echo ""

# Check CLAUDE_HOME exists
if [ ! -d "$CLAUDE_HOME" ]; then
    echo "ERROR: CLAUDE_HOME does not exist: $CLAUDE_HOME"
    echo "       Create it first: mkdir -p \"$CLAUDE_HOME\""
    exit 1
fi

echo "CLAUDE_HOME: $CLAUDE_HOME"
echo ""

# Create skills directory
SKILLS_DIR="$CLAUDE_HOME/skills/user"
mkdir -p "$SKILLS_DIR"
echo "✓ Skills directory: $SKILLS_DIR"

# Copy skills
if [ -d "$REPO_ROOT/skills" ]; then
    SKILL_COUNT=0
    for skill in "$REPO_ROOT"/skills/*.md; do
        if [ -f "$skill" ]; then
            cp "$skill" "$SKILLS_DIR/"
            echo "  → $(basename "$skill")"
            ((SKILL_COUNT++))
        fi
    done
    if [ $SKILL_COUNT -gt 0 ]; then
        echo "  ✓ Copied $SKILL_COUNT skill(s)"
    else
        echo "  (no skills yet — guides to be added by WP2 agent)"
    fi
fi
echo ""

# Create hooks directory
HOOKS_DIR="$CLAUDE_HOME/hooks"
mkdir -p "$HOOKS_DIR"
echo "✓ Hooks directory: $HOOKS_DIR"

# Copy hooks
HOOK_COUNT=0
for hook in "$REPO_ROOT"/hooks/*.js; do
    if [ -f "$hook" ]; then
        cp "$hook" "$HOOKS_DIR/"
        chmod +x "$HOOKS_DIR/$(basename "$hook")"
        echo "  → $(basename "$hook")"
        ((HOOK_COUNT++))
    fi
done
if [ $HOOK_COUNT -gt 0 ]; then
    echo "  ✓ Copied $HOOK_COUNT hook(s)"
fi
echo ""

echo "Installation Complete"
echo "====================="
echo ""
echo "Next steps:"
echo "1. Create project-specific guides in your codebase:"
echo "   - docs/guides/agent-bootstrap.md (required — credentials, git rules)"
echo "   - docs/guides/frontend.md (if building UI)"
echo "   - docs/guides/backend.md (if building APIs)"
echo "   - docs/guides/data.md (if doing DB work)"
echo ""
echo "2. Copy the template from rdc-skills/docs/templates/ as a starting point"
echo ""
echo "3. Run /rdc:status in Claude Code to verify setup"
echo ""
echo "For help: https://github.com/LIFEAI/rdc-skills#readme"
