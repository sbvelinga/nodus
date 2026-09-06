import { useEffect, useState } from 'react';
import { subscribeBackgroundJobs, type AnyJob } from './backgroundJobs';
import type { OcrDocProgress } from '@shared/aiOcrTypes';
import type { DeepResearchJobRecord, DocumentIndexProgress, EmbeddingPipelineProgress, PassageEmbeddingProgress, QueueProgress } from '@shared/types';
import type { DictionaryProgress } from '@shared/dictionary';
import type { LibraryExtractionJob, ZoteroImportProgress } from '@shared/libraryTypes';

export const DOCUMENT_LIVE = new Set(['queued', 'running', 'paused']);
export const ZOTERO_FINISHED = new Set(['complete', 'canceled', 'failed']);
export const DICTIONARY_FINISHED = new Set(['done', 'degraded', 'failed']);
export const embeddingVisible = (p: EmbeddingPipelineProgress | null) => Boolean(p && (p.running || p.paused || p.cancelled || p.totalIdeas > 0 || p.error));
export const passageVisible = (p: PassageEmbeddingProgress | null) => Boolean(p && (p.running || p.paused || p.cancelled || p.totalPassages > 0 || p.error));

interface QueueSnapshot {
  queue: QueueProgress | null;
  zotero: ZoteroImportProgress | null;
  documents: DocumentIndexProgress | null;
  embeddings: EmbeddingPipelineProgress | null;
  passages: PassageEmbeddingProgress | null;
  extraction: (LibraryExtractionJob & { message?: string })[];
  research: DeepResearchJobRecord[];
  dictionary: DictionaryProgress[];
  background: AnyJob[];
  ocr: (OcrDocProgress & { id: string; name?: string })[];
}
export function backgroundFailure(job: AnyJob): string | number | null {
  if (job.error) return job.error;
  if (!job.result || typeof job.result !== 'object') return null;
  const result = job.result as Record<string, unknown>;
  if (typeof result.saveError === 'string') return result.saveError;
  if (typeof result.failed === 'number' && result.failed > 0) return result.failed;
  if (Array.isArray(result.files)) {
    const failed = result.files.filter((file: { error?: unknown }) => file.error);
    if (failed.length) return failed.length;
  }
  return null;
}
const activeFirst = (a: boolean, b: boolean) => Number(b) - Number(a);
const EMPTY: QueueSnapshot = { queue: null, zotero: null, documents: null, embeddings: null, passages: null, extraction: [], research: [], dictionary: [], background: [], ocr: [] };

/** One owner for all progress: closing the dropdown never drops an event. */
export function useQueueActivity() {
  const [snapshot, setSnapshot] = useState<QueueSnapshot>(EMPTY);
  const [dismissed, setDismissed] = useState<Record<string, string>>({});
  useEffect(() => {
    let cancelled = false;
    const off: (() => void)[] = [];
    const restoreDismissed = (key: string) => setDismissed((current) => {
      if (!(key in current)) return current;
      const next = { ...current }; delete next[key]; return next;
    });
    function watch<K extends keyof QueueSnapshot>(key: K, read: () => Promise<QueueSnapshot[K]>, subscribe: (cb: (value: QueueSnapshot[K]) => void) => () => void) {
      let received = false;
      off.push(subscribe((value) => {
        received = true;
        if (!cancelled && key === 'zotero') {
          const progress = value as ZoteroImportProgress | null;
          if (progress && !ZOTERO_FINISHED.has(progress.phase)) restoreDismissed('zotero');
        }
        if (!cancelled) setSnapshot((current) => ({ ...current, [key]: value }));
      }));
      void read().then((value) => {
        // An IPC snapshot requested before a broadcast must not overwrite it later.
        if (!cancelled && !received) setSnapshot((current) => ({ ...current, [key]: value }));
      }).catch((error: unknown) => console.warn(`Queue snapshot (${key})`, error));
    }
    const api = window.nodus;
    watch('queue', () => api.getQueue(), (cb) => api.onQueueProgress(cb));
    watch('documents', () => api.getDocumentIndexProgress(), (cb) => api.onDocumentIndexProgress(cb));
    watch('embeddings', () => api.getEmbeddingStatus(), (cb) => api.onEmbeddingProgress(cb));
    watch('passages', () => api.getPassageStatus(), (cb) => api.onPassageProgress(cb));
    watch('zotero', async () => {
      const sessions = await api.listZoteroSyncSessions();
      return sessions.find((s) => s.status === 'running' && Date.now() - Date.parse(s.updatedAt) < 60_000)?.progress ?? null;
    }, (cb) => api.onZoteroImportProgress(cb));
    watch('research', () => api.listDeepResearchJobs(), (cb) => api.onDeepResearchQueue(cb));

    // These two channels publish individual jobs, rather than whole snapshots.
    function watchJobs<K extends 'extraction' | 'dictionary' | 'ocr', T extends QueueSnapshot[K][number]>(key: K, read: () => Promise<T[]>, subscribe: (cb: (value: T) => void) => () => void, id: (value: T) => string, restore?: (value: T) => string | null) {
      const updates = new Map<string, T>();
      off.push(subscribe((value) => {
        updates.set(id(value), value);
        const keyToRestore = restore?.(value);
        if (!cancelled && keyToRestore) restoreDismissed(keyToRestore);
        if (!cancelled) setSnapshot((current) => ({ ...current, [key]: [...(current[key] as T[]).filter((job) => id(job) !== id(value)), { ...(current[key] as T[]).find((job) => id(job) === id(value)), ...value }] }));
      }));
      void read().then((values) => {
        if (!cancelled) setSnapshot((current) => ({ ...current, [key]: [...values.map((value) => ({ ...value, ...updates.get(id(value)) })), ...[...updates.values()].filter((value) => !values.some((initial) => id(initial) === id(value)))] }));
      }).catch((error: unknown) => console.warn(`Queue snapshot (${key})`, error));
    }
    watchJobs('extraction', () => api.listLibraryExtractionJobs(), (cb: (p: LibraryExtractionJob & { message?: string }) => void) => api.onLibraryExtractionProgress(cb), (p) => p.id);
    off.push(subscribeBackgroundJobs((background) => { if (!cancelled) setSnapshot((current) => ({ ...current, background })); }));
    watchJobs<'ocr', QueueSnapshot['ocr'][number]>('ocr', async () => (await api.listOcrDocs()).map((job) => ({ ...job, docId: job.id })), (cb: (p: OcrDocProgress & { id: string; name?: string }) => void) => api.onOcrEvent((id, p) => cb({ ...p, id })), (p) => p.id, (p) => p.status === 'pending' || p.status === 'processing' ? `ocr:${p.id}` : null);
    watchJobs('dictionary', () => api.listDictionaryGenerationJobs(), (cb) => api.onDictionaryProgress(cb), (p) => p.entryId, (p) => !DICTIONARY_FINISHED.has(p.phase) ? `dictionary:${p.entryId}` : null);
    return () => { cancelled = true; off.forEach((unsubscribe) => unsubscribe()); };
  }, []);

  const zotero = snapshot.zotero && dismissed.zotero !== `${snapshot.zotero.requestId}:${snapshot.zotero.phase}` ? snapshot.zotero : null;
  const extraction = snapshot.extraction.filter((job) => dismissed[`extraction:${job.id}`] !== `${job.status}:${job.updatedAt}`).sort((a, b) => activeFirst(a.status === 'processing' || a.status === 'queued', b.status === 'processing' || b.status === 'queued'));
  const research = snapshot.research.filter((job) => dismissed[`research:${job.id}`] !== job.status).sort((a, b) => activeFirst(a.status === 'running' || a.status === 'queued', b.status === 'running' || b.status === 'queued'));
  const dictionary = snapshot.dictionary.filter((job) => dismissed[`dictionary:${job.entryId}`] !== job.phase).sort((a, b) => activeFirst(!DICTIONARY_FINISHED.has(a.phase), !DICTIONARY_FINISHED.has(b.phase)));
  const ocr = snapshot.ocr.filter((job) => dismissed[`ocr:${job.id}`] !== `${job.status}:${job.doneCount}:${job.error ?? ''}`).sort((a, b) => activeFirst(a.status === 'processing' || a.status === 'pending', b.status === 'processing' || b.status === 'pending'));
  const background = [...snapshot.background].sort((a, b) => activeFirst(a.status === 'running', b.status === 'running'));
  const { queue, embeddings, passages } = snapshot;
  const documents = snapshot.documents && { ...snapshot.documents, campaigns: snapshot.documents.campaigns.filter((job) => dismissed[`documents:${job.campaignId}`] !== `${job.status}:${job.updatedAt}`) };
  const queueActive = Boolean(queue && (queue.maintenanceRunning || queue.items.some((item) => DOCUMENT_LIVE.has(item.state))));
  const documentsActive = Boolean(documents?.campaigns.some((campaign) => DOCUMENT_LIVE.has(campaign.status)));
  const visible = Number(Boolean(queue && (queue.total > 0 || queue.maintenanceRunning || queue.maintenanceError)))
    + Number(Boolean(zotero)) + Number(Boolean(documents?.campaigns.length)) + Number(embeddingVisible(embeddings)) + Number(passageVisible(passages))
    + Number(extraction.length > 0) + Number(research.length > 0) + Number(dictionary.length > 0) + Number(ocr.length > 0) + Number(background.length > 0);
  const live = Number(queueActive) + Number(Boolean(zotero && !ZOTERO_FINISHED.has(zotero.phase)))
    + Number(documentsActive) + Number(Boolean(embeddings && (embeddings.running || embeddings.paused)))
    + Number(Boolean(passages && (passages.running || passages.paused)))
    + Number(extraction.some((job) => job.status === 'queued' || job.status === 'processing'))
    + Number(research.some((job) => job.status === 'queued' || job.status === 'running'))
    + Number(dictionary.some((job) => !DICTIONARY_FINISHED.has(job.phase)))
    + Number(ocr.some((job) => job.status === 'pending' || job.status === 'processing')) + Number(background.some((job) => job.status === 'running'));
  const attention = Boolean(queue?.maintenanceError || queue?.failed || queue?.pausedReason || embeddings?.error || passages?.error
    || zotero?.phase === 'failed' || documents?.campaigns.some((job) => job.status === 'failed' || job.failedJobs > 0 || job.error)
    || extraction.some((job) => job.status === 'failed') || research.some((job) => job.status === 'failed' || job.saveError)
    || dictionary.some((job) => job.phase === 'failed' || job.phase === 'degraded') || ocr.some((job) => job.status === 'error' || job.errorCount > 0 || job.error) || background.some((job) => job.status === 'failed' || backgroundFailure(job)));
  return { ...snapshot, documents, zotero, extraction, research, dictionary, ocr, background, visible, live, attention,
    dismiss: (key: string, version: string) => setDismissed((current) => ({ ...current, [key]: version })),
  };
}
export type QueueActivity = ReturnType<typeof useQueueActivity>;
