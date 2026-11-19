import { ProfileRepository } from '@/domain/repositories/ProfileRepository';
import { Profile } from '@/domain/entities/Profile';
import { UserId, createUserId } from '@/domain/value-objects/Identifiers';
import { db, LaxmiLensDB } from '../DexieDatabase';
import { LocalProfileRecord } from '../schema';

export class DexieProfileRepository implements ProfileRepository {
  constructor(private readonly database: LaxmiLensDB = db) {}

  public async findById(id: UserId): Promise<Profile | null> {
    const record = await this.database.profiles.get(id);
    return record ? this.toDomain(record) : null;
  }

  public async save(profile: Profile): Promise<void> {
    const record: LocalProfileRecord = {
      id: profile.id,
      email: profile.email,
      displayName: profile.displayName,
      currency: profile.currency,
      createdAt: profile.createdAt.toISOString(),
      updatedAt: profile.updatedAt.toISOString()
    };
    await this.database.profiles.put(record);
  }

  private toDomain(record: LocalProfileRecord): Profile {
    return new Profile({
      id: createUserId(record.id),
      email: record.email,
      displayName: record.displayName,
      currency: record.currency,
      createdAt: new Date(record.createdAt),
      updatedAt: new Date(record.updatedAt)
    });
  }
}
