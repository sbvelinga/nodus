import { useState } from 'react';
import type { UpdateProgressEvent } from '@shared/types';
import { canInstallUpdate, installUpdateManually, updateInstallBusy, updateStatusMessage } from '../updateStatus';
import { t } from '../i18n';
import { Icon } from './ui';

/** An in-flow banner leaves the workspace usable, including native browser views. */
export function UpdateReadyNotice({ update, onUpdate, onLater, onRecovery }: {
  update: UpdateProgressEvent;
  onUpdate: (update: UpdateProgressEvent) => void;
  onLater: () => void;
  onRecovery: () => void;
}) {
  const [requesting, setRequesting] = useState(false);
  const busy = requesting || updateInstallBusy(update);
  const needsRecovery = update.errorCode === 'pre-update-backup-required' || update.errorCode === 'pre-update-backup-failed';
  const install = async () => {
    if (busy) return;
    setRequesting(true);
    onUpdate(await installUpdateManually(update));
    setRequesting(false);
  };
  return <aside data-testid="update-ready-notice" aria-label={t('Actualizaciones')} className="flex shrink-0 flex-wrap items-center gap-3 border-b border-indigo-200 bg-indigo-50 px-4 py-2 text-sm text-neutral-900 dark:border-indigo-800 dark:bg-neutral-900 dark:text-neutral-100">
    <Icon name={update.status === 'error' ? 'alert' : 'download'} size={17} />
    <p className="min-w-48 flex-1 text-xs" role="status">{updateStatusMessage(update)}</p>
    {needsRecovery && <button className="btn btn-ghost text-xs" onClick={onRecovery}>{t('Configurar Recuperación')}</button>}
    {canInstallUpdate(update) && <button className="btn btn-primary text-xs" disabled={busy} onClick={() => void install()}>{t('Instalar y reiniciar')}</button>}
    {!busy && <button className="btn btn-ghost text-xs" onClick={onLater}>{t('Más tarde')}</button>}
  </aside>;
}
