import React, { useState } from 'react';
import { useTranslations } from 'use-intl';
import { Button, Card, CardBody, CardHeader, Chip, Divider } from '@heroui/react';
import { ArrowPathIcon } from '@heroicons/react/24/outline';
import moment from 'moment';
import { SectionHeader } from '../components/SectionHeader';
import { SectionContent } from '../components/SectionContent';

const HealthCard: React.FC<{ title: string; status?: 'ok' | 'degraded' | 'down'; detail?: React.ReactNode }>
  = ({ title, status = 'ok', detail }) => {
    const color = status === 'ok' ? 'success' : status === 'degraded' ? 'warning' : 'danger';
    const label = status === 'ok' ? 'OK' : status === 'degraded' ? 'Degraded' : 'Down';
    return (
      <Card shadow="sm" className="border border-default-200">
        <CardHeader className="flex items-center justify-between">
          <div className="text-medium font-semibold">{title}</div>
          <Chip color={color} variant="flat" size="sm">{label}</Chip>
        </CardHeader>
        <Divider />
        <CardBody className="text-small text-default-600">
          {detail ?? '—'}
        </CardBody>
      </Card>
    );
  };

export const SystemSection: React.FC = () => {
  const t = useTranslations('SettingsPage');
  const tCommon = useTranslations('Common');

  // Placeholder data; will be wired to /api/v1/health later
  const [lastChecked] = useState(new Date());

  const refresh = async () => {/**/};

  React.useEffect(() => { void refresh(); }, []);

  return (
    <div>
      <SectionHeader title={t('settings')} />
      <SectionContent>
        <Card shadow="sm" className="border border-default-200 bg-default-50">
          <CardHeader className="flex items-center justify-between">
            <span className="text-title font-title text-xl font-medium">{t('healthStatus')}</span>

            <div>
              {lastChecked && (
                <span className="text-label text-xs mr-2">
                  {t('checkedAt', { lastCheckedAt: moment(lastChecked).fromNow() })}
                </span>
              )}
              <Button
                color="primary"
                onPress={refresh}
                startContent={<ArrowPathIcon className="size-4" />}
                size="sm"
              >
                {tCommon('refresh')}
              </Button>
            </div>
          </CardHeader>

          <CardBody className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <HealthCard title="API" status="ok" detail="Latency ~42ms" />
            <HealthCard title="Database" status="ok" />
            <HealthCard title="Queue / Workers" status="degraded" detail="Backlog: 123" />
            <HealthCard title="Vector Store / Embeddings" status="ok" />
            <HealthCard title="LLM Provider" status="ok" detail="OpenAI" />
            <HealthCard title="Webhooks" status="ok" />
            <HealthCard title="Versions" status="ok" detail={<span>UI v2 • Backend 1.12.3</span>} />
          </CardBody>
        </Card>
      </SectionContent>
    </div>
  );
};
