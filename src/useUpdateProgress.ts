import { useEffect, useState } from 'react';
import type { UpdateProgressEvent } from '@shared/types';

/** Subscribe before reading the snapshot; a slow snapshot must not undo a newer event. */
export function useUpdateProgress() {
  const [update, setUpdate] = useState<UpdateProgressEvent | null>(null);
  useEffect(() => {
    let alive = true;
    let receivedEvent = false;
    const unsubscribe = window.nodus.onUpdateProgress((event) => {
      receivedEvent = true;
      if (alive) setUpdate(event);
    });
    void window.nodus.getUpdateStatus?.().then((snapshot) => {
      if (alive && !receivedEvent) setUpdate(snapshot);
    }).catch(() => { /* Keep the live subscription if the initial read fails. */ });
    return () => { alive = false; unsubscribe(); };
  }, []);
  return [update, setUpdate] as const;
}
