import React from 'react';

export const SectionContent: React.FC<React.PropsWithChildren> = ({ children }) => (
  <main className="p-4">
    {children}
  </main>
);
