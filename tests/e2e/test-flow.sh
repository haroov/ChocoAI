#!/bin/bash

# Test the complete flow as described in the user story

echo "🧪 Testing Complete Flow"
echo "========================"
echo ""

BASE_URL="http://localhost:8080"
CONVERSATION_ID=""

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

# Step 2: User says they want to register as nonprofit and build a campaign
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
echo "📝 Step 3: User provides registration details"
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

# Step 4: User provides campaign details
echo "📝 Step 4: User provides campaign details"
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

# Step 5: Get conversation details and logs
echo "📊 Step 5: Getting conversation details and logs..."
CONV_DETAILS=$(curl -s -X GET "$BASE_URL/api/v1/conversations/$CONVERSATION_ID" \
  -H "Cookie: charidy_admin=test" 2>/dev/null || echo '{"ok":false,"error":"Unauthorized"}')

if [ "$(echo $CONV_DETAILS | jq -r '.ok')" = "true" ]; then
  echo "✅ Conversation found"
  echo "📝 Messages: $(echo $CONV_DETAILS | jq '.conversation.messages | length')"
  echo "📝 User Data: $(echo $CONV_DETAILS | jq '.userData | keys | length') fields collected"
  echo "📝 API Calls: $(echo $CONV_DETAILS | jq '.log | length') API calls made"
  echo ""
  echo "📋 Last few messages:"
  echo $CONV_DETAILS | jq -r '.conversation.messages[-3:] | .[] | "  \(.role): \(.content)"'
else
  echo "⚠️  Could not fetch conversation details (authentication required)"
fi

echo ""
echo "✅ Flow test completed!"
echo "📊 Conversation ID: $CONVERSATION_ID"

