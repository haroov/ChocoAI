/**
 * API Endpoints Load Test
 * Tests core API endpoints under load
 */

import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Trend, Counter } from "k6/metrics";

// Custom metrics
const errorRate = new Rate("api_errors");
const responseTime = new Trend("api_response_time");
const endpointCalls = new Counter("endpoint_calls");

// Test configuration
export const options = {
  stages: [
    { duration: "1m", target: 5 }, // Ramp up to 5 users
    { duration: "3m", target: 5 }, // Stay at 5 users
    { duration: "1m", target: 15 }, // Ramp up to 15 users
    { duration: "3m", target: 15 }, // Stay at 15 users
    { duration: "1m", target: 0 }, // Ramp down
  ],
  thresholds: {
    http_req_duration: ["p(95)<1000"], // 95% of requests below 1s
    http_req_failed: ["rate<0.05"], // Error rate below 5%
    api_errors: ["rate<0.05"], // Custom error rate below 5%
  },
};

const BASE_URL = __ENV.BASE_URL || "http://localhost:8080";
const API_BASE = `${BASE_URL}/api`;

// Test endpoints
const endpoints = [
  { method: "GET", path: "/health", name: "Health Check" },
  { method: "GET", path: "/api/conversations", name: "List Conversations" },
  { method: "GET", path: "/api/settings", name: "Get Settings" },
  { method: "GET", path: "/api/feature-flags", name: "Get Feature Flags" },
  {
    method: "GET",
    path: "/api/settings/versions",
    name: "Get Settings Versions",
  },
];

// Test data for POST endpoints
const testConversationData = {
  title: `Load Test Conversation ${Date.now()}`,
};

const testMessageData = {
  conversationId: null, // Will be set dynamically
  role: "user",
  content: "This is a load test message",
};

function testEndpoint(endpoint) {
  const url = `${BASE_URL}${endpoint.path}`;
  const params = {
    headers: {
      "Content-Type": "application/json",
    },
  };

  let response;
  const startTime = Date.now();

  switch (endpoint.method) {
    case "GET":
      response = http.get(url, params);
      break;
    case "POST":
      const payload = endpoint.path.includes("conversations/new")
        ? JSON.stringify(testConversationData)
        : JSON.stringify(testMessageData);
      response = http.post(url, payload, params);
      break;
    default:
      response = http.get(url, params);
  }

  const endTime = Date.now();
  const duration = endTime - startTime;

  const success = check(response, {
    [`${endpoint.name} - Status 200`]: (r) => r.status === 200,
    [`${endpoint.name} - Response time < 1s`]: (r) => duration < 1000,
    [`${endpoint.name} - Valid JSON`]: (r) => {
      try {
        JSON.parse(r.body);
        return true;
      } catch {
        return false;
      }
    },
  });

  if (!success) {
    errorRate.add(1);
  }

  responseTime.add(duration);
  endpointCalls.add(1);

  return response;
}

function testConversationFlow() {
  // Create conversation
  const createResponse = testEndpoint({
    method: "POST",
    path: "/api/conversations/new",
    name: "Create Conversation",
  });

  if (createResponse.status !== 200) {
    errorRate.add(1);
    return;
  }

  let conversationId;
  try {
    const body = JSON.parse(createResponse.body);
    conversationId = body.conversation.id;
  } catch {
    errorRate.add(1);
    return;
  }

  // Update message data with conversation ID
  testMessageData.conversationId = conversationId;

  // Send message
  testEndpoint({
    method: "POST",
    path: "/api/messages",
    name: "Send Message",
  });

  // Get conversation
  testEndpoint({
    method: "GET",
    path: `/api/conversations/${conversationId}`,
    name: "Get Conversation",
  });

  // Get conversation summary
  testEndpoint({
    method: "GET",
    path: `/api/conversations/${conversationId}/summary`,
    name: "Get Conversation Summary",
  });

  // Get conversation fields
  testEndpoint({
    method: "GET",
    path: `/api/conversations/${conversationId}/fields`,
    name: "Get Conversation Fields",
  });
}

export default function () {
  // Test basic endpoints
  endpoints.forEach((endpoint) => {
    testEndpoint(endpoint);
    sleep(0.5);
  });

  // Test conversation flow (occasionally)
  if (Math.random() < 0.3) {
    testConversationFlow();
  }

  sleep(1);
}

export function setup() {
  console.log("🚀 Starting API Endpoints Load Test");
  console.log(`📍 Target URL: ${BASE_URL}`);
  console.log(`🔗 Testing ${endpoints.length} endpoints`);
}

export function teardown() {
  console.log("🏁 API Endpoints Load Test completed");
  console.log(`📊 Total endpoint calls: ${endpointCalls.count}`);
}
