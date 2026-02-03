import React from 'react';
import { Button } from '@heroui/react';
import { StoryData } from '../data/storyData';

interface StorySelectorProps {
    stories: StoryData[];
    selectedId: string;
    onSelect: (id: string) => void;
}

export const StorySelector: React.FC<StorySelectorProps> = ({ stories, selectedId, onSelect }) => (
  <div className="flex flex-wrap gap-2 mb-6">
    {stories.map((story) => (
      <Button
        key={story.id}
        size="sm"
        variant={selectedId === story.id ? 'solid' : 'bordered'}
        color="primary"
        onPress={() => onSelect(story.id)}
        className={selectedId === story.id ? 'font-semibold' : 'text-gray-600'}
      >
        {story.name}
      </Button>
    ))}
  </div>
);
