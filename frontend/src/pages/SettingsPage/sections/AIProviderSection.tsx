import React, { useEffect } from 'react';
import { useTranslations } from 'use-intl';
import { Select, SelectItem } from '@heroui/react';
import { useMainLayout } from '../../../layouts/MainLayout';
import { SectionHeader } from '../components/SectionHeader';
import { apiClientStore } from '../../../stores/apiClientStore';

const AVAILABLE_MODELS = [
  'gpt-5.2',
  'gpt-5.2-mini',
  'gpt-5.2-nano',
  'gpt-5.1',
  'gpt-5.1-mini',
  'gpt-5.1-nano',
  'gpt-5',
  'gpt-5-mini',
  'gpt-5-nano',
  'gpt-4.1',
  'gpt-4.1-mini',
  'o4-mini',
  'gpt-4o',
  'gpt-4o-mini',
];

export const AIProviderSection: React.FC = () => {
  const t = useTranslations('SettingsPage');

  const [selectedModel, setSelectedModel] = React.useState<string>('');
  const [isLoading, setIsLoading] = React.useState(true);

  useMainLayout({ title: t('aiProvider') });

  useEffect(() => {
    apiClientStore.fetch('/api/v1/project-settings')
      .then((res) => res.json())
      .then((res) => setSelectedModel(res.config.llmModel))
      .finally(() => setIsLoading(false));
  }, []);

  const changeModel = (modelName?: string) => {
    if (!modelName) return;

    setIsLoading(true);
    apiClientStore.fetch('/api/v1/project-settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ llmModel: modelName }),
    })
      .then(() => setSelectedModel(modelName))
      .finally(() => setIsLoading(false));
  };

  return (
    <div>
      <SectionHeader title={t('aiProvider')} />

      <div className="max-w-sm p-4">
        <Select
          label={t('model')}
          onSelectionChange={(selection) => changeModel(selection.anchorKey)}
          isLoading={isLoading}
          selectedKeys={[selectedModel]}
          disabled={isLoading}
        >
          {AVAILABLE_MODELS.map((model) => (
            <SelectItem key={model}>{model}</SelectItem>
          ))}
        </Select>
      </div>
    </div>
  );
};
