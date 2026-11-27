import { type LucideIcon } from 'lucide-react';
import { NavLink, useMatch, useResolvedPath } from 'react-router-dom';
import { Tooltip } from '@/components/ui/Tooltip';
import { cn } from '@/utils/cn';

export interface NavigationItemProps {
  label: string;
  to: string;
  icon: LucideIcon;
  badge?: string | number;
  isCollapsed?: boolean;
  onClick?: () => void;
}

export const NavigationItem: React.FC<NavigationItemProps> = ({
  label,
  to,
  icon: Icon,
  badge,
  isCollapsed = false,
  onClick
}) => {
  const collapsedAccessibleLabel =
    badge !== undefined ? `${label} (${badge})` : label;

  // Compute active state eagerly as a plain class string so Radix Tooltip's
  // Trigger (asChild / Slot) never coerces NavLink's callback className into source text.
  const resolved = useResolvedPath(to);
  const match = useMatch({ path: resolved.pathname, end: false });
  const isActive = Boolean(match);

  const linkClassName = cn(
    'group relative flex items-center rounded-[10px] text-xs font-medium transition-colors duration-150 select-none cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D6AD60]',
    isCollapsed ? 'h-10 w-10 justify-center p-0 mx-auto gap-0' : 'h-10 px-3 w-full gap-3',
    isActive
      ? isCollapsed
        ? 'bg-[#D6AD60]/15 text-[#D6AD60] border border-[#D6AD60]/30'
        : 'bg-[#D6AD60]/12 text-[#D6AD60] font-semibold border border-[#D6AD60]/25 shadow-sm shadow-[#D6AD60]/5'
      : isCollapsed
      ? 'text-[#858078] hover:bg-[#1E1E1E] hover:text-[#F5F1E8] border border-transparent'
      : 'text-[#B9B4AA] hover:bg-[#242424] hover:text-[#F5F1E8] border border-transparent'
  );

  const content = (
    <NavLink
      to={to}
      onClick={onClick}
      aria-label={isCollapsed ? collapsedAccessibleLabel : undefined}
      className={linkClassName}
    >
      <Icon
        aria-hidden="true"
        className={cn(
          'h-[18px] w-[18px] shrink-0 transition-colors',
          isActive ? 'text-[#D6AD60]' : 'text-[#858078] group-hover:text-[#F5F1E8]'
        )}
      />

      {!isCollapsed && <span className="truncate flex-1">{label}</span>}

      {!isCollapsed && badge !== undefined && (
        <span
          className={cn(
            'ml-auto rounded-full px-2 py-0.5 text-[10px] font-bold font-tabular tracking-wide',
            isActive
              ? 'bg-[#D6AD60]/20 text-[#D6AD60]'
              : 'bg-[#242424] text-[#858078] group-hover:text-[#B9B4AA]'
          )}
        >
          {badge}
        </span>
      )}
    </NavLink>
  );

  if (isCollapsed) {
    return (
      <Tooltip content={label} side="right">
        {content}
      </Tooltip>
    );
  }

  return content;
};
