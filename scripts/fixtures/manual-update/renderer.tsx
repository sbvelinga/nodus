import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { AppLanguage, AppSettings, UpdateProgressEvent } from '../../../shared/types';
import { StartupUpdateModal } from '../../../src/components/StartupUpdateModal';
import { UpdateReadyNotice } from '../../../src/components/UpdateReadyNotice';
import { useUpdateProgress } from '../../../src/useUpdateProgress';
import { canInstallUpdate, installUpdateManually, pendingUpdateVersion, updateStatusMessage } from '../../../src/updateStatus';
import { setActiveLang, t } from '../../../src/i18n';

const f = window as unknown as { config: { initial: UpdateProgressEvent | null; lang: AppLanguage; startup?: boolean; holdSnapshot?: boolean }; emit: (event: UpdateProgressEvent) => void; snapshot: UpdateProgressEvent | null; resolveSnapshot: (value: UpdateProgressEvent | null) => void; installs: number; throwInstall: boolean; finishInstall: (value: UpdateProgressEvent) => void };
setActiveLang(f.config.lang ?? 'es');
f.snapshot = f.config.initial; f.installs = 0; f.throwInstall = false;
const listeners = new Set<(event: UpdateProgressEvent) => void>();
f.emit = (event) => { f.snapshot = event; listeners.forEach((fn) => fn(event)); };
window.nodus = {
  getUpdateStatus: () => f.config.holdSnapshot ? new Promise((resolve) => { f.resolveSnapshot = resolve; }) : Promise.resolve(f.snapshot),
  onUpdateProgress: (fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
  checkForUpdates: async () => f.snapshot ?? { status: 'not-available', message: '', version: '5.1.7' },
  installUpdate: async () => {
    f.installs++;
    if (f.throwInstall) throw new Error('Untranslated native error');
    f.emit({ ...f.snapshot!, status: 'backing-up', at: new Date().toISOString() });
    return new Promise((resolve) => { f.finishInstall = (result) => { f.emit(result); resolve(result); }; });
  },
} as unknown as typeof window.nodus;
const settings = { uiLanguage: f.config.lang, reduceMotion: true, nodiStyle: 'orb', mascotEnabled: false } as AppSettings;

function SettingsSubscriber() {
  const [progress, setProgress] = useUpdateProgress();
  return <section data-testid="settings-status"><p>{progress && updateStatusMessage(progress)}</p>{canInstallUpdate(progress) && <button onClick={() => void installUpdateManually(progress).then(setProgress)}>{t('Instalar y reiniciar')}</button>}</section>;
}
function Fixture() {
  const [update, setUpdate] = useUpdateProgress();
  const [settled, setSettled] = useState(!f.config.startup);
  const [deferred, setDeferred] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const version = pendingUpdateVersion(update);
  const key = version ? `${version}${update?.errorCode ?? ''}` : null;
  return <div className="h-full flex flex-col">
    <header className="flex items-center gap-4 p-3 border-b border-neutral-800">
      <b>Nodus · {t('Actualizaciones')}</b>
      {version && <button data-testid="update-indicator" onClick={() => setDeferred(null)}>{t('Actualización lista')}</button>}
      <button data-testid="settings-toggle" onClick={() => setSettingsOpen(!settingsOpen)}>{t('Ajustes')}</button>
    </header>
    {settled && update && key && key !== deferred && <UpdateReadyNotice update={update} onUpdate={setUpdate} onLater={() => setDeferred(key)} onRecovery={() => setSettingsOpen(true)} />}
    <main className="flex-1 p-8"><label>{t('Notas')}<textarea data-testid="working-document" className="input block mt-2 h-40 w-full" defaultValue="Documento de ejemplo: se puede seguir trabajando durante la descarga." /></label>{settingsOpen && <SettingsSubscriber />}</main>
    {!settled && <StartupUpdateModal settings={settings} activeVaultType="academic" onSettled={() => setSettled(true)} onDefer={setDeferred} />}
  </div>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
