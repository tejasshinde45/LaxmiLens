import { CategoryId } from '../value-objects/Identifiers';

export type CategoryType = 'income' | 'expense';

export interface CategoryProps {
  id: CategoryId;
  name: string;
  type: CategoryType;
  parentId?: CategoryId;
  icon?: string;
  color?: string;
  isSystem: boolean;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export class Category {
  public readonly id: CategoryId;
  public readonly name: string;
  public readonly type: CategoryType;
  public readonly parentId?: CategoryId;
  public readonly icon?: string;
  public readonly color?: string;
  public readonly isSystem: boolean;
  public readonly version: number;
  public readonly createdAt: Date;
  public readonly updatedAt: Date;

  constructor(props: CategoryProps) {
    this.id = props.id;
    this.name = props.name;
    this.type = props.type;
    this.parentId = props.parentId;
    this.icon = props.icon;
    this.color = props.color;
    this.isSystem = props.isSystem;
    this.version = props.version;
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
    Object.freeze(this);
  }
}
