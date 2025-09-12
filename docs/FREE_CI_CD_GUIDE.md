# 🆓 Free CI/CD Setup Guide

## Zero-Cost Testing Strategy

This guide shows you how to run CI/CD completely **FREE** - no monthly costs, no API charges.

## How It Works

### The Cassette Strategy
1. **Record once**: Create cassettes with API responses (one-time cost: ~$0.04)
2. **Replay forever**: All tests use recorded cassettes ($0)
3. **Manual refresh only**: Update cassettes only when needed

### Cost Breakdown
- **Every PR test**: $0 (uses cassettes)
- **Every push**: $0 (uses cassettes)
- **Daily testing**: $0 (uses cassettes)
- **Monthly cost**: **$0**
- **Yearly cost**: **$0**

## Initial Setup (One-Time)

### Step 1: Record Your Cassettes Locally
```bash
# One-time recording (costs ~$0.04)
cd apps/nn
E2E_MODE=record pnpm test:e2e

# Verify cassettes were created
ls test/e2e/fixtures/recordings/
# Should see: multiple .json files
```

### Step 2: Commit Cassettes
```bash
# Add cassettes to git
git add test/e2e/fixtures/recordings/
git commit -m "test: add E2E test cassettes"
git push origin main
```

### Step 3: Push CI/CD Workflows
```bash
# Add workflows
git add .github/workflows/
git commit -m "ci: add free CI/CD workflows"
git push origin main
```

## That's It! You're Done! 🎉

From now on:
- ✅ Every push runs tests for FREE
- ✅ Every PR runs tests for FREE
- ✅ No recurring costs
- ✅ No API keys needed in CI

## When to Update Cassettes

You only need new cassettes when:

### 1. API Changes
If Gemini API response format changes:
```bash
# Record new cassettes locally
E2E_MODE=record pnpm test:e2e
git add test/e2e/fixtures/recordings/
git commit -m "test: update cassettes for API changes"
git push
```

### 2. Adding New Tests
When you add new E2E tests:
```bash
# Record just the new test
E2E_MODE=record pnpm test:e2e -t "your new test name"
git add test/e2e/fixtures/recordings/
git commit -m "test: add cassettes for new test"
git push
```

### 3. Manual Refresh (Optional)
If you want fresh cassettes:
1. Go to GitHub Actions
2. Run "Manual Cassette Refresh" workflow
3. Set budget (e.g., $0.10)
4. Click "Run workflow"

## Monitoring Your Costs

### Verify Zero Spending
```bash
# Check your test mode
cat .github/workflows/test.yml | grep E2E_MODE
# Should show: E2E_MODE: replay

# Local testing also free
E2E_MODE=replay pnpm test:e2e  # $0
E2E_MODE=mock pnpm test:e2e     # $0
```

### Track Any Recording Costs
When you DO record (rarely):
```bash
# Check cost report after recording
cat test/e2e/.artifacts/cost.json
# Shows exact spending (usually $0.04)
```

## FAQ

### Q: What if tests fail with "Cassette not found"?
**A**: You added a new test. Record its cassette:
```bash
E2E_MODE=record pnpm test:e2e -t "test name"
git add test/e2e/fixtures/recordings/
git commit && git push
```

### Q: How often should I refresh cassettes?
**A**: Only when:
- Gemini API changes (they'll announce this)
- You add new tests
- You change test request parameters

### Q: Can I delete the manual refresh workflow?
**A**: Yes! If you prefer local recording only:
```bash
rm .github/workflows/manual-cassette-refresh.yml
```

### Q: What if I accidentally trigger API calls?
**A**: The budget limit ($0.50 default) prevents overspending. But with replay mode, it's impossible to trigger API calls.

## Cost Comparison

### Traditional CI/CD (No Cassettes)
```
100 PRs × 17 tests × $0.0025 = $4.25/month
200 pushes × 17 tests × $0.0025 = $8.50/month
Total: ~$12.75/month = $153/year
```

### Your Free Setup
```
100 PRs × 17 tests × $0 = $0/month
200 pushes × 17 tests × $0 = $0/month
Total: $0/month = $0/year
```

**Savings: $153/year** 🎉

## Advanced: Emergency API Testing

If you MUST test with live API (very rare):
```bash
# Local only - not in CI
E2E_MODE=live E2E_BUDGET_USD=0.10 pnpm test:e2e

# This costs real money! Use sparingly
```

## Security Note

Since you're using replay mode:
- ✅ No API keys needed in GitHub secrets
- ✅ No risk of key leakage
- ✅ Tests work without internet
- ✅ Completely secure

## Summary

1. **One-time setup**: Record cassettes locally (~$0.04)
2. **Push to GitHub**: Cassettes + workflows
3. **Run forever free**: All tests use replay mode
4. **Update rarely**: Only when API changes or adding tests

You now have enterprise-grade CI/CD testing at **zero monthly cost**! 🚀

---

**Remember**: The cassettes are your gold. As long as you have them, your tests run free forever!