/**
 * Donor Registration UAT Tests
 * User Acceptance Tests for donor registration flow
 */

import { test, expect } from "@playwright/test";
import { TestHelpers, TestUser } from "../helpers/test-helpers";

test.describe("Donor Registration Flow", () => {
  let helpers: TestHelpers;
  let testUser: TestUser;

  test.beforeEach(async ({ page }) => {
    helpers = new TestHelpers(page);
    testUser = TestHelpers.generateTestUser("donor");

    // Navigate to the main page
    await helpers.navigateToConversations();
  });

  test("should complete donor registration successfully", async ({ page }) => {
    // Start a new conversation
    await helpers.waitForChatWidget();
    await helpers.sendChatMessage("Hi, I'd like to register as a donor");

    // Wait for AI response
    await helpers.waitForAIResponse();
    const response = await helpers.getLatestAIResponse();
    expect(response).toContain("donor");

    // Provide personal information
    await helpers.sendChatMessage(
      `My name is ${testUser.firstName} ${testUser.lastName}`
    );
    await helpers.waitForAIResponse();

    await helpers.sendChatMessage(`My email is ${testUser.email}`);
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

  test("should handle invalid email format", async ({ page }) => {
    await helpers.waitForChatWidget();
    await helpers.sendChatMessage("I want to register as a donor");
    await helpers.waitForAIResponse();

    // Provide invalid email
    await helpers.sendChatMessage("My email is invalid-email");
    await helpers.waitForAIResponse();

    const response = await helpers.getLatestAIResponse();
    expect(response.toLowerCase()).toMatch(/valid|format|email/);
  });

  test("should handle missing required fields", async ({ page }) => {
    await helpers.waitForChatWidget();
    await helpers.sendChatMessage("I want to register as a donor");
    await helpers.waitForAIResponse();

    // Try to proceed without providing required information
    await helpers.sendChatMessage("I accept the terms");
    await helpers.waitForAIResponse();

    const response = await helpers.getLatestAIResponse();
    expect(response.toLowerCase()).toMatch(/need|require|missing|information/);
  });

  test("should allow user to change their mind about registration", async ({
    page,
  }) => {
    await helpers.waitForChatWidget();
    await helpers.sendChatMessage("I want to register as a donor");
    await helpers.waitForAIResponse();

    // Change mind
    await helpers.sendChatMessage(
      "Actually, I changed my mind. I don't want to register"
    );
    await helpers.waitForAIResponse();

    const response = await helpers.getLatestAIResponse();
    expect(response.toLowerCase()).toMatch(/understand|okay|help|else/);
  });

  test("should handle password confirmation mismatch", async ({ page }) => {
    await helpers.waitForChatWidget();
    await helpers.sendChatMessage("I want to register as a donor");
    await helpers.waitForAIResponse();

    await helpers.sendChatMessage(
      `My name is ${testUser.firstName} ${testUser.lastName}`
    );
    await helpers.waitForAIResponse();

    await helpers.sendChatMessage(`My email is ${testUser.email}`);
    await helpers.waitForAIResponse();

    // Provide mismatched passwords
    await helpers.sendChatMessage("My password is Password123");
    await helpers.waitForAIResponse();

    await helpers.sendChatMessage("Confirm password is DifferentPassword456");
    await helpers.waitForAIResponse();

    const response = await helpers.getLatestAIResponse();
    expect(response.toLowerCase()).toMatch(/match|same|different|confirm/);
  });

  test("should provide clear instructions for each step", async ({ page }) => {
    await helpers.waitForChatWidget();
    await helpers.sendChatMessage("I want to register as a donor");
    await helpers.waitForAIResponse();

    const response = await helpers.getLatestAIResponse();

    // Check that the response provides clear instructions
    expect(response.length).toBeGreaterThan(50); // Should be informative
    expect(response.toLowerCase()).toMatch(/name|email|password|terms/);
  });

  test("should handle special characters in names", async ({ page }) => {
    await helpers.waitForChatWidget();
    await helpers.sendChatMessage("I want to register as a donor");
    await helpers.waitForAIResponse();

    // Test with special characters
    await helpers.sendChatMessage("My name is José María O'Connor-Smith");
    await helpers.waitForAIResponse();

    const response = await helpers.getLatestAIResponse();
    expect(response).not.toMatch(/error|invalid/);
  });

  test("should handle long email addresses", async ({ page }) => {
    await helpers.waitForChatWidget();
    await helpers.sendChatMessage("I want to register as a donor");
    await helpers.waitForAIResponse();

    // Test with long email
    const longEmail =
      "very.long.email.address.that.might.cause.issues@verylongdomainname.com";
    await helpers.sendChatMessage(`My email is ${longEmail}`);
    await helpers.waitForAIResponse();

    const response = await helpers.getLatestAIResponse();
    expect(response).not.toMatch(/error|invalid|too long/);
  });

  test("should maintain conversation context throughout registration", async ({
    page,
  }) => {
    await helpers.waitForChatWidget();
    await helpers.sendChatMessage("I want to register as a donor");
    await helpers.waitForAIResponse();

    // Provide information step by step
    await helpers.sendChatMessage(
      `My name is ${testUser.firstName} ${testUser.lastName}`
    );
    await helpers.waitForAIResponse();

    await helpers.sendChatMessage(`My email is ${testUser.email}`);
    await helpers.waitForAIResponse();

    // Ask about what's been collected so far
    await helpers.sendChatMessage(
      "What information have you collected from me so far?"
    );
    await helpers.waitForAIResponse();

    const response = await helpers.getLatestAIResponse();
    expect(response.toLowerCase()).toMatch(testUser.firstName.toLowerCase());
    expect(response.toLowerCase()).toMatch(testUser.lastName.toLowerCase());
    expect(response.toLowerCase()).toMatch(testUser.email.toLowerCase());
  });

  test("should handle network interruptions gracefully", async ({ page }) => {
    await helpers.waitForChatWidget();
    await helpers.sendChatMessage("I want to register as a donor");
    await helpers.waitForAIResponse();

    // Simulate network interruption by going offline
    await page.context().setOffline(true);

    await helpers.sendChatMessage(
      `My name is ${testUser.firstName} ${testUser.lastName}`
    );

    // Wait a bit, then come back online
    await page.waitForTimeout(2000);
    await page.context().setOffline(false);

    // Should handle the interruption gracefully
    await helpers.waitForAIResponse(15000);
    const response = await helpers.getLatestAIResponse();
    expect(response).toBeTruthy();
  });
});
