import { type ReactNode } from 'react';
import { cn } from '@/utils/cn';

export interface SectionHeaderProps {
  title: string;
  description?: string;
  badge?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export const SectionHeader: React.FC<SectionHeaderProps> = ({
  title,
  description,
  badge,
  action,
  className
}) => {
  return (
    <div className={cn('flex items-center justify-between pb-3', className)}>
      <div className="space-y-0.5">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold tracking-tight text-[#F5F1E8] font-display">
            {title}
          </h2>
          {badge}
        </div>
        {description && <p className="text-xs text-[#858078]">{description}</p>}
      </div>
      {action && <div className="flex items-center gap-2">{action}</div>}
    </div>
  );
};
