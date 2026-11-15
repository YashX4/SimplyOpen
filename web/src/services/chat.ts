/**
 * Talks to the chat service (the chat/ folder), which is where an AI
 * changes a copy's code. Its contract is in chat/src/server.ts.
 *
 * Sessions over there are temporary: they live in memory and expire. This
 * side keeps what must last (the messages and every version of the code),
 * and starts a fresh session from them whenever the old one is gone.
 */

/** One message of an earlier conversation, in the chat service's words. */
export interface EarlierMessage {
  role: 'user' | 'assistant'
  text: string
}

export type ChatAnswer =
  | {
      kind: 'reply'
      reply: string
      /** Whether this answer changed the code. */
      changed: boolean
      /** The chat's own label for the change, e.g. "You asked: make it blue". */
      label: string | null
      /** The person said they are happy with it: offer the download. */
      ready_to_download: boolean
      stopped_early: boolean
    }
  /** Nothing was sent to the AI: the message looks private, and the person must confirm first. */
  | { kind: 'privacy_reminder'; reminder: string; found: string[] }

export interface ChatService {
  /** Start a session on this code, already knowing an earlier conversation. Returns its id. */
  start(zip: Uint8Array, earlier: EarlierMessage[]): Promise<string>
  /** 'gone': the session expired. 'busy': it is still answering the last message. */
  send(sessionId: string, message: string, confirmPrivate: boolean): Promise<ChatAnswer | 'gone' | 'busy'>
  /** The session's code as it is now. */
  zip(sessionId: string): Promise<Uint8Array>
}

/** The chat service could not be reached, or failed. The message is safe to show. */
export class ChatUnavailable extends Error {
  constructor(message = 'The chat is not answering right now. Try again in a moment.') {
    super(message)
    this.name = 'ChatUnavailable'
  }
}

export class HttpChatService implements ChatService {
  constructor(
    private readonly baseUrl: string,
    /** An answer can take minutes while the AI works through a change. */
    private readonly timeoutMs = 5 * 60 * 1000,
  ) {}

  private async call(path: string, init: RequestInit): Promise<Response> {
    try {
      return await fetch(new URL(path, this.baseUrl), { ...init, signal: AbortSignal.timeout(this.timeoutMs) })
    } catch {
      throw new ChatUnavailable()
    }
  }

  async start(zip: Uint8Array, earlier: EarlierMessage[]): Promise<string> {
    const form = new FormData()
    form.append('earlier', JSON.stringify(earlier))
    form.append('file', new Blob([zip as BlobPart], { type: 'application/zip' }), 'project.zip')
    const response = await this.call('/sessions', { method: 'POST', body: form })
    const body = (await response.json().catch(() => null)) as { sessionId?: unknown } | null
    if (!response.ok || typeof body?.sessionId !== 'string') throw new ChatUnavailable()
    return body.sessionId
  }

  async send(sessionId: string, message: string, confirmPrivate: boolean): Promise<ChatAnswer | 'gone' | 'busy'> {
    const response = await this.call(`/sessions/${encodeURIComponent(sessionId)}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message, confirmPrivate }),
    })
    if (response.status === 404) return 'gone'
    if (response.status === 409) return 'busy'
    const body = (await response.json().catch(() => null)) as Record<string, unknown> | null
    if (!response.ok || !body) throw new ChatUnavailable()
    if (body.kind === 'privacy_reminder') {
      return {
        kind: 'privacy_reminder',
        reminder: String(body.reminder ?? ''),
        found: Array.isArray(body.found) ? body.found.map(String) : [],
      }
    }
    const version = body.version as { label?: unknown } | null
    return {
      kind: 'reply',
      reply: String(body.reply ?? ''),
      changed: version !== null && version !== undefined,
      label: typeof version?.label === 'string' ? version.label : null,
      ready_to_download: body.readyToDownload !== null && body.readyToDownload !== undefined,
      stopped_early: body.stoppedEarly === true,
    }
  }

  async zip(sessionId: string): Promise<Uint8Array> {
    const response = await this.call(`/sessions/${encodeURIComponent(sessionId)}/project.zip`, { method: 'GET' })
    if (!response.ok) throw new ChatUnavailable()
    return new Uint8Array(await response.arrayBuffer())
  }
}
