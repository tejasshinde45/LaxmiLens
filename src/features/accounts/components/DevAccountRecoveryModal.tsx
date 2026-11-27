import React, { useState } from 'react';
import { Wrench, CheckCircle, AlertTriangle, RefreshCw, XCircle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { toast } from 'sonner';
import { queryClient as globalQueryClient } from '@/lib/queryClient';
import {
  RecoverStaleAccountUseCase,
  RecoveryInspectionResult,
  RecoveryExecutionResult,
  TARGET_RECOVERY_ACCOUNT_ID
} from '@/application/use-cases/accounts/RecoverStaleAccountUseCase';

export const DevAccountRecoveryModal: React.FC = () => {
  // Strict guard: Never render or enable in production builds
  if (!import.meta.env.DEV) {
    return null;
  }

  const [isOpen, setIsOpen] = useState(false);
  const [accountId, setAccountId] = useState(TARGET_RECOVERY_ACCOUNT_ID);
  const [isInspecting, setIsInspecting] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [inspection, setInspection] = useState<RecoveryInspectionResult | null>(null);
  const [executionResult, setExecutionResult] = useState<RecoveryExecutionResult | null>(null);
  const [isConfirmed, setIsConfirmed] = useState(false);

  const recoveryUseCase = new RecoverStaleAccountUseCase();

  const handleInspect = async () => {
    setIsInspecting(true);
    setExecutionResult(null);
    try {
      const result = await recoveryUseCase.inspect(accountId.trim());
      setInspection(result);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Inspection failed.');
    } finally {
      setIsInspecting(false);
    }
  };

  const handleExecute = async () => {
    if (!isConfirmed) return;
    setIsExecuting(true);
    try {
      const result = await recoveryUseCase.execute(accountId.trim());
      setExecutionResult(result);
      globalQueryClient.invalidateQueries({ queryKey: ['accounts'] });
      globalQueryClient.invalidateQueries({ queryKey: ['accountSyncPendingCount'] });
      globalQueryClient.invalidateQueries({ queryKey: ['syncPendingCount'] });
      globalQueryClient.invalidateQueries({ queryKey: ['pendingOutboxEntries'] });
      toast.success(result.message);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Recovery execution failed.');
    } finally {
      setIsExecuting(false);
    }
  };

  return (
    <>
      <Button
        variant="gold-subtle"
        size="sm"
        leftIcon={<Wrench className="h-3.5 w-3.5" />}
        onClick={() => {
          setIsOpen(true);
          void handleInspect();
        }}
        title="Development recovery utility for stale accounts"
      >
        Dev Recovery
      </Button>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="max-w-2xl bg-[#161616] border-[#303030] text-[#F5F1E8]">
          <DialogHeader>
            <div className="flex items-center gap-2">
              <Badge variant="warning" size="sm">
                DEV ONLY
              </Badge>
              <DialogTitle className="text-base text-[#F5F1E8] font-semibold">
                Controlled Account Lifecycle Recovery
              </DialogTitle>
            </div>
            <DialogDescription className="text-xs text-[#858078] mt-1">
              Reconciles local IndexedDB state with confirmed Supabase cloud state (v3, archived)
              and purges stale restore outbox records without touching unrelated accounts.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-3 text-xs">
            {/* Target Account Input */}
            <div>
              <label htmlFor="recovery-account-id" className="text-[11px] font-medium text-[#B9B4AA] block mb-1">
                Target Account UUID
              </label>
              <div className="flex gap-2">
                <input
                  id="recovery-account-id"
                  type="text"
                  value={accountId}
                  onChange={(e) => setAccountId(e.target.value)}
                  className="flex-1 bg-[#101010] border border-[#303030] rounded-lg px-3 py-1.5 font-mono text-xs text-[#F5F1E8] focus-visible:border-[#D6AD60] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#D6AD60]"
                />
                <Button
                  variant="outline"
                  size="sm"
                  leftIcon={<RefreshCw className={isInspecting ? 'animate-spin' : ''} />}
                  onClick={handleInspect}
                  disabled={isInspecting || isExecuting}
                >
                  Inspect
                </Button>
              </div>
            </div>

            {/* Inspection Results */}
            {inspection && (
              <Card variant="surface" className="p-3.5 space-y-3 bg-[#1B1B1B] border-[#303030]">
                <div className="grid grid-cols-2 gap-3">
                  {/* Cloud State */}
                  <div className="space-y-1">
                    <span className="text-[11px] font-medium text-[#858078]">Supabase Cloud State</span>
                    <div className="bg-[#101010] p-2.5 rounded border border-[#262626] font-mono text-[11px]">
                      <div>Name: <span className="text-[#F5F1E8]">{inspection.cloud.name}</span></div>
                      <div>is_archived: <span className="text-[#E4B66D]">{String(inspection.cloud.isArchived)}</span></div>
                      <div>version: <span className="text-[#72B895]">{inspection.cloud.version}</span></div>
                    </div>
                  </div>

                  {/* Local State */}
                  <div className="space-y-1">
                    <span className="text-[11px] font-medium text-[#858078]">Local IndexedDB State</span>
                    <div className="bg-[#101010] p-2.5 rounded border border-[#262626] font-mono text-[11px]">
                      {inspection.local ? (
                        <>
                          <div>Name: <span className="text-[#F5F1E8]">{inspection.local.name}</span></div>
                          <div>isArchived: <span className={inspection.local.isArchived ? 'text-[#E4B66D]' : 'text-[#82A9CF]'}>{String(inspection.local.isArchived)}</span></div>
                          <div>version: <span className="text-[#72B895]">{inspection.local.version}</span></div>
                        </>
                      ) : (
                        <div className="text-[#D9827C]">Not Found</div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Outbox Status */}
                <div className="pt-2 border-t border-[#2A2A2A]">
                  <span className="text-[11px] font-medium text-[#858078] block mb-1">
                    Pending Outbox Records for this Account ({inspection.pendingOutboxRecords.length})
                  </span>
                  {inspection.pendingOutboxRecords.length === 0 ? (
                    <div className="text-[#858078] italic">No pending outbox records.</div>
                  ) : (
                    <div className="space-y-1">
                      {inspection.pendingOutboxRecords.map((r) => (
                        <div
                          key={r.id}
                          className="bg-[#101010] px-2.5 py-1.5 rounded border border-[#262626] flex items-center justify-between text-[11px]"
                        >
                          <span className="font-mono text-[#D6AD60]">Record #{r.id}</span>
                          <span>Op: {r.operation}</span>
                          <span>is_archived: {String(r.payload?.is_archived)}</span>
                          <span>version: {String(r.payload?.version)}</span>
                          {r === inspection.staleRestoreRecord && (
                            <Badge variant="warning" size="sm">
                              Stale Restore
                            </Badge>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Status Evaluation */}
                <div className="pt-2 border-t border-[#2A2A2A] flex items-center gap-2">
                  {inspection.isAlreadyRecovered ? (
                    <>
                      <CheckCircle className="h-4 w-4 text-[#72B895] shrink-0" />
                      <span className="text-[#72B895]">Account is already in harmony with cloud (v3, archived).</span>
                    </>
                  ) : inspection.canRecover ? (
                    <>
                      <AlertTriangle className="h-4 w-4 text-[#E4B66D] shrink-0" />
                      <span className="text-[#E4B66D]">Stale state confirmed. Ready for safe recovery.</span>
                    </>
                  ) : (
                    <>
                      <XCircle className="h-4 w-4 text-[#D9827C] shrink-0" />
                      <span className="text-[#D9827C]">{inspection.blockReason}</span>
                    </>
                  )}
                </div>
              </Card>
            )}

            {/* Execution Before/After Summary */}
            {executionResult && (
              <Card variant="surface" className="p-3.5 space-y-2 bg-[#12281D]/40 border-[#72B895]/30">
                <div className="flex items-center gap-2 text-[#72B895] font-semibold">
                  <CheckCircle className="h-4 w-4" />
                  <span>Recovery Successfully Executed</span>
                </div>
                <div className="font-mono text-[11px] text-[#F5F1E8] space-y-1">
                  <div>Local State: isArchived = {String(executionResult.after.local.isArchived)}, version = {executionResult.after.local.version}</div>
                  {executionResult.after.deletedOutboxRecordId && (
                    <div className="text-[#72B895]">Deleted Outbox Record: #{executionResult.after.deletedOutboxRecordId}</div>
                  )}
                  <div>Remaining Outbox Count: {executionResult.after.remainingOutboxCount}</div>
                </div>
              </Card>
            )}

            {/* Confirmation Checkbox */}
            {inspection?.canRecover && !inspection.isAlreadyRecovered && !executionResult && (
              <div className="pt-2 flex items-start gap-2 bg-[#1A1A1A] p-2.5 rounded border border-[#303030]">
                <input
                  type="checkbox"
                  id="confirm-recovery"
                  checked={isConfirmed}
                  onChange={(e) => setIsConfirmed(e.target.checked)}
                  className="mt-0.5 accent-[#D6AD60]"
                />
                <label htmlFor="confirm-recovery" className="text-xs text-[#B9B4AA] cursor-pointer">
                  I confirm that I want to update the local account to version 3 (archived) and purge the stale restore event #{inspection.staleRestoreRecord?.id}.
                </label>
              </div>
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsOpen(false)}
            >
              Close
            </Button>
            {inspection?.canRecover && !inspection.isAlreadyRecovered && !executionResult && (
              <Button
                variant="primary"
                size="sm"
                onClick={handleExecute}
                disabled={!isConfirmed || isExecuting}
                isLoading={isExecuting}
              >
                Execute Recovery
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
