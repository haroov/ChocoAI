/**
 * Nonprofit Registration UAT Tests
 * User Acceptance Tests for nonprofit registration flow
 */

import { test, expect } from "@playwright/test";
import { TestHelpers, TestUser } from "../helpers/test-helpers";

test.describe("Nonprofit Registration Flow", () => {
  let helpers: TestHelpers;
  let testUser: TestUser;

  test.beforeEach(async ({ page }) => {
    helpers = new TestHelpers(page);
    testUser = TestHelpers.generateTestUser("nonprofit");

    // Navigate to the main page
    await helpers.navigateToConversations();
  });

  test("should complete nonprofit registration successfully", async ({
    page,
  }) => {
    // Start a new conversation
    await helpers.waitForChatWidget();
    await helpers.sendChatMessage(
      "I want to register my nonprofit organization"
    );

    // Wait for AI response
    await helpers.waitForAIResponse();
    const response = await helpers.getLatestAIResponse();
    expect(response).toContain("nonprofit");

    // Provide organization information
    await helpers.sendChatMessage(
      `Our organization is called ${testUser.organizationName}`
    );
    await helpers.waitForAIResponse();

    // Provide personal information
    await helpers.sendChatMessage(
      `My name is ${testUser.firstName} ${testUser.lastName}`
    );
    await helpers.waitForAIResponse();

    await helpers.sendChatMessage(`My email is ${testUser.email}`);
    await helpers.waitForAIResponse();

    // Provide phone number
    await helpers.sendChatMessage(`Our phone number is ${testUser.phone}`);
    await helpers.waitForAIResponse();

    // Set password
    await helpers.sendChatMessage(`My password is ${testUser.password}`);
    await helpers.waitForAIResponse();

    // Accept terms
    await helpers.sendChatMessage("Yes, I accept the terms and conditions");
    await helpers.waitForAIResponse();

    // Verify registration completion
    const finalResponse = await helpers.getLatestAIResponse();
    expect(finalResponse.toLowerCase()).toMatch(
      /success|complete|welcome|registered/
    );
  });

  test("should handle organization name validation", async ({ page }) => {
    await helpers.waitForChatWidget();
    await helpers.sendChatMessage(
      "I want to register my nonprofit organization"
    );
    await helpers.waitForAIResponse();

    // Provide invalid organization name
    await helpers.sendChatMessage("Our organization is called ''");
    await helpers.waitForAIResponse();

    const response = await helpers.getLatestAIResponse();
    expect(response.toLowerCase()).toMatch(/valid|name|organization/);
  });

  test("should handle phone number validation", async ({ page }) => {
    await helpers.waitForChatWidget();
    await helpers.sendChatMessage(
      "I want to register my nonprofit organization"
    );
    await helpers.waitForAIResponse();

    await helpers.sendChatMessage(
      `Our organization is called ${testUser.organizationName}`
    );
    await helpers.waitForAIResponse();

    await helpers.sendChatMessage(
      `My name is ${testUser.firstName} ${testUser.lastName}`
    );
    await helpers.waitForAIResponse();

    await helpers.sendChatMessage(`My email is ${testUser.email}`);
    await helpers.waitForAIResponse();

    // Provide invalid phone number
    await helpers.sendChatMessage("Our phone number is 123");
    await helpers.waitForAIResponse();

    const response = await helpers.getLatestAIResponse();
    expect(response.toLowerCase()).toMatch(/valid|phone|number/);
  });

  test("should handle international phone numbers", async ({ page }) => {
    await helpers.waitForChatWidget();
    await helpers.sendChatMessage(
      "I want to register my nonprofit organization"
    );
    await helpers.waitForAIResponse();

    await helpers.sendChatMessage(
      `Our organization is called ${testUser.organizationName}`
    );
    await helpers.waitForAIResponse();

    await helpers.sendChatMessage(
      `My name is ${testUser.firstName} ${testUser.lastName}`
    );
    await helpers.waitForAIResponse();

    await helpers.sendChatMessage(`My email is ${testUser.email}`);
    await helpers.waitForAIResponse();

    // Provide international phone number
    await helpers.sendChatMessage("Our phone number is +44-20-7946-0958");
    await helpers.waitForAIResponse();

    const response = await helpers.getLatestAIResponse();
    expect(response).not.toMatch(/error|invalid/);
  });

  test("should handle long organization names", async ({ page }) => {
    await helpers.waitForChatWidget();
    await helpers.sendChatMessage(
      "I want to register my nonprofit organization"
    );
    await helpers.waitForAIResponse();

    // Test with very long organization name
    const longOrgName =
      "The Very Long Organization Name That Might Cause Issues With Database Storage And User Interface Display International Foundation for Global Humanitarian Aid and Development";
    await helpers.sendChatMessage(`Our organization is called ${longOrgName}`);
    await helpers.waitForAIResponse();

    const response = await helpers.getLatestAIResponse();
    expect(response).not.toMatch(/error|invalid|too long/);
  });

  test("should handle special characters in organization names", async ({
    page,
  }) => {
    await helpers.waitForChatWidget();
    await helpers.sendChatMessage(
      "I want to register my nonprofit organization"
    );
    await helpers.waitForAIResponse();

    // Test with special characters
    await helpers.sendChatMessage(
      "Our organization is called Children's Aid & Development Foundation (C.A.D.F.)"
    );
    await helpers.waitForAIResponse();

    const response = await helpers.getLatestAIResponse();
    expect(response).not.toMatch(/error|invalid/);
  });

  test("should allow user to skip optional fields", async ({ page }) => {
    await helpers.waitForChatWidget();
    await helpers.sendChatMessage(
      "I want to register my nonprofit organization"
    );
    await helpers.waitForAIResponse();

    await helpers.sendChatMessage(
      `Our organization is called ${testUser.organizationName}`
    );
    await helpers.waitForAIResponse();

    await helpers.sendChatMessage(
      `My name is ${testUser.firstName} ${testUser.lastName}`
    );
    await helpers.waitForAIResponse();

    await helpers.sendChatMessage(`My email is ${testUser.email}`);
    await helpers.waitForAIResponse();

    // Skip phone number
    await helpers.sendChatMessage("I don't want to provide a phone number");
    await helpers.waitForAIResponse();

    const response = await helpers.getLatestAIResponse();
    expect(response.toLowerCase()).toMatch(/password|continue|next/);
  });

  test("should provide clear progress indication", async ({ page }) => {
    await helpers.waitForChatWidget();
    await helpers.sendChatMessage(
      "I want to register my nonprofit organization"
    );
    await helpers.waitForAIResponse();

    // Check that progress is indicated
    const response = await helpers.getLatestAIResponse();
    expect(response.toLowerCase()).toMatch(/step|progress|next|organization/);
  });

  test("should handle user corrections during registration", async ({
    page,
  }) => {
    await helpers.waitForChatWidget();
    await helpers.sendChatMessage(
      "I want to register my nonprofit organization"
    );
    await helpers.waitForAIResponse();

    await helpers.sendChatMessage("Our organization is called Wrong Name");
    await helpers.waitForAIResponse();

    // Correct the organization name
    await helpers.sendChatMessage(
      "Actually, our organization is called Correct Name"
    );
    await helpers.waitForAIResponse();

    const response = await helpers.getLatestAIResponse();
    expect(response.toLowerCase()).toMatch(/correct name|updated/);
  });

  test("should handle multiple contact persons", async ({ page }) => {
    await helpers.waitForChatWidget();
    await helpers.sendChatMessage(
      "I want to register my nonprofit organization"
    );
    await helpers.waitForAIResponse();

    await helpers.sendChatMessage(
      `Our organization is called ${testUser.organizationName}`
    );
    await helpers.waitForAIResponse();

    await helpers.sendChatMessage(
      `My name is ${testUser.firstName} ${testUser.lastName}`
    );
    await helpers.waitForAIResponse();

    await helpers.sendChatMessage(`My email is ${testUser.email}`);
    await helpers.waitForAIResponse();

    // Mention another contact person
    await helpers.sendChatMessage(
      "Our executive director is Jane Smith, email jane@example.com"
    );
    await helpers.waitForAIResponse();

    const response = await helpers.getLatestAIResponse();
    expect(response.toLowerCase()).toMatch(/jane|director|contact/);
  });

  test("should handle registration abandonment and resumption", async ({
    page,
  }) => {
    await helpers.waitForChatWidget();
    await helpers.sendChatMessage(
      "I want to register my nonprofit organization"
    );
    await helpers.waitForAIResponse();

    await helpers.sendChatMessage(
      `Our organization is called ${testUser.organizationName}`
    );
    await helpers.waitForAIResponse();

    // Navigate away and come back
    await helpers.navigateToSettings();
    await helpers.navigateToConversations();

    // Resume registration
    await helpers.sendChatMessage(
      "I was registering my nonprofit organization"
    );
    await helpers.waitForAIResponse();

    const response = await helpers.getLatestAIResponse();
    expect(response.toLowerCase()).toMatch(/continue|resume|organization/);
  });

  test("should handle concurrent registration attempts", async ({
    page,
    context,
  }) => {
    // Open a second page to simulate concurrent registration
    const page2 = await context.newPage();
    const helpers2 = new TestHelpers(page2);

    await helpers.navigateToConversations();
    await helpers2.navigateToConversations();

    // Start registration on both pages
    await helpers.waitForChatWidget();
    await helpers2.waitForChatWidget();

    await helpers.sendChatMessage(
      "I want to register my nonprofit organization"
    );
    await helpers2.sendChatMessage(
      "I want to register my nonprofit organization"
    );

    await helpers.waitForAIResponse();
    await helpers2.waitForAIResponse();

    // Both should work independently
    const response1 = await helpers.getLatestAIResponse();
    const response2 = await helpers2.getLatestAIResponse();

    expect(response1).toContain("nonprofit");
    expect(response2).toContain("nonprofit");

    await page2.close();
  });
});
