import { Shield, Database, Palette, CircleDollarSign } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { APP_CONFIG } from '@/config/constants';
import { NotificationPreferencesSection } from '@/features/notifications/components/NotificationPreferencesSection';
import { BackupRestoreSection } from './components/BackupRestoreSection';
import { SyncStatusSettingsCard } from './components/SyncStatusSettingsCard';

export const SettingsPage: React.FC = () => {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="Preferences, currency configuration, offline local database parameters, and security."
      />

      <div className="space-y-4 max-w-4xl">
        {/* Financial Alert & Notification Preferences */}
        <NotificationPreferencesSection />

        {/* Encrypted Data Backup & Restore */}
        <BackupRestoreSection />

        {/* Automatic Cloud Synchronization Status & Manual Retry on Failure */}
        <SyncStatusSettingsCard />

        {/* Currency & Financial Configuration */}
        <Card variant="surface" className="space-y-4 p-5">
          <div className="flex items-center gap-2.5 text-sm font-semibold text-[#F5F1E8]">
            <CircleDollarSign className="h-4 w-4 text-[#D6AD60]" />
            <span>Currency & Numbering System</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs pt-1">
            <div className="space-y-1">
              <span className="text-[#858078]">Primary Currency</span>
              <div className="flex items-center gap-2 text-[#F5F1E8] font-medium">
                <span>Indian Rupee (INR)</span>
                <Badge variant="gold" size="sm">
                  {APP_CONFIG.currencySymbol}
                </Badge>
              </div>
            </div>

            <div className="space-y-1">
              <span className="text-[#858078]">Subunit Storage</span>
              <p className="text-[#F5F1E8] font-medium font-tabular">
                100 Paise per Rupee (Integer Storage)
              </p>
            </div>
          </div>
        </Card>

        {/* Visual Appearance & Theme */}
        <Card variant="surface" className="space-y-4 p-5">
          <div className="flex items-center gap-2.5 text-sm font-semibold text-[#F5F1E8]">
            <Palette className="h-4 w-4 text-[#D6AD60]" />
            <span>Theme & Typography</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs pt-1">
            <div className="space-y-1">
              <span className="text-[#858078]">Active Palette</span>
              <div className="flex items-center gap-2">
                <span className="h-3 w-3 rounded-full bg-[#101010] border border-[#D6AD60]" />
                <span className="text-[#F5F1E8] font-medium">Obsidian Gold (Dark-first)</span>
              </div>
            </div>

            <div className="space-y-1">
              <span className="text-[#858078]">Typography Stack</span>
              <p className="text-[#F5F1E8] font-medium">
                Manrope (Headings) + Inter (Body/UI)
              </p>
            </div>
          </div>
        </Card>

        {/* Local Storage & Offline Engine */}
        <Card variant="surface" className="space-y-4 p-5">
          <div className="flex items-center gap-2.5 text-sm font-semibold text-[#F5F1E8]">
            <Database className="h-4 w-4 text-[#72B895]" />
            <span>Offline Persistence Engine</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs pt-1">
            <div className="space-y-1">
              <span className="text-[#858078]">Client Datastore</span>
              <p className="text-[#F5F1E8] font-medium">
                Dexie.js / IndexedDB ({APP_CONFIG.database.name} v{APP_CONFIG.database.version})
              </p>
            </div>

            <div className="space-y-1">
              <span className="text-[#858078]">Outbox Sync Engine</span>
              <p className="text-[#F5F1E8] font-medium">
                Transactional Outbox with Idempotency Keys
              </p>
            </div>
          </div>
        </Card>

        {/* Security & Access Controls */}
        <Card variant="surface" className="space-y-4 p-5">
          <div className="flex items-center gap-2.5 text-sm font-semibold text-[#F5F1E8]">
            <Shield className="h-4 w-4 text-[#82A9CF]" />
            <span>Security & Zero-Trust Model</span>
          </div>

          <div className="space-y-2 text-xs text-[#B9B4AA] leading-relaxed pt-1">
            <p>
              Supabase public anonymous key active. Client application code strictly prohibits service-role keys.
              PostgreSQL Row Level Security (RLS) policies isolate all ledger entries by authenticated user UID.
            </p>
            <div className="flex items-center gap-2 pt-2">
              <Badge variant="neutral" size="sm">
                Single-User Mode
              </Badge>
              <Badge variant="neutral" size="sm">
                No Trackers
              </Badge>
              <Badge variant="neutral" size="sm">
                Local-First
              </Badge>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
};
