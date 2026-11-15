/**
 * Talks to SimplyOpen Chat (chat/ in this repository), which holds the
 * Claude key and does the editing. The website never sees the key and
 * never edits code; it starts a chat from a zip, passes messages through,
 * and takes a zip back out when the person keeps what they made.
 *
 * The contract is theirs, in chat/src/server.ts.
 */

export interface ChatVersion {
  number: number
  label: string
  createdAt: string
  changes: { path: string; change: string }[]
  checks?: { status: 'passed' | 'failed' | 'unavailable'; summary: string } | null
}

export type ChatAnswer =
  | {
      kind: 'reply'
      reply: string
      version: ChatVersion | null
      readyToDownload: { version: number } | null
      stoppedEarly: boolean
    }
  | { kind: 'privacy_reminder'; reminder: string; found: string[] }

/** One message of an earlier conversation, handed over when a chat is picked up again. */
export interface EarlierMessage {
  role: 'user' | 'assistant'
  text: string
}

export interface Chat {
  /** `earlier`: what was said before, so Claude carries on rather than starting cold. */
  start(zip: Uint8Array, earlier?: EarlierMessage[]): Promise<{ sessionId: string; version: ChatVersion }>
  send(id: string, message: string, confirmPrivate: boolean, signal?: AbortSignal): Promise<ChatAnswer>
  versions(id: string): Promise<ChatVersion[]>
  undo(id: string): Promise<ChatVersion | null>
  restore(id: string, n: number): Promise<ChatVersion | null>
  zip(id: string, version?: number): Promise<Uint8Array>
  end(id: string): Promise<void>
}

export class ChatError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message)
    this.name = 'ChatError'
  }
}

export class HttpChat implements Chat {
  constructor(private readonly base: string) {}

  private async call<T>(path: string, init?: RequestInit): Promise<T> {
    let response: Response
    try {
      response = await fetch(`${this.base.replace(/\/+$/, '')}${path}`, init)
    } catch {
      throw new ChatError('The chat service is not answering. Is it running?', 503, 'CHAT_UNREACHABLE')
    }
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null
      throw new ChatError(
        body?.error?.message ?? `The chat service answered ${response.status}.`,
        response.status,
        body?.error?.code ?? 'CHAT_FAILED',
      )
    }
    if (response.status === 204) return undefined as T
    const type = response.headers.get('content-type') ?? ''
    if (type.includes('application/json')) return (await response.json()) as T
    return new Uint8Array(await response.arrayBuffer()) as T
  }

  start(zip: Uint8Array, earlier: EarlierMessage[] = []) {
    const form = new FormData()
    if (earlier.length > 0) form.append('earlier', JSON.stringify(earlier))
    form.append('file', new Blob([zip as BlobPart], { type: 'application/zip' }), 'project.zip')
    return this.call<{ sessionId: string; version: ChatVersion }>('/sessions', { method: 'POST', body: form })
  }

  send(id: string, message: string, confirmPrivate: boolean, signal?: AbortSignal) {
    return this.call<ChatAnswer>(`/sessions/${id}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(confirmPrivate ? { message, confirmPrivate } : { message }),
      signal,
    })
  }

  async versions(id: string) {
    return (await this.call<{ versions: ChatVersion[] }>(`/sessions/${id}/versions`)).versions
  }

  async undo(id: string) {
    return (await this.call<{ version: ChatVersion | null }>(`/sessions/${id}/undo`, { method: 'POST' })).version
  }

  async restore(id: string, n: number) {
    return (await this.call<{ version: ChatVersion | null }>(`/sessions/${id}/versions/${n}/restore`, { method: 'POST' })).version
  }

  zip(id: string, version?: number) {
    return this.call<Uint8Array>(`/sessions/${id}/project.zip${version === undefined ? '' : `?version=${version}`}`)
  }

  async end(id: string) {
    await this.call<void>(`/sessions/${id}`, { method: 'DELETE' }).catch(() => undefined)
  }
}

/** When CHAT_URL is not set. Every call says so, plainly. */
export class NoChat implements Chat {
  private no(): never {
    throw new ChatError('Changing things by chatting is not set up here. Start the chat service and set CHAT_URL.', 503, 'CHAT_NOT_SET_UP')
  }
  start(): never { return this.no() }
  send(): never { return this.no() }
  versions(): never { return this.no() }
  undo(): never { return this.no() }
  restore(): never { return this.no() }
  zip(): never { return this.no() }
  async end() {}
}
