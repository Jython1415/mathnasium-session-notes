#!/bin/bash
# Session Notes Repository Sanitization Verification Script
# Run this before making the repository public to ensure all sensitive data is removed

echo "========================================"
echo "Session Notes Sanitization Verification"
echo "========================================"
echo ""

FAILED=0

echo "=== Checking for Sensitive Patterns in Git History ==="
echo ""

# Check for sensitive server username
echo -n "Checking for 'c5495zvy' in git history... "
if git log --all -p -S "c5495zvy" | grep -q "c5495zvy"; then
    echo "❌ FAILED"
    echo "  Found 'c5495zvy' in git history"
    FAILED=1
else
    echo "✓ PASS"
fi

# Check for server paths
echo -n "Checking for '/home3/' paths in git history... "
if git log --all -p -S "/home3/" | grep -q "/home3/"; then
    echo "❌ FAILED"
    echo "  Found '/home3/' paths in git history"
    FAILED=1
else
    echo "✓ PASS"
fi

# Check for server hostname
echo -n "Checking for 'mathsense.com' in git history... "
if git log --all -p -S "mathsense.com" | grep -q "mathsense.com"; then
    echo "❌ FAILED"
    echo "  Found 'mathsense.com' in git history"
    FAILED=1
else
    echo "✓ PASS"
fi

# Check for old student names (sample a few)
echo -n "Checking for old student name 'Emma Chen' in git history... "
if git log --all -p -S "Emma Chen" | grep -q "Emma Chen"; then
    echo "❌ FAILED"
    echo "  Found 'Emma Chen' in git history"
    FAILED=1
else
    echo "✓ PASS"
fi

echo -n "Checking for old student name 'Michael Torres' in git history... "
if git log --all -p -S "Michael Torres" | grep -q "Michael Torres"; then
    echo "❌ FAILED"
    echo "  Found 'Michael Torres' in git history"
    FAILED=1
else
    echo "✓ PASS"
fi

echo ""
echo "=== Checking for New Sanitized Content ==="
echo ""

# Check for new student names
echo -n "Checking for new student name 'Luna Martinez'... "
if git log --all -p -S "Luna Martinez" | grep -q "Luna Martinez"; then
    echo "✓ PASS (expected)"
else
    echo "⚠️  WARNING: 'Luna Martinez' not found"
fi

echo -n "Checking for new student name 'Atlas Johnson'... "
if git log --all -p -S "Atlas Johnson" | grep -q "Atlas Johnson"; then
    echo "✓ PASS (expected)"
else
    echo "⚠️  WARNING: 'Atlas Johnson' not found"
fi

# Check for environment variable usage
echo -n "Checking for 'getenv' usage (environment variables)... "
if git log --all -p -S "getenv" | grep -q "getenv"; then
    echo "✓ PASS (expected)"
else
    echo "⚠️  WARNING: 'getenv' not found"
fi

echo ""
echo "=== Checking for Removed Files ==="
echo ""

# Check CLAUDE.md removed from history
echo -n "Checking if CLAUDE.md removed from git history... "
if git log --all --name-only | grep -q "CLAUDE.md"; then
    echo "❌ FAILED"
    echo "  CLAUDE.md still exists in git history"
    FAILED=1
else
    echo "✓ PASS"
fi

echo ""
echo "=== Checking Required Files Exist ==="
echo ""

# Check for required new files
if [ -f ".env.example" ]; then
    echo "✓ PASS: .env.example exists"
else
    echo "❌ FAILED: .env.example missing"
    FAILED=1
fi

if [ -f "README.md" ]; then
    echo "✓ PASS: README.md exists"
else
    echo "❌ FAILED: README.md missing"
    FAILED=1
fi

if [ -f ".claude/CLAUDE.md" ]; then
    echo "✓ PASS: .claude/CLAUDE.md exists (private docs)"
else
    echo "⚠️  WARNING: .claude/CLAUDE.md missing"
fi

if [ -f ".gitignore" ]; then
    echo "✓ PASS: .gitignore exists"

    # Check .gitignore includes required entries
    if grep -q ".env" .gitignore; then
        echo "  ✓ .env is gitignored"
    else
        echo "  ❌ .env not in .gitignore"
        FAILED=1
    fi

    if grep -q "config/\*\.txt" .gitignore; then
        echo "  ✓ config/*.txt is gitignored"
    else
        echo "  ❌ config/*.txt not in .gitignore"
        FAILED=1
    fi

    if grep -q "CLAUDE.md" .gitignore; then
        echo "  ✓ CLAUDE.md is gitignored"
    else
        echo "  ❌ CLAUDE.md not in .gitignore"
        FAILED=1
    fi
else
    echo "❌ FAILED: .gitignore missing"
    FAILED=1
fi

# Check directories exist
if [ -d "config" ]; then
    echo "✓ PASS: config/ directory exists"
else
    echo "⚠️  WARNING: config/ directory missing"
fi

if [ -d "data" ]; then
    echo "✓ PASS: data/ directory exists"
else
    echo "⚠️  WARNING: data/ directory missing"
fi

echo ""
echo "=== Checking Current Working Files ==="
echo ""

# Check api/index.php uses environment variables
if grep -q "getenv('CLAUDE_API_KEY_PATH')" api/index.php; then
    echo "✓ PASS: api/index.php uses environment variables"
else
    echo "❌ FAILED: api/index.php doesn't use environment variables"
    FAILED=1
fi

# Check api/feedback.php uses environment variables
if grep -q "getenv('FEEDBACK_DB_PATH')" api/feedback.php; then
    echo "✓ PASS: api/feedback.php uses environment variables"
else
    echo "❌ FAILED: api/feedback.php doesn't use environment variables"
    FAILED=1
fi

# Check for no hardcoded paths in current files
if grep -q "/home3/c5495zvy" api/index.php api/feedback.php 2>/dev/null; then
    echo "❌ FAILED: Found hardcoded server paths in current files"
    FAILED=1
else
    echo "✓ PASS: No hardcoded server paths in current files"
fi

echo ""
echo "========================================"
if [ $FAILED -eq 0 ]; then
    echo "✅ ALL CHECKS PASSED"
    echo "Repository is safe to make public"
    echo "========================================"
    exit 0
else
    echo "❌ VERIFICATION FAILED"
    echo "DO NOT make repository public yet"
    echo "Fix the issues above and run again"
    echo "========================================"
    exit 1
fi
