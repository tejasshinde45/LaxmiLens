import React from 'react';
import {
  Briefcase,
  Building2,
  TrendingUp,
  Laptop,
  Gift,
  PlusCircle,
  ShoppingCart,
  Utensils,
  Home,
  Zap,
  Car,
  Activity,
  ShoppingBag,
  Film,
  BookOpen,
  Smile,
  MinusCircle,
  Tag,
  type LucideIcon
} from 'lucide-react';

const ICON_MAP: Record<string, LucideIcon> = {
  Briefcase,
  Building2,
  TrendingUp,
  Laptop,
  Gift,
  PlusCircle,
  ShoppingCart,
  Utensils,
  Home,
  Zap,
  Car,
  Activity,
  ShoppingBag,
  Film,
  BookOpen,
  Smile,
  MinusCircle,
  Tag
};

export interface CategoryIconProps {
  name?: string;
  className?: string;
  color?: string;
}

export const CategoryIcon: React.FC<CategoryIconProps> = ({
  name,
  className = 'h-4 w-4',
  color
}) => {
  const IconComponent = (name && ICON_MAP[name]) || Tag;
  return <IconComponent className={className} style={color ? { color } : undefined} />;
};
