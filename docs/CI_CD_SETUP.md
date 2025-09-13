# CI/CD Setup Guide

## Quick Start

### 1. Enable GitHub Actions
GitHub Actions is already enabled by default for all repositories. The workflows will start running as soon as you push the `.github/workflows/` files.

### 2. Add Required Secrets (Optional)
If you want to enable nightly cassette recording:

1. Go to your GitHub repository
2. Click **Settings** → **Secrets and variables** → **Actions**
3. Click **New repository secret**
4. Add these secrets:
   - Name: `GEMINI_API_KEY`
   - Value: Your Gemini API key

### 3. Push the Workflow Files
```bash
git add .github/workflows/
git commit -m "ci: add GitHub Actions workflows"
git push origin main
```

### 4. Verify It's Working
1. Go to your GitHub repository
2. Click the **Actions** tab
3. You should see workflows running automatically

## What Each Workflow Does

### `test.yml` - Main CI/CD Pipeline
**Triggers**: Every push and pull request
**What it does**:
- Installs dependencies
- Builds the project
- Runs type checking
- Runs linting
- Runs unit tests
- Runs E2E tests in **replay mode** (no API calls, uses cassettes)
- Checks proxy service health
- Runs security audit

**Cost**: $0 (uses recorded cassettes)
**Runtime**: ~2-3 minutes

### `nightly.yml` - Cassette Refresh
**Triggers**: Every night at 2 AM UTC (or manual)
**What it does**:
- Records fresh cassettes with real API calls
- Commits updated cassettes automatically
- Creates issue if recording fails

**Cost**: Up to $5 per run (configurable)
**Runtime**: ~5-10 minutes

## Understanding the Status Badges

After setup, you can add status badges to your README:

```markdown
![Tests](https://github.com/bradleytangonan/gemini-image-analyzer/actions/workflows/test.yml/badge.svg)
![Nightly](https://github.com/bradleytangonan/gemini-image-analyzer/actions/workflows/nightly.yml/badge.svg)
```

- 🟢 **Green**: All tests passing
- 🔴 **Red**: Tests failing (blocks merging)
- 🟡 **Yellow**: Tests running

## Workflow Rules

### For Pull Requests
1. All tests must pass before merging
2. Uses replay mode (no API costs)
3. Runs automatically on every commit

### For Main Branch
1. Runs full test suite on every push
2. Nightly cassette refresh keeps tests current
3. Failed tests create GitHub issues

## Local Testing Before Push

Always test locally first:
```bash
# Run the same tests CI will run
cd apps/nn
pnpm test
pnpm test:e2e
pnpm lint
pnpm typecheck
```

## Monitoring CI/CD

### View Test Results
1. Go to **Actions** tab
2. Click on a workflow run
3. Click on a job to see detailed logs

### Download Artifacts
Test results and coverage reports are saved as artifacts:
1. Click on a completed workflow run
2. Scroll to **Artifacts** section
3. Download `test-results.zip`

## Cost Management

### Current Setup (Cost-Efficient)
- **Per PR**: $0 (replay mode)
- **Per push to main**: $0 (replay mode)
- **Nightly recording**: ~$0.10-0.50

### Monthly Estimate
- **100 PRs**: $0
- **200 pushes**: $0
- **30 nightly recordings**: ~$3-15
- **Total**: ~$3-15/month

## Troubleshooting

### Tests Pass Locally but Fail in CI
**Cause**: Missing cassettes or environment differences
**Fix**: 
```bash
# Record cassettes locally
E2E_MODE=record pnpm test:e2e
# Commit them
git add test/e2e/fixtures/recordings/
git commit -m "test: add missing cassettes"
git push
```

### "Cassette not found" Errors
**Cause**: New tests without recorded responses
**Fix**: Run nightly workflow manually to record cassettes

### Security Audit Failures
**Cause**: Vulnerable dependencies
**Fix**:
```bash
pnpm audit fix
# or
pnpm update [package-name]
```

## Advanced Configuration

### Adjust Budget Limits
Edit `.github/workflows/nightly.yml`:
```yaml
env:
  E2E_BUDGET_USD: 10.00  # Increase for more tests
```

### Add Deployment Step
Add to `.github/workflows/test.yml`:
```yaml
deploy:
  needs: [test, proxy-check]
  if: github.ref == 'refs/heads/main'
  runs-on: ubuntu-latest
  steps:
    - name: Deploy to production
      run: |
        echo "Deploy your app here"
```

### Branch Protection Rules
1. Go to **Settings** → **Branches**
2. Add rule for `main`
3. Check:
   - ✅ Require status checks to pass
   - ✅ Require branches to be up to date
   - ✅ Include `test` status check

## Benefits You Get

1. **Automatic Testing**: Never forget to run tests
2. **Consistent Environment**: Tests run in clean environment
3. **Cost Control**: Cassettes prevent API spending
4. **Team Safety**: Bad code can't reach main branch
5. **Documentation**: Test results archived for review
6. **Peace of Mind**: Know your code works before deploy

---

**Next Steps**:
1. Push the workflow files
2. Watch your first CI run in the Actions tab
3. Add status badges to your README
4. Enable branch protection rules