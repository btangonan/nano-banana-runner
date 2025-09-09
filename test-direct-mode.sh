#!/bin/bash

# Test script for Direct Mode feature
# Run from project root

echo "================================"
echo "Direct Mode Backend Test Suite"
echo "================================"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test counter
TESTS_PASSED=0
TESTS_FAILED=0

# Function to run a test
run_test() {
    local test_name="$1"
    local curl_cmd="$2"
    local expected_code="$3"
    local should_contain="$4"
    
    echo -n "Testing: $test_name... "
    
    # Run the curl command
    response=$(eval "$curl_cmd" 2>/dev/null)
    http_code=$(echo "$response" | tail -n1)
    body=$(echo "$response" | head -n-1)
    
    if [ "$http_code" = "$expected_code" ]; then
        if [ -z "$should_contain" ] || echo "$body" | grep -q "$should_contain"; then
            echo -e "${GREEN}✓ PASSED${NC}"
            ((TESTS_PASSED++))
        else
            echo -e "${RED}✗ FAILED${NC} - Response doesn't contain expected text"
            echo "  Expected to contain: $should_contain"
            echo "  Got: $body"
            ((TESTS_FAILED++))
        fi
    else
        echo -e "${RED}✗ FAILED${NC} - Expected HTTP $expected_code, got $http_code"
        echo "  Response: $body"
        ((TESTS_FAILED++))
    fi
}

echo "1. Testing with Direct Mode DISABLED (default)"
echo "-----------------------------------------------"

# Test 1: Normal operation with feature flag OFF
run_test "Regular submission (feature OFF)" \
    'curl -s -w "\n%{http_code}" -X POST http://127.0.0.1:8787/batch/submit \
    -H "Content-Type: application/json" \
    -d "{
        \"rows\": [{\"prompt\": \"Test prompt\", \"tags\": [\"test\"], \"seed\": 42}],
        \"variants\": 1,
        \"styleOnly\": true,
        \"styleRefs\": []
    }"' \
    "200" \
    "jobId"

echo ""
echo "2. Testing with Direct Mode ENABLED"
echo "------------------------------------"
echo "Note: To enable Direct Mode, set NN_ENABLE_DIRECT_MODE=true in .env and restart proxy"
echo ""

# Check if Direct Mode is enabled
if [ "$NN_ENABLE_DIRECT_MODE" = "true" ]; then
    echo -e "${GREEN}Direct Mode is ENABLED${NC}"
    
    # Test 2: Valid Direct Mode submission
    run_test "Valid Direct Mode submission" \
        'curl -s -w "\n%{http_code}" -X POST http://127.0.0.1:8787/batch/submit \
        -H "Content-Type: application/json" \
        -d "{
            \"rows\": [{\"prompt\": \"A beautiful sunset\", \"tags\": [\"sunset\"], \"seed\": 123}],
            \"variants\": 1,
            \"styleOnly\": true,
            \"styleRefs\": []
        }"' \
        "200" \
        "jobId"
    
    # Test 3: Too many rows (should fail)
    run_test "Too many rows (>200)" \
        'curl -s -w "\n%{http_code}" -X POST http://127.0.0.1:8787/batch/submit \
        -H "Content-Type: application/json" \
        -d "{
            \"rows\": [$(for i in {1..201}; do echo "{\"prompt\": \"Test $i\", \"tags\": [], \"seed\": $i},"; done | sed '\''s/,$//'\'' | tail -n1)],
            \"variants\": 1,
            \"styleOnly\": true,
            \"styleRefs\": []
        }"' \
        "413" \
        "Too many rows"
    
    # Test 4: Prompt too long (>4000 chars)
    LONG_PROMPT=$(printf 'x%.0s' {1..4001})
    run_test "Prompt too long (>4000 chars)" \
        "curl -s -w \"\n%{http_code}\" -X POST http://127.0.0.1:8787/batch/submit \
        -H \"Content-Type: application/json\" \
        -d '{
            \"rows\": [{\"prompt\": \"$LONG_PROMPT\", \"tags\": [], \"seed\": 1}],
            \"variants\": 1,
            \"styleOnly\": true,
            \"styleRefs\": []
        }'" \
        "400" \
        "Prompt too long"
    
    # Test 5: Too many tags (>16)
    MANY_TAGS=$(for i in {1..17}; do echo -n "\"tag$i\","; done | sed 's/,$//')
    run_test "Too many tags (>16)" \
        "curl -s -w \"\n%{http_code}\" -X POST http://127.0.0.1:8787/batch/submit \
        -H \"Content-Type: application/json\" \
        -d '{
            \"rows\": [{\"prompt\": \"Test\", \"tags\": [$MANY_TAGS], \"seed\": 1}],
            \"variants\": 1,
            \"styleOnly\": true,
            \"styleRefs\": []
        }'" \
        "400" \
        "Too many tags"
    
    # Test 6: Tag too long (>64 chars)
    LONG_TAG=$(printf 'x%.0s' {1..65})
    run_test "Tag too long (>64 chars)" \
        "curl -s -w \"\n%{http_code}\" -X POST http://127.0.0.1:8787/batch/submit \
        -H \"Content-Type: application/json\" \
        -d '{
            \"rows\": [{\"prompt\": \"Test\", \"tags\": [\"$LONG_TAG\"], \"seed\": 1}],
            \"variants\": 1,
            \"styleOnly\": true,
            \"styleRefs\": []
        }'" \
        "400" \
        "Tag too long"
    
else
    echo -e "${YELLOW}Direct Mode is DISABLED (default)${NC}"
    echo "To test Direct Mode validation:"
    echo "  1. Add 'NN_ENABLE_DIRECT_MODE=true' to .env"
    echo "  2. Restart the proxy: cd apps/nn/proxy && pnpm dev"
    echo "  3. Run this test again"
fi

echo ""
echo "================================"
echo "Test Results Summary"
echo "================================"
echo -e "Passed: ${GREEN}$TESTS_PASSED${NC}"
echo -e "Failed: ${RED}$TESTS_FAILED${NC}"

if [ $TESTS_FAILED -eq 0 ]; then
    echo -e "\n${GREEN}All tests passed!${NC}"
    exit 0
else
    echo -e "\n${RED}Some tests failed!${NC}"
    exit 1
fi