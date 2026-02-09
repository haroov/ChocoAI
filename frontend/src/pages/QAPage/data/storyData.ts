export type StoryStep = {
  id: string;
  title: string;
  description?: string;
};

export type StoryData = {
  id: string;
  name: string;
  background: string;
  initialPrompt: string;
  steps: StoryStep[];
};

// Minimal dataset to keep QA page compilable.
export const STORIES: StoryData[] = [
  {
    id: '1',
    name: 'Happy path (minimal)',
    background: 'A minimal QA scenario to validate the UI compiles.',
    initialPrompt: 'Hello',
    steps: [
      { id: 's1', title: 'Start', description: 'User starts a conversation' },
      { id: 's2', title: 'Reply', description: 'Assistant responds' },
    ],
  },
];

