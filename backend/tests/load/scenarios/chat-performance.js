/**
 * Chat Performance Load Test
 * Tests AI chat functionality under various load conditions
 */

import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Trend, Counter } from "k6/metrics";

// Custom metrics
const errorRate = new Rate("chat_errors");
const responseTime = new Trend("chat_response_time");
const conversationsCreated = new Counter("conversations_created");
const messagesProcessed = new Counter("messages_processed");
const aiResponses = new Counter("ai_responses");

// Test configuration
export const options = {
  stages: [
    { duration: "2m", target: 5 }, // Ramp up to 5 users
    { duration: "5m", target: 5 }, // Stay at 5 users
    { duration: "2m", target: 10 }, // Ramp up to 10 users
    { duration: "5m", target: 10 }, // Stay at 10 users
    { duration: "2m", target: 20 }, // Ramp up to 20 users
    { duration: "5m", target: 20 }, // Stay at 20 users
    { duration: "2m", target: 0 }, // Ramp down
  ],
  thresholds: {
    http_req_duration: ["p(95)<5000"], // 95% of requests below 5s (AI responses can be slower)
    http_req_failed: ["rate<0.1"], // Error rate below 10%
    chat_errors: ["rate<0.1"], // Custom error rate below 10%
    chat_response_time: ["p(95)<5000"], // 95% of chat responses below 5s
  },
};

const BASE_URL = __ENV.BASE_URL || "http://localhost:8080";
const API_BASE = `${BASE_URL}/api`;

// Test conversation scenarios
const conversationScenarios = [
  {
    name: "Donor Registration",
    messages: [
      "Hi, I'd like to register as a donor",
      "My name is John Doe and my email is john@example.com",
      "I want to make a monthly donation of $50",
      "Yes, I accept the terms and conditions",
    ],
  },
  {
    name: "Nonprofit Registration",
    messages: [
      "I want to register my nonprofit organization",
      "Our organization is called 'Help the Children Foundation'",
      "My name is Jane Smith, email is jane@helpchildren.org",
      "Our phone number is +1-555-123-4567",
      "Yes, I accept the terms",
    ],
  },
  {
    name: "General Inquiry",
    messages: [
      "Hello, can you help me?",
      "What services do you offer?",
      "How does the donation process work?",
      "Thank you for the information",
    ],
  },
  {
    name: "Account Support",
    messages: [
      "I'm having trouble logging in",
      "My email is support@example.com",
      "I forgot my password",
      "Can you help me reset it?",
    ],
  },
];

// Test data
const testUsers = [
  { email: "loadtest1@example.com", firstName: "Load", lastName: "Test1" },
  { email: "loadtest2@example.com", firstName: "Load", lastName: "Test2" },
  { email: "loadtest3@example.com", firstName: "Load", lastName: "Test3" },
  { email: "loadtest4@example.com", firstName: "Load", lastName: "Test4" },
  { email: "loadtest5@example.com", firstName: "Load", lastName: "Test5" },
];

function getRandomScenario() {
  return conversationScenarios[
    Math.floor(Math.random() * conversationScenarios.length)
  ];
}

function getRandomUser() {
  return testUsers[Math.floor(Math.random() * testUsers.length)];
}

function createConversation() {
  const payload = JSON.stringify({
    title: `Chat Load Test ${Date.now()}`,
  });

  const params = {
    headers: {
      "Content-Type": "application/json",
    },
  };

  const response = http.post(`${API_BASE}/conversations/new`, payload, params);

  const success = check(response, {
    "conversation created": (r) => r.status === 200,
    "response has conversation ID": (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.ok && body.conversation && body.conversation.id;
      } catch {
        return false;
      }
    },
  });

  if (success) {
    conversationsCreated.add(1);
    try {
      const body = JSON.parse(response.body);
      return body.conversation.id;
    } catch {
      return null;
    }
  }

  return null;
}

function sendMessage(conversationId, message) {
  const payload = JSON.stringify({
    conversationId,
    role: "user",
    content: message,
  });

  const params = {
    headers: {
      "Content-Type": "application/json",
    },
  };

  const response = http.post(`${API_BASE}/messages`, payload, params);

  const success = check(response, {
    "message sent": (r) => r.status === 200,
    "response has message ID": (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.ok && body.message && body.message.id;
      } catch {
        return false;
      }
    },
  });

  if (success) {
    messagesProcessed.add(1);
  }

  return success;
}

function chatWithAI(conversationId, message) {
  const payload = JSON.stringify({
    message,
    conversationId,
    channel: "web",
  });

  const params = {
    headers: {
      "Content-Type": "application/json",
    },
  };

  const startTime = Date.now();
  const response = http.post(`${API_BASE}/agent/chat-simple`, payload, params);
  const endTime = Date.now();

  const success = check(response, {
    "AI response received": (r) => r.status === 200,
    "response has reply": (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.ok && body.reply && body.reply.length > 0;
      } catch {
        return false;
      }
    },
    "response time acceptable": (r) => endTime - startTime < 10000, // 10s max
  });

  if (success) {
    aiResponses.add(1);
    chat_response_time.add(endTime - startTime);
  } else {
    errorRate.add(1);
  }

  return success;
}

function runConversationScenario(conversationId, scenario) {
  console.log(`Running scenario: ${scenario.name}`);

  for (const message of scenario.messages) {
    // Send user message
    if (!sendMessage(conversationId, message)) {
      errorRate.add(1);
      continue;
    }

    // Get AI response
    if (!chatWithAI(conversationId, message)) {
      errorRate.add(1);
      continue;
    }

    // Small delay between messages
    sleep(1);
  }
}

function testStreamingChat(conversationId, message) {
  const url = `${API_BASE}/agent/chat-stream?message=${encodeURIComponent(
    message
  )}&conversationId=${conversationId}&channel=web`;

  const params = {
    headers: {
      Accept: "text/event-stream",
    },
  };

  const startTime = Date.now();
  const response = http.get(url, params);
  const endTime = Date.now();

  const success = check(response, {
    "streaming response received": (r) => r.status === 200,
    "streaming response time acceptable": (r) => endTime - startTime < 15000, // 15s max for streaming
  });

  if (success) {
    aiResponses.add(1);
    chat_response_time.add(endTime - startTime);
  } else {
    errorRate.add(1);
  }

  return success;
}

export default function () {
  // Create a conversation
  const conversationId = createConversation();
  if (!conversationId) {
    errorRate.add(1);
    return;
  }

  // Choose a random scenario
  const scenario = getRandomScenario();

  // Run the conversation scenario
  runConversationScenario(conversationId, scenario);

  // Test streaming chat (occasionally)
  if (Math.random() < 0.2) {
    const testMessage = "Can you explain how the donation process works?";
    testStreamingChat(conversationId, testMessage);
  }

  // Small delay between iterations
  sleep(2);
}

export function setup() {
  console.log("🚀 Starting Chat Performance Load Test");
  console.log(`📍 Target URL: ${BASE_URL}`);
  console.log(
    `💬 Testing ${conversationScenarios.length} conversation scenarios`
  );
  console.log(
    `👥 Max concurrent users: ${Math.max(
      ...options.stages.map((s) => s.target)
    )}`
  );

  // Verify the service is running
  const healthResponse = http.get(`${BASE_URL}/health`);
  if (healthResponse.status !== 200) {
    throw new Error(`Service not available at ${BASE_URL}`);
  }

  console.log("✅ Service is healthy, starting chat load test...");
}

export function teardown() {
  console.log("🏁 Chat Performance Load Test completed");
  console.log(`📊 Total conversations created: ${conversationsCreated.count}`);
  console.log(`💬 Total messages processed: ${messagesProcessed.count}`);
  console.log(`🤖 Total AI responses: ${aiResponses.count}`);
}
