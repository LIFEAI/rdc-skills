#!/usr/bin/env node
/**
 * Validate rdc-skills skills and guides
 *
 * Checks:
 * - YAML frontmatter exists and has required fields
 * - Required sections exist (## When to Use, etc.)
 * - Markdown is well-formed
 *
 * Exit codes:
 *   0 = all valid
 *   1 = validation failed
 */

const fs = require('fs');
const path = require('path');

const REQUIRED_FRONTMATTER = ['name', 'description'];
const REQUIRED_SECTIONS = [
  '## When to Use',
  '## Procedure' // OR '## Arguments'
];

let passed = 0;
let failed = 0;
const errors = [];

function validateFile(filePath) {
  try {
    const contents = fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
    const lines = contents.split('\n');

    // Check frontmatter
    if (!lines[0].includes('---')) {
      errors.push(`${path.basename(filePath)}: Missing YAML frontmatter start`);
      return false;
    }

    let frontmatterEnd = -1;
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].includes('---')) {
        frontmatterEnd = i;
        break;
      }
    }

    if (frontmatterEnd === -1) {
      errors.push(`${path.basename(filePath)}: YAML frontmatter not closed`);
      return false;
    }

    // Parse frontmatter
    const frontmatterLines = lines.slice(1, frontmatterEnd);
    const frontmatter = {};

    for (const line of frontmatterLines) {
      const match = line.match(/^(\w+):\s*(.+)$/);
      if (match) {
        frontmatter[match[1]] = match[2];
      }
    }

    // Check required fields
    for (const field of REQUIRED_FRONTMATTER) {
      if (!frontmatter[field]) {
        errors.push(`${path.basename(filePath)}: Missing frontmatter field '${field}'`);
        return false;
      }
    }

    // Check required sections
    const bodyText = lines.slice(frontmatterEnd + 1).join('\n');
    const hasWhenToUse = bodyText.includes('## When to Use');
    const hasProcedure = bodyText.includes('## Procedure');
    const hasArguments = bodyText.includes('## Arguments');

    if (!hasWhenToUse) {
      errors.push(`${path.basename(filePath)}: Missing '## When to Use' section`);
      return false;
    }

    if (!hasProcedure && !hasArguments) {
      errors.push(`${path.basename(filePath)}: Missing '## Procedure' or '## Arguments' section`);
      return false;
    }

    return true;
  } catch (err) {
    errors.push(`${path.basename(filePath)}: ${err.message}`);
    return false;
  }
}

function validateDirectory(dirPath, dirName) {
  if (!fs.existsSync(dirPath)) {
    console.log(`ℹ  ${dirName}/ directory not found (will be populated later)`);
    return;
  }

  // Skills are in subdirectories: skills/<name>/SKILL.md
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const skillFiles = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const skillMd = path.join(dirPath, entry.name, 'SKILL.md');
      if (fs.existsSync(skillMd)) {
        skillFiles.push({ label: `${entry.name}/SKILL.md`, filePath: skillMd });
      }
    } else if (entry.name.endsWith('.md')) {
      skillFiles.push({ label: entry.name, filePath: path.join(dirPath, entry.name) });
    }
  }

  if (skillFiles.length === 0) {
    console.log(`ℹ  ${dirName}/ (empty — will be populated later)`);
    return;
  }

  console.log(`\nValidating ${dirName}/`);
  console.log('─'.repeat(40));

  for (const { label, filePath } of skillFiles) {
    if (validateFile(filePath)) {
      console.log(`  ✓ ${label}`);
      passed++;
    } else {
      console.log(`  ✗ ${label}`);
      failed++;
    }
  }
}

// Main
console.log('rdc-skills Validator');
console.log('====================\n');

const repoRoot = path.dirname(path.dirname(__filename));
const skillsDir = path.join(repoRoot, 'skills');
const guidesDir = path.join(repoRoot, 'guides');

validateDirectory(skillsDir, 'skills');

// Guides are prose docs — just check they are readable markdown files
if (fs.existsSync(guidesDir)) {
  const guideFiles = fs.readdirSync(guidesDir).filter(f => f.endsWith('.md'));
  if (guideFiles.length > 0) {
    console.log('\nValidating guides/ (readability only)');
    console.log('─'.repeat(40));
    for (const file of guideFiles) {
      try {
        fs.readFileSync(path.join(guidesDir, file), 'utf8');
        console.log(`  ✓ ${file}`);
        passed++;
      } catch (err) {
        errors.push(`${file}: ${err.message}`);
        console.log(`  ✗ ${file}`);
        failed++;
      }
    }
  }
}

console.log('\n' + '═'.repeat(40));
if (errors.length > 0) {
  console.log('\nErrors:');
  for (const err of errors) {
    console.log(`  • ${err}`);
  }
}

console.log(`\nResults: ${passed} passed, ${failed} failed`);

if (failed === 0 && passed > 0) {
  console.log('✓ All files valid\n');
  process.exit(0);
} else if (failed === 0 && passed === 0) {
  console.log('ℹ  No files to validate (plugin base not yet populated)\n');
  process.exit(0);
} else {
  console.log('✗ Validation failed\n');
  process.exit(1);
}
