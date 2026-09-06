import type { UpdateCheckResponse, UpdateProgressEvent } from '@shared/types';
import { t, tx } from './i18n';

/**
 * Build the user-facing update line in the active language.
 *
 * The main process cannot call `t()` (the active language lives in the
 * renderer), so every `UpdateCheckResponse.message` it emits is Spanish source
 * text. The response is structured, though, so the renderer re-derives the
 * sentence from structured status and error codes. Provider/native errors stay
 * in the main-process log instead of leaking untranslated diagnostics to the UI.
 */
export function updateStatusMessage(update: UpdateCheckResponse): string {
  const version = update.version || '';
  switch (update.status) {
    case 'checking':
      return t('Buscando actualizaciones…');
    case 'available':
      return tx('Actualización {version} encontrada. La descarga empezará automáticamente.', { version });
    case 'downloading':
      return tx('Descargando actualización… {percent}%', {
        percent: Math.round(Math.max(0, Math.min(100, update.progress ?? 0))),
      });
    case 'downloaded':
      return tx('Actualización {version} lista. Puedes instalarla y reiniciar cuando quieras.', { version });
    case 'backing-up':
      return t('Creando y verificando una copia de seguridad antes de actualizar…');
    case 'installing':
      return tx('Instalando Nodus {version} y reiniciando…', { version });
    case 'not-available':
      return tx('Nodus {version} ya está actualizado.', { version });
    case 'disabled':
      return t('Las actualizaciones solo están disponibles en la app empaquetada.');
    case 'error':
      if (update.errorCode === 'pre-update-backup-required') {
        return t('Configura Recuperación antes de instalar una beta. La actualización permanece descargada y tus datos no se han modificado.');
      }
      if (update.errorCode === 'pre-update-backup-failed') {
        return t('La beta no se instaló porque no pudo crearse y verificarse la copia de seguridad previa. Tus datos no se han modificado.');
      }
      if (update.errorCode === 'update-install-failed') return t('No se pudo instalar la actualización. Puedes volver a intentarlo.');
      if (update.errorCode === 'update-install-incomplete') return t('La actualización anterior no llegó a instalarse. Busca actualizaciones para volver a intentarlo.');
      if (update.errorCode === 'update-download-failed') return t('No se pudo descargar la actualización. Comprueba tu conexión y vuelve a intentarlo.');
      return t('No se pudo comprobar si hay actualizaciones.');
    default:
      return update.message;
  }
}

export function pendingUpdateVersion(update: UpdateCheckResponse | null): string | null {
  return update?.downloadedVersion ?? (update?.status === 'downloaded' ? update.version ?? null : null);
}

export function updateInstallBusy(update: UpdateCheckResponse | null): boolean {
  return update?.status === 'backing-up' || update?.status === 'installing';
}

export function canInstallUpdate(update: UpdateCheckResponse | null): boolean {
  return Boolean(pendingUpdateVersion(update)) && !updateInstallBusy(update);
}

/** All entry points retain the downloaded candidate after an IPC/install failure. */
export async function installUpdateManually(update: UpdateCheckResponse | null): Promise<UpdateProgressEvent> {
  try {
    const result = await window.nodus.installUpdate();
    return { ...result, at: new Date().toISOString() };
  } catch {
    return { status: 'error', errorCode: 'update-install-failed', message: '',
      downloadedVersion: pendingUpdateVersion(update), version: update?.version, at: new Date().toISOString() };
  }
}
