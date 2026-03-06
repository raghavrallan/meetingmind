import { EventEmitter } from 'events';

/** A single transcript segment returned by the backend */
export interface TranscriptSegment {
  speaker: string;
  text: string;
  timestamp: number;
  isFinal: boolean;
  confidence: number;
}

/** Connection states for the WebSocket */
export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

/** Configuration for the Deepgram streaming connection */
interface StreamConfig {
  meetingId: string;
  apiUrl: string;
  token?: string;
  sampleRate?: number;
  channels?: number;
  encoding?: string;
}

const DEFAULT_CONFIG: Partial<StreamConfig> = {
  sampleRate: 16000,
  channels: 2,
  encoding: 'linear16',
};

/** Reconnection settings */
const MAX_RECONNECT_ATTEMPTS = 10;
const BASE_RECONNECT_DELAY_MS = 1000;
const MAX_RECONNECT_DELAY_MS = 30000;

/**
 * DeepgramStreamManager manages a WebSocket connection to the backend
 * meeting/transcript service. It streams PCM audio and receives live
 * transcript segments.
 */
export class DeepgramStreamManager extends EventEmitter {
  private ws: WebSocket | null = null;
  private config: StreamConfig | null = null;
  private state: ConnectionState = 'disconnected';
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private offlineBuffer: Buffer[] = [];
  private maxOfflineBufferSize = 5 * 1024 * 1024; // 5 MB
  private currentOfflineBufferSize = 0;

  constructor() {
    super();
  }

  /** Get current connection state */
  getState(): ConnectionState {
    return this.state;
  }

  /**
   * Open a WebSocket connection to the backend transcript streaming endpoint.
   *
   * The URL pattern is: ws(s)://<apiUrl>/api/v1/meetings/<meetingId>/stream
   * The backend expects binary frames of 16-bit PCM audio and sends JSON
   * frames back with transcript segments.
   */
  connect(meetingId: string, apiUrl: string, token?: string): void {
    if (this.ws) {
      this.disconnect();
    }

    this.config = { ...DEFAULT_CONFIG, meetingId, apiUrl, token } as StreamConfig;
    this.reconnectAttempts = 0;
    this.doConnect();
  }

  /** Internal: perform the actual WebSocket connection */
  private doConnect(): void {
    if (!this.config) return;

    this.setState('connecting');

    const { meetingId, apiUrl, token, sampleRate, channels, encoding } = this.config;

    // Build WebSocket URL
    const wsBase = apiUrl.replace(/^http/, 'ws');
    const params = new URLSearchParams({
      sample_rate: String(sampleRate),
      channels: String(channels),
      encoding: encoding!,
    });
    if (token) {
      params.set('token', token);
    }

    const wsUrl = `${wsBase}/api/v1/meetings/${meetingId}/stream?${params.toString()}`;

    try {
      this.ws = new WebSocket(wsUrl);
      this.ws.binaryType = 'arraybuffer';

      this.ws.onopen = () => {
        this.setState('connected');
        this.reconnectAttempts = 0;
        this.emit('connected');

        // Flush any buffered audio from offline period
        this.flushOfflineBuffer();
      };

      this.ws.onmessage = (event: MessageEvent) => {
        this.handleMessage(event.data);
      };

      this.ws.onerror = (event: Event) => {
        console.error('[DeepgramStream] WebSocket error:', event);
        this.emit('error', new Error('WebSocket connection error'));
      };

      this.ws.onclose = (event: CloseEvent) => {
        console.log(`[DeepgramStream] WebSocket closed: code=${event.code} reason=${event.reason}`);
        this.ws = null;

        if (this.state !== 'disconnected') {
          // Unexpected close - attempt reconnect
          this.scheduleReconnect();
        }

        this.emit('disconnected', { code: event.code, reason: event.reason });
      };
    } catch (err) {
      console.error('[DeepgramStream] Failed to create WebSocket:', err);
      this.setState('disconnected');
      this.emit('error', err instanceof Error ? err : new Error(String(err)));
    }
  }

  /**
   * Send a PCM audio chunk to the backend. If the connection is not open,
   * the chunk is buffered (up to the max offline buffer size).
   */
  sendAudio(chunk: Buffer): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(chunk);
    } else {
      // Buffer audio while disconnected
      if (this.currentOfflineBufferSize + chunk.length <= this.maxOfflineBufferSize) {
        this.offlineBuffer.push(chunk);
        this.currentOfflineBufferSize += chunk.length;
      }
      // If buffer is full, drop oldest chunks
      else {
        while (
          this.offlineBuffer.length > 0 &&
          this.currentOfflineBufferSize + chunk.length > this.maxOfflineBufferSize
        ) {
          const dropped = this.offlineBuffer.shift()!;
          this.currentOfflineBufferSize -= dropped.length;
        }
        this.offlineBuffer.push(chunk);
        this.currentOfflineBufferSize += chunk.length;
      }
    }
  }

  /** Register a callback for transcript results */
  onTranscript(callback: (segment: TranscriptSegment) => void): void {
    this.on('transcript', callback);
  }

  /** Gracefully close the WebSocket connection */
  disconnect(): void {
    this.setState('disconnected');

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      // Send a close signal so the backend knows we are done
      try {
        if (this.ws.readyState === WebSocket.OPEN) {
          // Send an empty JSON message to signal end-of-stream
          this.ws.send(JSON.stringify({ type: 'close' }));
        }
        this.ws.close(1000, 'Client disconnecting');
      } catch {
        // Ignore errors during close
      }
      this.ws = null;
    }

    // Clear offline buffer
    this.offlineBuffer = [];
    this.currentOfflineBufferSize = 0;
    this.config = null;
  }

  /** Handle incoming WebSocket messages (JSON transcript data) */
  private handleMessage(data: string | ArrayBuffer): void {
    try {
      const text = typeof data === 'string' ? data : new TextDecoder().decode(data);
      const message = JSON.parse(text);

      switch (message.type) {
        case 'transcript': {
          const segment: TranscriptSegment = {
            speaker: message.speaker || 'Unknown',
            text: message.text || '',
            timestamp: message.timestamp || Date.now(),
            isFinal: message.is_final ?? true,
            confidence: message.confidence ?? 0,
          };
          this.emit('transcript', segment);
          break;
        }

        case 'error': {
          console.error('[DeepgramStream] Server error:', message.message);
          this.emit('error', new Error(message.message || 'Server error'));
          break;
        }

        case 'keepalive': {
          // Respond to keepalive
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type: 'keepalive' }));
          }
          break;
        }

        case 'metadata': {
          this.emit('metadata', message);
          break;
        }

        default:
          console.log('[DeepgramStream] Unknown message type:', message.type);
      }
    } catch (err) {
      console.error('[DeepgramStream] Failed to parse message:', err);
    }
  }

  /** Flush buffered audio that was collected while offline */
  private flushOfflineBuffer(): void {
    if (this.offlineBuffer.length === 0) return;

    console.log(
      `[DeepgramStream] Flushing ${this.offlineBuffer.length} buffered chunks ` +
        `(${(this.currentOfflineBufferSize / 1024).toFixed(1)} KB)`
    );

    for (const chunk of this.offlineBuffer) {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(chunk);
      }
    }

    this.offlineBuffer = [];
    this.currentOfflineBufferSize = 0;
  }

  /** Schedule a reconnection attempt with exponential backoff */
  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      console.error('[DeepgramStream] Max reconnect attempts reached');
      this.setState('disconnected');
      this.emit('error', new Error('Max reconnection attempts reached'));
      return;
    }

    this.setState('reconnecting');
    this.reconnectAttempts++;

    // Exponential backoff with jitter
    const delay = Math.min(
      BASE_RECONNECT_DELAY_MS * Math.pow(2, this.reconnectAttempts - 1) +
        Math.random() * 1000,
      MAX_RECONNECT_DELAY_MS
    );

    console.log(
      `[DeepgramStream] Reconnecting in ${(delay / 1000).toFixed(1)}s ` +
        `(attempt ${this.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`
    );

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.doConnect();
    }, delay);
  }

  /** Update state and emit state-change event */
  private setState(newState: ConnectionState): void {
    const oldState = this.state;
    this.state = newState;
    if (oldState !== newState) {
      this.emit('state-change', { from: oldState, to: newState });
    }
  }
}
