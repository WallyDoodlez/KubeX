import { useEffect, useRef, useCallback, useState } from 'react';

export type SSEStatus = 'idle' | 'connecting' | 'open' | 'closed' | 'error';

interface SSEChunk {
  type: string;
  [key: string]: unknown;
}

interface UseSSEOptions {
  url: string | null;  // null = don't connect
  onMessage: (data: SSEChunk) => void;
  onError?: (error: Event) => void;
  onComplete?: () => void;
  maxRetries?: number;
  retryDelayMs?: number;
}

interface UseSSEResult {
  status: SSEStatus;
  close: () => void;
}

export function useSSE(options: UseSSEOptions): UseSSEResult {
  const { url, onMessage, onError, onComplete, maxRetries = 3, retryDelayMs = 2000 } = options;
  const [status, setStatus] = useState<SSEStatus>('idle');
  const esRef = useRef<EventSource | null>(null);
  const retriesRef = useRef(0);
  const onMessageRef = useRef(onMessage);
  const onErrorRef = useRef(onError);
  const onCompleteRef = useRef(onComplete);

  // Keep callback refs current
  onMessageRef.current = onMessage;
  onErrorRef.current = onError;
  onCompleteRef.current = onComplete;

  const close = useCallback(() => {
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
    setStatus('closed');
  }, []);

  useEffect(() => {
    if (!url) {
      setStatus('idle');
      return;
    }

    setStatus('connecting');
    retriesRef.current = 0;

    function connect() {
      const es = new EventSource(url!);
      esRef.current = es;

      es.onopen = () => {
        setStatus('open');
        retriesRef.current = 0;
      };

      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as SSEChunk;
          onMessageRef.current(data);
          // Check for terminal events
          if (['result', 'cancelled', 'failed'].includes(data.type)) {
            es.close();
            esRef.current = null;
            setStatus('closed');
            onCompleteRef.current?.();
          }
        } catch {
          // Non-JSON message, ignore
        }
      };

      es.onerror = (event) => {
        es.close();
        esRef.current = null;
        onErrorRef.current?.(event);

        if (retriesRef.current < maxRetries) {
          retriesRef.current++;
          setStatus('connecting');
          setTimeout(connect, retryDelayMs * retriesRef.current);
        } else {
          setStatus('error');
          onCompleteRef.current?.();
        }
      };
    }

    connect();

    return () => {
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
    };
  }, [url, maxRetries, retryDelayMs]);

  return { status, close };
}
