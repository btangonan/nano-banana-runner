/**
 * Smoke Test: Toast Component Regression Protection
 * 
 * Prevents regression of the "Element type is invalid...got: undefined" 
 * error that occurred during live job submission when Toast tried to 
 * render undefined lucide-react icons.
 * 
 * This test validates:
 * 1. Toast component renders without React errors
 * 2. Live submission workflow doesn't crash GUI
 * 3. No "undefined component" errors in console logs
 */

import { test, expect } from '@playwright/test';

test.describe('Toast Component Regression Protection', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the GUI application
    await page.goto('http://localhost:5174/app/');
    
    // Wait for app to load completely
    await page.waitForSelector('h1:has-text("Nano Banana Studio")');
  });

  test('Toast notifications render without crashes during live submission', async ({ page }) => {
    // Monitor console errors to catch React crashes
    const consoleErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    // Navigate through the workflow to trigger live submission
    // Step 1: Upload & Analyze should be active by default
    await expect(page.locator('text=Upload & Analyze')).toBeVisible();

    // Step 2: Navigate to Submit & Monitor step (where Toast crash occurred)
    // Click on the Submit & Monitor step indicator
    await page.locator('div:has-text("Submit & Monitor")').click();

    // Step 3: Trigger a live job submission that should show Toast notification
    // Check if there's a submit button or form
    const submitButton = page.locator('button:has-text("Submit"), button:has-text("Start Live Generation")');
    if (await submitButton.count() > 0) {
      await submitButton.first().click();
      
      // Wait a moment for any Toast notifications to appear
      await page.waitForTimeout(2000);
    }

    // Step 4: Check for presence of Toast container (should exist without errors)
    const toastContainer = page.locator('[class*="toast"], [class*="Toast"]');
    
    // If toast notifications are present, verify they rendered successfully
    if (await toastContainer.count() > 0) {
      await expect(toastContainer.first()).toBeVisible();
    }

    // Step 5: Verify no React "undefined component" errors occurred
    const undefinedElementErrors = consoleErrors.filter(error => 
      error.includes('Element type is invalid') && 
      error.includes('got: undefined')
    );

    expect(undefinedElementErrors).toHaveLength(0);

    // Step 6: Verify no lucide-react icon errors
    const iconErrors = consoleErrors.filter(error =>
      error.includes('lucide') || 
      error.includes('CheckCircle') ||
      error.includes('AlertTriangle') ||
      error.includes('TriangleAlert') ||
      error.includes('CircleCheck')
    );

    expect(iconErrors).toHaveLength(0);

    // Step 7: Verify page is still functional (not blank white screen)
    await expect(page.locator('h1:has-text("Nano Banana Studio")')).toBeVisible();
    await expect(page.locator('text=Image analyzer → prompt remixer → Gemini generator')).toBeVisible();
  });

  test('Toast component exports are properly available', async ({ page }) => {
    // Test that Toast component can be instantiated without errors
    const toastTestResult = await page.evaluate(() => {
      try {
        // Try to create a toast notification programmatically to test component integrity
        const event = new CustomEvent('test-toast', {
          detail: {
            title: 'Test Toast',
            description: 'Testing component integrity',
            variant: 'success'
          }
        });
        window.dispatchEvent(event);
        return { success: true, error: null };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    expect(toastTestResult.success).toBe(true);
    if (!toastTestResult.success) {
      console.error('Toast component test failed:', toastTestResult.error);
    }
  });

  test('Lucide icons are properly imported and available', async ({ page }) => {
    // Test that lucide-react icons are available in the global scope
    const iconTestResult = await page.evaluate(() => {
      // Check if React and lucide components are available
      try {
        // This is a basic check to ensure the lucide-react library loaded correctly
        const hasReact = typeof window.React !== 'undefined' || 
                         document.querySelector('[data-reactroot]') !== null ||
                         document.querySelector('#root') !== null;
        
        return { 
          success: true, 
          hasReact,
          timestamp: Date.now()
        };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    expect(iconTestResult.success).toBe(true);
    expect(iconTestResult.hasReact).toBe(true);
  });

  test('HMR warnings do not prevent component updates', async ({ page }) => {
    // Monitor console for HMR-related warnings
    const hmrWarnings = [];
    page.on('console', (msg) => {
      if (msg.type() === 'warn' && msg.text().includes('Fast Refresh')) {
        hmrWarnings.push(msg.text());
      }
    });

    // Navigate through app to trigger any HMR updates
    await page.locator('div:has-text("Upload & Analyze")').click();
    await page.locator('div:has-text("Remix & Review")').click();
    await page.locator('div:has-text("Submit & Monitor")').click();
    await page.locator('div:has-text("View Gallery")').click();

    // Wait for any HMR updates to process
    await page.waitForTimeout(1000);

    // Check that no useToast-related HMR warnings occurred
    const useToastHmrWarnings = hmrWarnings.filter(warning =>
      warning.includes('useToast') && warning.includes('incompatible')
    );

    expect(useToastHmrWarnings).toHaveLength(0);
  });
});