#!/bin/bash

# Complete flow test as per user story
# This script tests the entire flow from welcome to login verification

set -e

BASE_URL="http://localhost:8080"
CONVERSATION_ID=""

echo "🧪 Testing Complete Flow - User Story"
echo "======================================"
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

# Step 2: User says they're from a nonprofit that hasn't registered and wants to build a campaign
echo "📝 Step 2: User says they want to register as nonprofit and build a campaign"
RESPONSE=$(curl -s -X POST "$BASE_URL/api/v1/agent/message" \
  -H "Content-Type: application/json" \
  -d "{
    \"conversationId\": \"$CONVERSATION_ID\",
    \"message\": \"אני מעמותה שלא רשומה ואני רוצה לבנות קמפיין עם צ'רידי\",
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

# Step 4: User provides organization name (if asked)
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

# Step 6: Check if user was moved to login flow (should ask for verification code)
echo "📝 Step 6: Checking if user was moved to login flow..."
RESPONSE=$(curl -s -X POST "$BASE_URL/api/v1/agent/message" \
  -H "Content-Type: application/json" \
  -d "{
    \"conversationId\": \"$CONVERSATION_ID\",
    \"message\": \"test\",
    \"channel\": \"web\",
    \"stream\": false
  }")
FINAL_RESPONSE=$(echo $RESPONSE | jq -r '.finalText // .message // "No response"')
echo "✅ Response: $FINAL_RESPONSE"
echo ""

# Summary
echo "======================================"
echo "✅ Flow Test Summary"
echo "======================================"
echo "📊 Conversation ID: $CONVERSATION_ID"
echo "📝 Final Response: $FINAL_RESPONSE"
echo ""
echo "✅ Flow test completed!"
echo ""
echo "To view conversation details, visit:"
echo "http://localhost:5173/conversations/$CONVERSATION_ID"

