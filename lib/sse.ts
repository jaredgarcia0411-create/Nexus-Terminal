const encoder = new TextEncoder();

export type SSESender = (event: string, data: unknown) => void;

export function createSSEResponse(
  signal: AbortSignal,
  onStart: (send: SSESender) => (() => void) | void,
): Response {
  let cleanup: (() => void) | void;

  const stream = new ReadableStream({
    start(controller) {
      const send: SSESender = (event, data) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          // Ignore enqueue errors after disconnect.
        }
      };

      cleanup = onStart(send);

      signal.addEventListener('abort', () => {
        cleanup?.();
        try {
          controller.close();
        } catch {
          // Ignore close errors if stream already closed.
        }
      });
    },
    cancel() {
      cleanup?.();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
