#!/usr/bin/env python3
"""Smoke tests for session-notes reviewer - daily automated checks."""
# /// script
# dependencies = ["playwright"]
# ///

from playwright.sync_api import sync_playwright
import sys

PRODUCTION_URL = "https://mathsense.com/session-notes/"

def test_site_loads():
    """Test 1: Verify production site is accessible."""
    print("Test 1: Checking site accessibility...")
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        response = page.goto(PRODUCTION_URL, timeout=15000)
        browser.close()

        assert response.status == 200, f"Expected 200, got {response.status}"
        print("   ✓ Site loads (HTTP 200)")

def test_app_title():
    """Test 2: Verify application title is present."""
    print("Test 2: Checking application title...")
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.goto(PRODUCTION_URL, timeout=15000)
        content = page.content()
        browser.close()

        assert "Session Notes Reviewer" in content, "Application title not found"
        print("   ✓ Application title found")

def test_react_app():
    """Test 3: Verify React app loads."""
    print("Test 3: Checking React application...")
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.goto(PRODUCTION_URL, timeout=15000)
        content = page.content()
        browser.close()

        assert "app.jsx" in content or "SessionNotesReviewer" in content, \
            "React app not found"
        print("   ✓ React application loaded")

def test_file_input():
    """Test 4: Verify file upload input exists."""
    print("Test 4: Checking file upload input...")
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.goto(PRODUCTION_URL, timeout=15000)

        # Wait for React app to mount and render the file input
        try:
            page.wait_for_selector('#file-input', timeout=10000, state='attached')
            file_input = page.locator('#file-input')
            count = file_input.count()
            browser.close()

            assert count > 0, "File input not found"
            print("   ✓ File upload input exists")
        except Exception as e:
            browser.close()
            raise AssertionError(f"File input not found after waiting: {str(e)}")

if __name__ == "__main__":
    print("=" * 60)
    print("Session Notes Reviewer - Smoke Tests")
    print("=" * 60)

    tests = [test_site_loads, test_app_title, test_react_app, test_file_input]
    failed = []

    for test in tests:
        try:
            test()
        except Exception as e:
            print(f"   ✗ FAILED: {e}")
            failed.append(test.__name__)

    print("\n" + "=" * 60)
    if failed:
        print(f"✗ {len(failed)}/{len(tests)} tests FAILED")
        print(f"Failed tests: {', '.join(failed)}")
        sys.exit(1)
    else:
        print(f"✓ All {len(tests)} tests PASSED")
        sys.exit(0)
