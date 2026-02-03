import React from 'react';
import { Button, ButtonProps } from '@heroui/react';

type SectionHeaderProps = {
  title: React.ReactNode;
  actions?: Array<Omit<ButtonProps, 'id'> & { id: string }>
};

export const SectionHeader: React.FC<SectionHeaderProps> = ({ title, actions }) => (
  <header className="border-b border-default-200 bg-content1/60 backdrop-blur sticky top-0 z-50 p-4
                     supports-[backdrop-filter]:bg-content1/80 flex items-center justify-between"
  >
    <h1 className="text-2xl line-clamp-1">{title}</h1>

    <div className="flex items-center gap-3">
      {actions?.map((action) => (
        <Button
          key={`section-header-btn_${action.id}`}
          size="sm"
          {...action}
        />
      ))}
    </div>
  </header>
);
