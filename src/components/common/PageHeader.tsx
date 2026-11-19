import { type ReactNode } from 'react';
import { cn } from '@/utils/cn';

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

export interface PageHeaderProps {
  title: string;
  description?: string;
  badge?: ReactNode;
  actions?: ReactNode;
  breadcrumbs?: BreadcrumbItem[];
  className?: string;
}

export const PageHeader: React.FC<PageHeaderProps> = ({
  title,
  description,
  badge,
  actions,
  breadcrumbs,
  className
}) => {
  return (
    <div
      className={cn(
        'flex flex-col gap-3 pb-6 md:flex-row md:items-end md:justify-between border-b border-[#303030]/60 mb-6',
        className
      )}
    >
      <div className="space-y-1">
        {breadcrumbs && breadcrumbs.length > 0 && (
          <nav aria-label="Breadcrumbs" className="flex items-center gap-1.5 text-xs text-[#858078] mb-1">
            {breadcrumbs.map((crumb, i) => (
              <span key={i} className="flex items-center gap-1.5">
                {i > 0 && <span className="text-[#454545]">/</span>}
                {crumb.href ? (
                  <a href={crumb.href} className="hover:text-[#B9B4AA] transition-colors">
                    {crumb.label}
                  </a>
                ) : (
                  <span className="text-[#B9B4AA]">{crumb.label}</span>
                )}
              </span>
            ))}
          </nav>
        )}
        <div className="flex items-center gap-2.5 flex-wrap">
          <h1 className="text-2xl font-bold tracking-tight text-[#F5F1E8] sm:text-3xl font-display">
            {title}
          </h1>
          {badge}
        </div>
        {description && <p className="text-sm text-[#B9B4AA] max-w-2xl">{description}</p>}
      </div>

      {actions && <div className="flex items-center gap-2.5 shrink-0 pt-2 md:pt-0">{actions}</div>}
    </div>
  );
};
