/* eslint-disable */
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Progress } from '@heroui/react';
import { PlayIcon, ArrowPathIcon, ChevronLeftIcon, ChevronRightIcon, BoltIcon } from '@heroicons/react/24/solid';
import { apiClientStore } from '../../stores/apiClientStore';
import { conversationStore } from '../../stores/conversationStore';
import { useMainLayout } from '../../layouts/MainLayout';
import { STORIES } from './data/storyData';
import { StorySelector } from './components/StorySelector';
import { SwimlaneView } from './components/SwimlaneView';

export const QAPage: React.FC = () => {
  useMainLayout({ title: 'QA Dashboard' }); // Simplified title
  const navigate = useNavigate();

  const [activeStoryId, setActiveStoryId] = useState<string>('1');
  const [currentStep, setCurrentStep] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [loadingTest, setLoadingTest] = useState(false);

  const activeStory = STORIES.find((s) => s.id === activeStoryId) || STORIES[0];
  const totalSteps = activeStory.steps.length;

  // Reset step when story changes
  useEffect(() => {
    setCurrentStep(0);
    setIsPlaying(false);
  }, [activeStoryId]);

  // Auto-play logic
  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (isPlaying) {
      timer = setInterval(() => {
        setCurrentStep((prev) => {
          if (prev >= totalSteps - 1) {
            setIsPlaying(false);
            return prev;
          }
          return prev + 1;
        });
      }, 1000); // 1.5s per step
    }
    return () => clearInterval(timer);
  }, [isPlaying, totalSteps]);

  const runLiveTest = async () => {
    setLoadingTest(true);
    try {
      const res = await apiClientStore.fetch('/api/v1/conversations/new', { method: 'POST' }).then((r) => r.json());
      if (!res.ok) throw res;

      const newId = res.conversation.id;
      navigate(`/conversations/${newId}`);

      setTimeout(() => {
        conversationStore.sendMessage(newId, activeStory.initialPrompt);
      }, 600);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingTest(false);
    }
  };

  return (
    <div className="p-6 max-w-[1600px] mx-auto min-h-screen bg-gray-50/50">
      {/* Header Area */}
      <div className="mb-6 flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">ChocoAI V1 Swimlane Diagram</h1>
          <p className="text-gray-500 mt-1">
            Interactive visualization of
            {STORIES.length}
            {' '}
            user journey flows
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="flat"
            color="default"
            size="sm"
            onPress={() => navigate('/qa/bugs')}
            className="text-gray-600 bg-white shadow-sm border border-gray-200"
          >
            🐛 Bug Reports
          </Button>
          <Button
            variant="flat"
            color="default"
            size="sm"
            onPress={() => navigate('/qa/wiki')}
            className="text-gray-600 bg-white shadow-sm border border-gray-200"
          >
            Test Plan Wiki
          </Button>
        </div>
      </div>

      {/* Story Selection */}
      <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 mb-6">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-semibold">Select a User Story</h3>
          <div className="flex gap-2">
            <Button
              color="primary"
              variant="flat"
              size="sm"
              startContent={<BoltIcon className="size-4" />}
              isLoading={loadingTest}
              onPress={runLiveTest}
            >
              Run Live Test
            </Button>
            <Button
              isIconOnly
              size="sm"
              variant="light"
              onPress={() => setIsPlaying(!isPlaying)}
            >
              {isPlaying ? <span className="font-bold text-xs uppercase">Pause</span> : <PlayIcon className="size-4" />}
            </Button>
            <Button
              isIconOnly
              size="sm"
              variant="light"
              onPress={() => { setCurrentStep(0); setIsPlaying(false); }}
            >
              <ArrowPathIcon className="size-4" />
            </Button>
          </div>
        </div>
        <StorySelector
          stories={STORIES}
          selectedId={activeStoryId}
          onSelect={setActiveStoryId}
        />

        {/* Story Background */}
        <div className="mt-4 p-4 bg-[#882DD7]/10 rounded-lg border border-[#882DD7]/20 flex gap-3 items-start">
          <div className="text-[#882DD7] mt-0.5">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <h4 className="text-sm font-semibold text-[#2b0a4a] mb-1">Testing Scenario</h4>
            <p className="text-sm text-[#2b0a4a]/90 leading-relaxed">{activeStory.background}</p>
          </div>
        </div>
      </div>

      {/* Progress Bar & Controls */}
      <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 mb-6 flex items-center gap-4 sticky top-4 z-10 backdrop-blur-md bg-white/90">
        <span className="text-sm font-semibold text-gray-500 whitespace-nowrap">Flow Progress</span>
        <Progress
          value={(currentStep / (totalSteps - 1)) * 100}
          color="primary"
          size="sm"
          className="flex-1"
        />
        <span className="text-xs font-mono text-gray-500 whitespace-nowrap">
          Step
          {' '}
          {currentStep + 1}
          {' '}
          of
          {totalSteps}
        </span>

        <div className="flex gap-1">
          <Button
            isIconOnly
            size="sm"
            variant="bordered"
            isDisabled={currentStep === 0}
            onPress={() => { setCurrentStep((p) => Math.max(0, p - 1)); setIsPlaying(false); }}
          >
            <ChevronLeftIcon className="size-3" />
          </Button>
          <Button
            isIconOnly
            size="sm"
            variant="bordered"
            isDisabled={currentStep >= totalSteps - 1}
            onPress={() => { setCurrentStep((p) => Math.min(totalSteps - 1, p + 1)); setIsPlaying(false); }}
          >
            <ChevronRightIcon className="size-3" />
          </Button>
        </div>
      </div>

      {/* Main Visualization */}
      <SwimlaneView
        steps={activeStory.steps}
        currentStepIndex={currentStep}
      />
    </div>
  );
};
