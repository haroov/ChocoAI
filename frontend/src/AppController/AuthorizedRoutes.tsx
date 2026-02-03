import React from 'react';
import { Route, Routes } from 'react-router-dom';
import { observer } from 'mobx-react-lite';
import MainLayout from '../layouts/MainLayout';
import NotFoundPage from '../pages/NotFoundPage';
import { ConversationsPage } from '../pages/ConversationsPage';
import { SettingsPage } from '../pages/SettingsPage';
import { DashboardSection } from '../pages/SettingsPage/sections/DashboardSection';
import { AIProviderSection } from '../pages/SettingsPage/sections/AIProviderSection';
import { FlowsSection } from '../pages/SettingsPage/sections/FlowsSection';
import { FlowEditor } from '../pages/SettingsPage/sections/FlowEditor';
import { WebWidgetSection } from '../pages/SettingsPage/sections/WebWidgetSection';
import { SystemSection } from '../pages/SettingsPage/sections/SystemSection';
import { WhatsappSection } from '../pages/SettingsPage/sections/WhatsappSection';
import { EmailSection } from '../pages/SettingsPage/sections/EmailSection';
import { QAPage } from '../pages/QAPage/QAPage';
import { QAWikiPage } from '../pages/QAWikiPage/QAWikiPage';
import { UsersSection } from '../pages/SettingsPage/sections/UsersSection';
import { appSettingsStore } from '../stores/appSettingsStore';
import { BugReportsPage } from '../pages/QAPage/BugReportsPage';

export const AuthorizedRoutes: React.FC = observer(() => (
  <MainLayout>
    <Routes>
      <Route path="/" element={<ConversationsPage />} />
      <Route path="/conversations/:conversationId" element={<ConversationsPage />} />

      <Route path="/settings" element={<SettingsPage />}>
        <Route index element={<DashboardSection />} />
        <Route path="dashboard" element={<DashboardSection />} />
        <Route path="ai-provider" element={<AIProviderSection />} />
        <Route path="flows" element={<FlowsSection />} />
        <Route path="flows/:flowId" element={<FlowEditor />} />
        <Route path="whatsapp" element={<WhatsappSection />} />
        <Route path="email" element={<EmailSection />} />
        <Route path="web-widget" element={<WebWidgetSection />} />
        <Route path="system" element={<SystemSection />} />
        <Route path="users" element={<UsersSection />} />
        <Route path=":section" element={<SettingsPage />} />
      </Route>

      {appSettingsStore.qaEnabled && (
        <>
          <Route path="/qa" element={<QAPage />} />
          <Route path="/qa/wiki" element={<QAWikiPage />} />
          <Route path="/qa/bugs" element={<BugReportsPage />} />
        </>
      )}

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  </MainLayout>
));

AuthorizedRoutes.displayName = 'AuthorizedRoutes';
