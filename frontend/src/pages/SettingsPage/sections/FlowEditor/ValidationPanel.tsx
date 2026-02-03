import React from 'react';
import { Card, CardBody, CardHeader, Chip, Divider, ScrollShadow } from '@heroui/react';
import { observer } from 'mobx-react-lite';
import { useTranslations } from 'use-intl';
import { flowStore } from '../../../../stores/flowStore';
import type { GraphValidationIssue } from '../../../../stores/flowStore/validateGraph';

interface ValidationPanelProps {
  onSelect?: (stageSlug: string) => void;
}

export const ValidationPanel: React.FC<ValidationPanelProps> = observer(({ onSelect }) => {
  const t = useTranslations('FlowEditor');

  if (!flowStore.editorState) return null;

  const issues = flowStore.editorState.graphIssues;
  const levelColor = (lvl: GraphValidationIssue['type']) => lvl === 'error' ? 'danger' : 'warning';

  return (
    <Card shadow="sm" className="border border-default-200">
      <CardHeader className="flex items-center justify-between">
        <div className="text-small font-semibold">{t('validation')}</div>
        <Chip size="sm" variant="flat" color={issues.length ? 'warning' : 'success'}>{issues.length}</Chip>
      </CardHeader>

      <Divider />

      <CardBody className="p-0">
        {issues.length === 0 ? (
          <div className="p-3 text-tiny text-success" role="status" aria-live="polite">{t('noIssues')}</div>
        ) : (
          <ScrollShadow className="max-h-[240px]">
            <ul className="p-2">
              {issues.map((it) => (
                <li key={it.id} className="px-2 py-1.5 flex items-center gap-2 text-small">
                  <Chip size="sm" variant="flat" color={levelColor(it.type)}>{it.type}</Chip>
                  <span className="flex-1">{it.message}</span>
                  {it.stageSlug && typeof onSelect === 'function' && (
                    <button
                      className="text-tiny text-primary hover:underline"
                      onClick={() => onSelect?.(it.stageSlug!)}
                    >
                      {t('focus')}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </ScrollShadow>
        )}
      </CardBody>
    </Card>
  );
});
