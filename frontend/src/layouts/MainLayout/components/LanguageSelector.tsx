import React from 'react';
import { Button, Dropdown } from '@heroui/react';
import { DropdownItem, DropdownMenu, DropdownTrigger } from '@heroui/dropdown';
import { appSettingsStore } from '../../../stores/appSettingsStore';

export const LanguageSelector: React.FC = () => {
  const languages = [
    { key: 'en', label: 'English', flag: '🇺🇸' },
    { key: 'he', label: 'עברית', flag: '🇮🇱' },
  ];

  const selectedValue = languages.find((lang) => lang.key === appSettingsStore.language) || languages[0];

  return (
    <Dropdown>
      <DropdownTrigger>
        <Button
          className="text-lg border border-primary"
          color="primary"
          variant="light"
          size="sm"
          isIconOnly
          radius="full"
        >
          {selectedValue.flag}
        </Button>
      </DropdownTrigger>
      <DropdownMenu
        disallowEmptySelection
        selectedKeys={[selectedValue.key]}
        selectionMode="single"
        variant="flat"
        onSelectionChange={(v) => appSettingsStore.changeLanguage(v.anchorKey as string)}
      >
        {languages.map((language) => (
          <DropdownItem
            key={language.key}
            startContent={<span className="text-lg">{language.flag}</span>}
          >
            {language.label}
          </DropdownItem>
        ))}
      </DropdownMenu>
    </Dropdown>
  );
};
