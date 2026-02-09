import React from 'react';

type SwimlaneViewProps = {
  steps: Array<{
    id: string;
    title: string;
    description?: string;
  }>;
  currentStepIndex: number;
};

// Minimal implementation for build-time correctness.
export const SwimlaneView: React.FC<SwimlaneViewProps> = ({ steps, currentStepIndex }) => (
  <div className="bg-white border border-gray-200 rounded-xl p-4">
    <div className="text-sm font-semibold mb-3">Swimlane (placeholder)</div>
    <ol className="space-y-2">
      {steps.map((s, idx) => (
        <li key={s.id} className="flex gap-2 text-sm">
          <span className="font-mono text-xs text-gray-500 w-10">{idx + 1}</span>
          <div className={idx === currentStepIndex ? 'font-semibold' : ''}>
            {s.title}
            {s.description ? <div className="text-xs text-gray-500">{s.description}</div> : null}
          </div>
        </li>
      ))}
    </ol>
  </div>
);

