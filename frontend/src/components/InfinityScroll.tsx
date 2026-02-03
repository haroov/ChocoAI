import React, { useEffect, useRef } from 'react';
import { CircularProgress } from '@heroui/react';
import classNames from '../helpers/classNames';

export interface InfinityScrollProps extends React.PropsWithChildren {
  loading: boolean;
  canLoadMore: boolean;
  onLoadMore: () => void;
  preloader?: React.ReactNode;
}

export const InfinityScroll: React.FC<InfinityScrollProps> = ({
  loading, canLoadMore, onLoadMore, children,
  preloader = <CircularProgress aria-label="loading..." />,
}) => {
  const observerBlockRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) onLoadMore();
    });

    if (observerBlockRef.current && !loading && canLoadMore) observer.observe(observerBlockRef.current);

    return () => observer.disconnect();
  }, [loading, canLoadMore, onLoadMore]);

  return (
    <>
      {children}
      {loading && preloader}
      <div className="w-full flex justify-center items-center">
        <div
          ref={observerBlockRef}
          className={classNames(
            'my-4',
            !loading && canLoadMore ? '' : 'hidden',
          )}
        />
      </div>
    </>
  );
};

InfinityScroll.displayName = 'InfinityScroll';
