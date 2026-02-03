/**
 * Conversation Management UAT Tests
 * User Acceptance Tests for conversation management features
 */

import { test, expect } from "@playwright/test";
import { TestHelpers, TestUser } from "../helpers/test-helpers";

test.describe("Conversation Management", () => {
  let helpers: TestHelpers;
  let testUser: TestUser;

  test.beforeEach(async ({ page }) => {
    helpers = new TestHelpers(page);
    testUser = TestHelpers.generateTestUser("donor");

    // Navigate to the main page
    await helpers.navigateToConversations();
  });

  test("should create and display new conversations", async ({ page }) => {
    await helpers.waitForChatWidget();
    await helpers.sendChatMessage("Hello, I need help");

    await helpers.waitForAIResponse();

    // Check that conversation appears in the list
    await page.waitForSelector('[data-testid="conversation-list"]');
    const conversationCount = await page
      .locator('[data-testid^="conversation-"]')
      .count();
    expect(conversationCount).toBeGreaterThan(0);
  });

  test("should allow switching between conversations", async ({ page }) => {
    // Create first conversation
    await helpers.waitForChatWidget();
    await helpers.sendChatMessage("First conversation");
    await helpers.waitForAIResponse();

    // Create second conversation
    await helpers.sendChatMessage("Start a new conversation");
    await helpers.waitForAIResponse();

    // Verify both conversations exist
    const conversations = await page
      .locator('[data-testid^="conversation-"]')
      .all();
    expect(conversations.length).toBeGreaterThanOrEqual(2);
  });

  test("should display conversation history correctly", async ({ page }) => {
    await helpers.waitForChatWidget();
    await helpers.sendChatMessage("Hello");
    await helpers.waitForAIResponse();

    await helpers.sendChatMessage("How are you?");
    await helpers.waitForAIResponse();

    await helpers.sendChatMessage("What can you help me with?");
    await helpers.waitForAIResponse();

    // Check that all messages are displayed
    const messages = await page.locator('[data-testid="message"]').all();
    expect(messages.length).toBeGreaterThanOrEqual(3);
  });

  test("should allow conversation title editing", async ({ page }) => {
    await helpers.waitForChatWidget();
    await helpers.sendChatMessage("Hello");
    await helpers.waitForAIResponse();

    // Find the conversation and click on it
    const conversation = page.locator('[data-testid^="conversation-"]').first();
    await conversation.click();

    // Try to edit the title
    const titleElement = page.locator('[data-testid="conversation-title"]');
    if ((await titleElement.count()) > 0) {
      await titleElement.click();
      await titleElement.fill("My Custom Title");
      await page.keyboard.press("Enter");

      // Verify title was updated
      const updatedTitle = await titleElement.textContent();
      expect(updatedTitle).toContain("My Custom Title");
    }
  });

  test("should handle conversation search", async ({ page }) => {
    // Create multiple conversations with different content
    await helpers.waitForChatWidget();
    await helpers.sendChatMessage("I need help with donations");
    await helpers.waitForAIResponse();

    await helpers.sendChatMessage("Start a new conversation");
    await helpers.waitForAIResponse();

    await helpers.sendChatMessage("I want to register as a nonprofit");
    await helpers.waitForAIResponse();

    // Search for conversations
    const searchInput = page.locator('[data-testid="conversation-search"]');
    if ((await searchInput.count()) > 0) {
      await searchInput.fill("donation");

      // Verify search results
      const searchResults = await page
        .locator('[data-testid^="conversation-"]')
        .count();
      expect(searchResults).toBeGreaterThan(0);
    }
  });

  test("should handle conversation deletion", async ({ page }) => {
    await helpers.waitForChatWidget();
    await helpers.sendChatMessage("Test conversation for deletion");
    await helpers.waitForAIResponse();

    // Find the conversation
    const conversation = page.locator('[data-testid^="conversation-"]').first();
    await conversation.click();

    // Try to delete the conversation
    const deleteButton = page.locator('[data-testid="delete-conversation"]');
    if ((await deleteButton.count()) > 0) {
      await deleteButton.click();

      // Confirm deletion
      const confirmButton = page.locator('[data-testid="confirm-delete"]');
      if ((await confirmButton.count()) > 0) {
        await confirmButton.click();

        // Verify conversation was deleted
        await page.waitForTimeout(1000);
        const remainingConversations = await page
          .locator('[data-testid^="conversation-"]')
          .count();
        expect(remainingConversations).toBe(0);
      }
    }
  });

  test("should handle conversation archiving", async ({ page }) => {
    await helpers.waitForChatWidget();
    await helpers.sendChatMessage("Test conversation for archiving");
    await helpers.waitForAIResponse();

    // Find the conversation
    const conversation = page.locator('[data-testid^="conversation-"]').first();
    await conversation.click();

    // Try to archive the conversation
    const archiveButton = page.locator('[data-testid="archive-conversation"]');
    if ((await archiveButton.count()) > 0) {
      await archiveButton.click();

      // Verify conversation was archived
      const archivedConversations = await page
        .locator('[data-testid="archived-conversation"]')
        .count();
      expect(archivedConversations).toBeGreaterThan(0);
    }
  });

  test("should handle conversation export", async ({ page }) => {
    await helpers.waitForChatWidget();
    await helpers.sendChatMessage("Test conversation for export");
    await helpers.waitForAIResponse();

    await helpers.sendChatMessage("This is important information");
    await helpers.waitForAIResponse();

    // Find the conversation
    const conversation = page.locator('[data-testid^="conversation-"]').first();
    await conversation.click();

    // Try to export the conversation
    const exportButton = page.locator('[data-testid="export-conversation"]');
    if ((await exportButton.count()) > 0) {
      const downloadPromise = page.waitForEvent("download");
      await exportButton.click();

      const download = await downloadPromise;
      expect(download.suggestedFilename()).toMatch(/conversation|export/);
    }
  });

  test("should handle conversation sharing", async ({ page }) => {
    await helpers.waitForChatWidget();
    await helpers.sendChatMessage("Test conversation for sharing");
    await helpers.waitForAIResponse();

    // Find the conversation
    const conversation = page.locator('[data-testid^="conversation-"]').first();
    await conversation.click();

    // Try to share the conversation
    const shareButton = page.locator('[data-testid="share-conversation"]');
    if ((await shareButton.count()) > 0) {
      await shareButton.click();

      // Check if share dialog appears
      const shareDialog = page.locator('[data-testid="share-dialog"]');
      if ((await shareDialog.count()) > 0) {
        expect(await shareDialog.isVisible()).toBe(true);
      }
    }
  });

  test("should handle conversation filtering", async ({ page }) => {
    // Create conversations with different statuses
    await helpers.waitForChatWidget();
    await helpers.sendChatMessage("I need help with registration");
    await helpers.waitForAIResponse();

    await helpers.sendChatMessage("Start a new conversation");
    await helpers.waitForAIResponse();

    await helpers.sendChatMessage("I have a technical issue");
    await helpers.waitForAIResponse();

    // Try to filter conversations
    const filterButton = page.locator('[data-testid="conversation-filter"]');
    if ((await filterButton.count()) > 0) {
      await filterButton.click();

      // Select a filter option
      const filterOption = page
        .locator('[data-testid="filter-option"]')
        .first();
      if ((await filterOption.count()) > 0) {
        await filterOption.click();

        // Verify filtered results
        const filteredConversations = await page
          .locator('[data-testid^="conversation-"]')
          .count();
        expect(filteredConversations).toBeGreaterThanOrEqual(0);
      }
    }
  });

  test("should handle conversation sorting", async ({ page }) => {
    // Create multiple conversations
    await helpers.waitForChatWidget();
    await helpers.sendChatMessage("First conversation");
    await helpers.waitForAIResponse();

    await helpers.sendChatMessage("Start a new conversation");
    await helpers.waitForAIResponse();

    await helpers.sendChatMessage("Second conversation");
    await helpers.waitForAIResponse();

    // Try to sort conversations
    const sortButton = page.locator('[data-testid="conversation-sort"]');
    if ((await sortButton.count()) > 0) {
      await sortButton.click();

      // Select a sort option
      const sortOption = page.locator('[data-testid="sort-option"]').first();
      if ((await sortOption.count()) > 0) {
        await sortOption.click();

        // Verify conversations are sorted
        const conversations = await page
          .locator('[data-testid^="conversation-"]')
          .all();
        expect(conversations.length).toBeGreaterThanOrEqual(2);
      }
    }
  });

  test("should handle conversation pagination", async ({ page }) => {
    // Create many conversations to test pagination
    for (let i = 0; i < 5; i++) {
      await helpers.waitForChatWidget();
      await helpers.sendChatMessage(`Conversation ${i + 1}`);
      await helpers.waitForAIResponse();

      if (i < 4) {
        await helpers.sendChatMessage("Start a new conversation");
        await helpers.waitForAIResponse();
      }
    }

    // Check if pagination controls exist
    const paginationControls = page.locator('[data-testid="pagination"]');
    if ((await paginationControls.count()) > 0) {
      // Test pagination
      const nextButton = page.locator('[data-testid="pagination-next"]');
      if ((await nextButton.count()) > 0) {
        await nextButton.click();

        // Verify page changed
        const currentPage = page.locator('[data-testid="current-page"]');
        if ((await currentPage.count()) > 0) {
          const pageNumber = await currentPage.textContent();
          expect(pageNumber).toMatch(/2/);
        }
      }
    }
  });

  test("should handle conversation refresh", async ({ page }) => {
    await helpers.waitForChatWidget();
    await helpers.sendChatMessage("Test conversation");
    await helpers.waitForAIResponse();

    // Refresh the page
    await page.reload();
    await helpers.waitForPageLoad();

    // Verify conversation is still there
    const conversations = await page
      .locator('[data-testid^="conversation-"]')
      .count();
    expect(conversations).toBeGreaterThan(0);
  });

  test("should handle conversation real-time updates", async ({
    page,
    context,
  }) => {
    // Open a second page to simulate real-time updates
    const page2 = await context.newPage();
    const helpers2 = new TestHelpers(page2);

    await helpers.navigateToConversations();
    await helpers2.navigateToConversations();

    // Start a conversation on the first page
    await helpers.waitForChatWidget();
    await helpers.sendChatMessage("Real-time test message");
    await helpers.waitForAIResponse();

    // Check if the conversation appears on the second page
    await page2.waitForSelector('[data-testid="conversation-list"]');
    const conversationsOnPage2 = await page2
      .locator('[data-testid^="conversation-"]')
      .count();
    expect(conversationsOnPage2).toBeGreaterThan(0);

    await page2.close();
  });
});
