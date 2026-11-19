import { type HTMLAttributes } from 'react';
import { cn } from '@/utils/cn';

export interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  variant?: 'rounded' | 'circular' | 'rectangular';
}

export const Skeleton: React.FC<SkeletonProps> = ({
  className,
  variant = 'rounded',
  ...props
}) => {
  const variants = {
    rounded: 'rounded-[10px]',
    circular: 'rounded-full',
    rectangular: 'rounded-none'
  };

  return (
    <div
      className={cn(
        'animate-pulse bg-[#242424] border border-[#303030]/50',
        variants[variant],
        className
      )}
      {...props}
    />
  );
};
