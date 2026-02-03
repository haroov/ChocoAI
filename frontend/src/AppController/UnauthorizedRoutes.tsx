import React from 'react';
import { Route, Routes } from 'react-router-dom';
import { LoginPage } from '../pages/LoginPage';

export const UnauthorizedRoutes: React.FC = () => (
  <Routes>
    <Route path="*" element={<LoginPage />} />
  </Routes>
);

UnauthorizedRoutes.displayName = 'UnauthorizedRoutes';
