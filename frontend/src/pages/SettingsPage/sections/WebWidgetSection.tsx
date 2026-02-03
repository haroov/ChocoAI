import React, { useState } from 'react';
import { Card, CardBody, CardHeader, Divider, Textarea } from '@heroui/react';
import { useTranslations } from 'use-intl';
import { SectionHeader } from '../components/SectionHeader';
import { SectionContent } from '../components/SectionContent';
import { ChocoAIWidget } from '../../../components/ChocoAIWidget';
import classNames from '../../../helpers/classNames';

const Section: React.FC<React.PropsWithChildren<{
  title: string;
  className?: string;
  desc?: string;
  actions?: React.ReactNode
}>> = ({ title, className, desc, actions, children }) => (
  <Card shadow="sm" className={classNames('border border-default-200', className)}>
    <CardHeader className="flex items-start justify-between gap-4">
      <div>
        <div className="text-medium font-semibold">{title}</div>
        {desc && <div className="text-small text-default-500">{desc}</div>}
      </div>
      <div className="flex items-center gap-3">{actions}</div>
    </CardHeader>
    <Divider />
    <CardBody className="gap-4">
      {children}
    </CardBody>
  </Card>
);

export const WebWidgetSection: React.FC = () => {
  const t = useTranslations('SettingsPage');

  const [code, setCode] = useState([
    '<script src="https://www.chocoinsurance.com/web-widget/choco-ai-widget.js"',
    '        data-position="bottom-right"',
    '        async',
    '></script>',
  ].join('\n'));

  return (
    <div>
      <SectionHeader title={t('webWidget')} />
      <SectionContent>
        <div className="flex gap-4 items-start">
          <Section className="flex-1" title="Install" desc="Add the widget to your site">
            <Textarea
              className="font-mono"
              label="Embed code"
              value={code}
              onValueChange={setCode}
              minRows={4}
            />
            <div className="text-tiny text-default-500">Copy and paste before the closing body tag.</div>
          </Section>

          <Section title="Preview">
            <div className="flex justify-center items-center">
              <ChocoAIWidget
                config={{
                  rootUrl: document.location.origin,
                  position: 'bottom-right',
                  noWidgetButton: true,
                }}
                previewMode
              />
            </div>
          </Section>
        </div>
      </SectionContent>
    </div>
  );
};
