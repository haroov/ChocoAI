/* eslint-disable max-len */
import React, { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Step, Lane } from '../data/storyData';

interface SwimlaneViewProps {
  steps: Step[];
  currentStepIndex: number;
}

const LANES: Lane[] = ['User', 'Agent', 'Flow', 'API', 'Data'];

// Light theme colors with high contrast
const LANE_STYLES: Record<Lane, { bg: string, border: string, text: string, badge: string }> = {
  User: { bg: 'bg-[#882DD7]/10', border: 'border-[#882DD7]/20', text: 'text-[#2b0a4a]', badge: 'bg-[#882DD7]/15 text-[#882DD7]' },
  Agent: { bg: 'bg-purple-50', border: 'border-purple-200', text: 'text-purple-900', badge: 'bg-purple-100 text-purple-700' },
  Flow: { bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-900', badge: 'bg-emerald-100 text-emerald-700' },
  API: { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-900', badge: 'bg-amber-100 text-amber-700' },
  Data: { bg: 'bg-violet-50', border: 'border-violet-200', text: 'text-violet-900', badge: 'bg-violet-100 text-violet-700' },
};

export const SwimlaneView: React.FC<SwimlaneViewProps> = ({ steps, currentStepIndex }) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to the active step horizontally
  useEffect(() => {
    if (scrollContainerRef.current) {
      const stepWidth = 280; // approx width of a step column + gap
      const targetScroll = currentStepIndex * stepWidth;
      scrollContainerRef.current.scrollTo({
        left: targetScroll,
        behavior: 'smooth',
      });
    }
  }, [currentStepIndex]);

  return (
    <div className="w-full bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden flex flex-col h-[850px]">
      <div className="flex flex-1 overflow-hidden">
        {/* Fixed Left Column: Lane Headers */}
        <div className="w-32 flex-shrink-0 bg-gray-50 border-r border-gray-200 flex flex-col z-20 shadow-sm">
          {LANES.map((lane) => (
            <div key={lane} className="flex-1 flex items-center justify-center p-2 border-b border-gray-100 last:border-b-0 min-h-[150px]">
              <span className={`px-2 py-1 rounded-md text-xs font-bold uppercase tracking-wider ${LANE_STYLES[lane].badge}`}>
                {lane}
              </span>
            </div>
          ))}
        </div>

        {/* Scrollable Horizontal Area */}
        <div
          ref={scrollContainerRef}
          className="flex-1 overflow-x-auto overflow-y-hidden relative bg-slate-50/30"
        >
          {/* Background Horizontal Lines (Row Dividers) */}
          <div className="absolute inset-0 flex flex-col min-w-full pointer-events-none">
            {LANES.map((_, i) => (
              <div key={i} className="flex-1 border-b border-gray-100 last:border-b-0 min-h-[150px] w-[5000px]" />
            ))}
          </div>

          {/* Steps Container */}
          <div
            className="relative h-full"
            style={{
              width: `${Math.max(100, steps.length * 280)}px`, // Dynamic width based on steps
              display: 'grid',
              gridTemplateRows: `repeat(${LANES.length}, 1fr)`,
              gridTemplateColumns: `repeat(${steps.length}, 280px)`,
            }}
          >
            {/* Connecting Line (SVG Overlay) */}
            <svg className="absolute inset-0 w-full h-full pointer-events-none z-0" style={{ overflow: 'visible' }}>
              <path
                d={steps.map((_, i) => {
                  if (i === 0) return '';
                  // X: Col index * 280 + 140 (center of col)
                  // Y: Row index * 100% / 5 + half-row-height... hard to do % in SVG path easily without fixed heights.
                  // Let's rely on flex/grid sizing. Assuming approx 120px row height for calculation or relative.
                  // Better approach: Drawing lines in React is tricky with responsive heights.
                  // Simplified: Just horizontal connector if same lane, diagonal if different.
                  return ''; // Skipping complex SVG line drawing for now to prioritize layout stability.
                }).join(' ')}
                fill="none"
                stroke="#CBD5E1"
                strokeWidth="2"
                strokeDasharray="6 4"
              />
            </svg>

            <AnimatePresence>
              {steps.map((step, index) => {
                const laneIndex = LANES.indexOf(step.lane);
                const isFuture = index > currentStepIndex;
                const isActive = index === currentStepIndex;

                // If progressive rendering is strict:
                if (isFuture) return null;

                return (
                  <motion.div
                    key={step.id}
                    layout
                    initial={{ opacity: 0, x: 50, scale: 0.9 }}
                    animate={{
                      opacity: isActive ? 1 : 0.7,
                      x: 0,
                      scale: isActive ? 1 : 0.95,
                      filter: isActive ? 'none' : 'grayscale(0.5)',
                    }}
                    transition={{ type: 'spring', stiffness: 200, damping: 20 }}
                    className="relative p-4 flex items-center justify-center h-full"
                    style={{
                      gridRow: laneIndex + 1,
                      gridColumn: index + 1,
                    }}
                  >
                    {/* Connector Line to previous */}
                    {index > 0 && (
                      <div className="absolute left-0 top-1/2 w-full h-[2px] bg-gray-300 -translate-x-1/2 -z-10 hidden md:block" />
                    )}

                    <div
                      className={`
                                                w-60 p-4 rounded-xl border shadow-sm transition-all duration-300 bg-white z-10
                                                ${LANE_STYLES[step.lane].border}
                                                ${isActive ? 'ring-2 ring-offset-2 ring-[#882DD7] shadow-lg scale-105' : 'hover:scale-105 hover:shadow-md'}
                                            `}
                    >
                      <div className="flex justify-between items-center mb-2">
                        <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${LANE_STYLES[step.lane].bg} ${LANE_STYLES[step.lane].text}`}>
                          Step
                          {' '}
                          {step.id}
                        </span>
                        {isActive && (
                          <span className="flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-2 w-2 rounded-full bg-[#882DD7]/70 opacity-75" />
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-[#882DD7]" />
                          </span>
                        )}
                      </div>

                      <h3 className="text-sm font-bold text-gray-900 mb-1 leading-tight line-clamp-2">
                        {step.title}
                      </h3>
                      <p className="text-xs text-gray-500 leading-relaxed font-medium line-clamp-3">
                        {step.description}
                      </p>

                      {step.details && isActive && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          className="mt-2 pt-2 border-t border-gray-100"
                        >
                          <p className="text-[10px] font-mono text-gray-400 truncate">
                            {step.details}
                          </p>
                        </motion.div>
                      )}
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  );
};
