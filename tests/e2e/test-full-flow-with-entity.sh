#!/bin/bash

# Complete flow test including entity selection and payment gateway setup
# This script tests the entire flow from welcome through:
# - User signup and verification
# - Organization selection (if multiple)
# - Entity selection (selecting existing registered org entity)
# - Payment gateway discovery and setup (Grow)

set -e

BASE_URL="http://localhost:8080"
CONVERSATION_ID=""

echo "🧪 Testing Complete Flow with Entity Selection and Payment Gateway Setup"
echo "=========================================================================="
echo ""

# Step 1: User says "hi" (Hebrew)
echo "📝 Step 1: User says 'היי'"
RESPONSE=$(curl -s -X POST "$BASE_URL/api/v1/agent/message" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "היי",
    "channel": "web",
    "stream": false
  }')

CONVERSATION_ID=$(echo $RESPONSE | jq -r '.conversationId // empty')
echo "✅ Conversation ID: $CONVERSATION_ID"
echo "✅ Response: $(echo $RESPONSE | jq -r '.finalText // .message // "No response"')"
echo ""

# Step 2: User says they want to create a campaign for their organization
echo "📝 Step 2: User says they want to create a campaign for their organization"
RESPONSE=$(curl -s -X POST "$BASE_URL/api/v1/agent/message" \
  -H "Content-Type: application/json" \
  -d "{
    \"conversationId\": \"$CONVERSATION_ID\",
    \"message\": \"אני רוצה להרים קמפיין לעמותה שלי\",
    \"channel\": \"web\",
    \"stream\": false
  }")
echo "✅ Response: $(echo $RESPONSE | jq -r '.finalText // .message // "No response"')"
echo ""

# Step 3: User provides registration details
echo "📝 Step 3: User provides registration details: אוריאל אהרוני 0502440556 uriel@facio.io 580722759"
RESPONSE=$(curl -s -X POST "$BASE_URL/api/v1/agent/message" \
  -H "Content-Type: application/json" \
  -d "{
    \"conversationId\": \"$CONVERSATION_ID\",
    \"message\": \"אוריאל אהרוני 0502440556 uriel@facio.io 580722759\",
    \"channel\": \"web\",
    \"stream\": false
  }")
echo "✅ Response: $(echo $RESPONSE | jq -r '.finalText // .message // "No response"')"
echo ""

# Step 4: User provides organization name
echo "📝 Step 4: User provides organization name"
RESPONSE=$(curl -s -X POST "$BASE_URL/api/v1/agent/message" \
  -H "Content-Type: application/json" \
  -d "{
    \"conversationId\": \"$CONVERSATION_ID\",
    \"message\": \"עמותת בטיחות אש\",
    \"channel\": \"web\",
    \"stream\": false
  }")
echo "✅ Response: $(echo $RESPONSE | jq -r '.finalText // .message // "No response"')"
echo ""

# Step 5: User provides campaign details
echo "📝 Step 5: User provides campaign details"
RESPONSE=$(curl -s -X POST "$BASE_URL/api/v1/agent/message" \
  -H "Content-Type: application/json" \
  -d "{
    \"conversationId\": \"$CONVERSATION_ID\",
    \"message\": \"קמפיין לסיוע לבטיחות אש - מגייסים 3 מליון ש״ח בקמפיין ב5 בפברואר\",
    \"channel\": \"web\",
    \"stream\": false
  }")
echo "✅ Response: $(echo $RESPONSE | jq -r '.finalText // .message // "No response"')"
echo ""

# Step 6: User provides verification code
echo "📝 Step 6: User provides verification code"
echo "Please check your phone/email for the verification code"
read -p "Enter verification code: " VERIFICATION_CODE
RESPONSE=$(curl -s -X POST "$BASE_URL/api/v1/agent/message" \
  -H "Content-Type: application/json" \
  -d "{
    \"conversationId\": \"$CONVERSATION_ID\",
    \"message\": \"$VERIFICATION_CODE\",
    \"channel\": \"web\",
    \"stream\": false
  }")
echo "✅ Response: $(echo $RESPONSE | jq -r '.finalText // .message // "No response"')"
echo ""

# Step 7: User selects first organization (if multiple exist)
echo "📝 Step 7: User selects first organization"
RESPONSE=$(curl -s -X POST "$BASE_URL/api/v1/agent/message" \
  -H "Content-Type: application/json" \
  -d "{
    \"conversationId\": \"$CONVERSATION_ID\",
    \"message\": \"הראשון\",
    \"channel\": \"web\",
    \"stream\": false
  }")
echo "✅ Response: $(echo $RESPONSE | jq -r '.finalText // .message // "No response"')"
echo ""

# Step 8: User selects entity (עמותה א׳ - the registered org)
echo "📝 Step 8: User selects entity (עמותה א׳)"
RESPONSE=$(curl -s -X POST "$BASE_URL/api/v1/agent/message" \
  -H "Content-Type: application/json" \
  -d "{
    \"conversationId\": \"$CONVERSATION_ID\",
    \"message\": \"עמותה א׳\",
    \"channel\": \"web\",
    \"stream\": false
  }")
echo "✅ Response: $(echo $RESPONSE | jq -r '.finalText // .message // "No response"')"
echo ""

# Step 9: User says no to having a payment gateway
echo "📝 Step 9: User says no to having a payment gateway"
RESPONSE=$(curl -s -X POST "$BASE_URL/api/v1/agent/message" \
  -H "Content-Type: application/json" \
  -d "{
    \"conversationId\": \"$CONVERSATION_ID\",
    \"message\": \"לא\",
    \"channel\": \"web\",
    \"stream\": false
  }")
echo "✅ Response: $(echo $RESPONSE | jq -r '.finalText // .message // "No response"')"
echo ""

# Step 10: User says yes to Grow payment gateway suggestion
echo "📝 Step 10: User says yes to Grow payment gateway suggestion"
RESPONSE=$(curl -s -X POST "$BASE_URL/api/v1/agent/message" \
  -H "Content-Type: application/json" \
  -d "{
    \"conversationId\": \"$CONVERSATION_ID\",
    \"message\": \"כן\",
    \"channel\": \"web\",
    \"stream\": false
  }")
echo "✅ Response: $(echo $RESPONSE | jq -r '.finalText // .message // "No response"')"
echo ""

# Summary
echo "======================================"
echo "✅ Flow Test Summary"
echo "======================================"
echo "📊 Conversation ID: $CONVERSATION_ID"
echo ""
echo "✅ Flow test completed!"
echo ""
echo "To view conversation details, visit:"
echo "http://localhost:5173/conversations/$CONVERSATION_ID"

