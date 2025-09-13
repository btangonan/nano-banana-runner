# GUI Tests for Nano Banana Studio

## Overview

This directory contains end-to-end tests for the Nano Banana Studio GUI using Playwright.

## Test Structure

```
tests/
├── smoke/                    # Smoke tests for critical functionality
│   └── toast-regression.test.js   # Toast component crash prevention
└── README.md
```

## Quick Start

### Prerequisites

1. Both API server and GUI dev server should be running:
   ```bash
   # Terminal 1: API Server
   cd ../../../proxy
   pnpm dev  # Should run on http://127.0.0.1:8787
   
   # Terminal 2: GUI Server  
   cd . # (current directory)
   pnpm dev  # Should run on http://localhost:5174
   ```

2. Install Playwright dependencies:
   ```bash
   pnpm install
   npx playwright install  # Install browser binaries
   ```

### Running Tests

```bash
# Run all tests
pnpm test

# Run only smoke tests with line reporter
pnpm test:smoke

# Run tests with browser UI (headed mode)
pnpm test:headed

# Debug tests step by step
pnpm test:debug
```

## Test Categories

### Smoke Tests (`tests/smoke/`)

Critical regression protection tests that ensure core functionality doesn't break.

**Toast Regression Test** (`toast-regression.test.js`):
- Prevents regression of "Element type is invalid...got: undefined" errors
- Validates Toast component renders without React crashes during live submission
- Monitors console errors for lucide-react icon issues
- Ensures HMR warnings don't prevent component updates

**Why this test exists**: Previously, the Toast component crashed the entire GUI when trying to render undefined lucide-react icons during live job submission, causing a blank white screen.

## Playwright Configuration

Configuration is in `playwright.config.js`:
- Tests run against `http://localhost:5174` (GUI) and `http://127.0.0.1:8787` (API)
- Captures screenshots and video on test failures
- Supports Chrome, Firefox, and Safari testing
- Automatically starts dev servers if not already running

## Debugging Failed Tests

1. **Check console output**: Tests monitor browser console errors
2. **Review screenshots**: Saved to `test-results/` on failures
3. **Watch videos**: Video recordings help understand what went wrong
4. **Use debug mode**: `pnpm test:debug` allows step-by-step execution

## CI/CD Integration

Tests are designed to run in continuous integration:
- Retry failed tests up to 2 times on CI
- Run in parallel on local, sequential on CI
- Generate HTML reports for easy review

## Contributing

When adding new tests:
1. Follow the existing naming convention
2. Add comprehensive error monitoring for React crashes
3. Document the regression the test prevents
4. Include both positive and negative test cases
5. Update this README with new test descriptions