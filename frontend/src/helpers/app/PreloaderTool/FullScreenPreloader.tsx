import React from 'react';
import ReactDOM from 'react-dom';
import { CircularProgress } from '@heroui/react';

const FullScreenPreloader: React.FC = () => ReactDOM.createPortal(
  <div className="absolute top-0 left-0 w-screen h-screen flex justify-center items-center
                        bg-main/20 backdrop-blur-sm z-[10000]"
  >
    <CircularProgress aria-label="loading..." />
  </div>,
  document.body,
);

FullScreenPreloader.displayName = 'FullScreenPreloader';

export default FullScreenPreloader;
