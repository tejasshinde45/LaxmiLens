import { UserId } from '../value-objects/Identifiers';
import { Profile } from '../entities/Profile';

export interface ProfileRepository {
  findById(id: UserId): Promise<Profile | null>;
  save(profile: Profile): Promise<void>;
}
