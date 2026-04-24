#!/bin/bash
# DEPRECATED as of v0.6.0 — use /plugin install rdc-skills.
# Will be removed in v0.7.0. See README.md "Install" section.
#
# Install rdc-skills plugin to Claude Code
# Unix/macOS bash script

set -u
# NOTE: intentionally NOT using `set -e` — it aborts the whole install on any
# single file glitch (stale lock, permission hiccup, cp retry). We want the
# loop to power through and report failures at the end, not die silently
# after the first file. Past bug: every install "only copied rdc-backend.md".

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

# Copy skills — bulk cp is atomic and much harder to kill than a per-file loop.
# Prior bug: per-file loop under `set -e` aborted after the first file on any
# cp glitch, leaving the install half-applied. Bulk cp runs once, reports once.
if [ -d "$REPO_ROOT/skills" ]; then
    SKILL_COUNT=0
    # Skills are in subdirectories: skills/<name>/SKILL.md → rdc-<name>.md
    for skill_dir in "$REPO_ROOT"/skills/*/; do
        name=$(basename "$skill_dir")
        src="$skill_dir/SKILL.md"
        dst="$SKILLS_DIR/rdc-${name}.md"
        if [ -f "$src" ]; then
            cp "$src" "$dst" 2>&1 || echo "  (cp warning — failed to copy $name)"
            SKILL_COUNT=$((SKILL_COUNT + 1))
            echo "  → rdc-${name}.md"
        fi
    done
    if [ "$SKILL_COUNT" -gt 0 ]; then
        echo "  ✓ Copied $SKILL_COUNT skill(s)"
        INSTALLED=$(ls -1 "$SKILLS_DIR"/rdc-*.md 2>/dev/null | wc -l)
        echo "  ✓ Verified: $INSTALLED rdc-*.md file(s) present in $SKILLS_DIR"
        if [ "$INSTALLED" -lt "$SKILL_COUNT" ]; then
            echo "  ⚠ WARNING: only $INSTALLED of $SKILL_COUNT installed — run install again or check permissions"
        fi
    else
        echo "  (no SKILL.md files found in skills/ subdirectories)"
    fi
fi
echo ""

# Create hooks directory
HOOKS_DIR="$CLAUDE_HOME/hooks"
mkdir -p "$HOOKS_DIR"
echo "✓ Hooks directory: $HOOKS_DIR"

# Copy hooks
HOOK_COUNT=0
if ls "$REPO_ROOT"/hooks/*.js >/dev/null 2>&1; then
    cp "$REPO_ROOT"/hooks/*.js "$HOOKS_DIR/" 2>&1 || echo "  (cp warning — some hooks may not have copied)"
    chmod +x "$HOOKS_DIR"/*.js 2>/dev/null || true
    HOOK_COUNT=$(ls -1 "$REPO_ROOT"/hooks/*.js 2>/dev/null | wc -l)
    for hook in "$REPO_ROOT"/hooks/*.js; do
        [ -f "$hook" ] && echo "  → $(basename "$hook")"
    done
fi
if [ "$HOOK_COUNT" -gt 0 ]; then
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
echo "2. Use rdc-skills/guides/*.md as starting point templates for your project overlays"
echo ""
echo "3. Run /rdc:status in Claude Code to verify setup"
echo ""
echo "For help: https://github.com/LIFEAI/rdc-skills#readme"
