/**
 * Where files live.
 *
 * Two things need to be fetchable by a stranger with no credentials:
 * the uploaded zip and the Analyzer's answer, because the Factory does a
 * plain fetch on both. The built apps need it too, because W9 promises
 * downloads take no account.
 */

export interface Stored {
  path: string
  url: string
  size: number
}

export interface Storage {
  put(path: string, bytes: Uint8Array, contentType: string): Promise<Stored>
  /** Used by the download route to hand out a short lived link, or the public one. */
  urlFor(path: string): string
  /** Fetches something this storage put, by the url it handed back. Null if it is not there. */
  read(url: string): Promise<Uint8Array | null>
  /**
   * The biggest file this will take. Supabase's free plan stops at 50 MB,
   * which a built app goes past, so the pipeline asks before it copies.
   */
  readonly maxBytes: number
}

/** Supabase Storage over its REST API. The bucket must allow public reads. */
export class SupabaseStorage implements Storage {
  constructor(
    private readonly projectUrl: string,
    private readonly serviceKey: string,
    private readonly bucket: string,
    readonly maxBytes = 50 * 1024 * 1024,
  ) {}

  private get base(): string {
    return `${this.projectUrl.replace(/\/+$/, '')}/storage/v1`
  }

  async put(path: string, bytes: Uint8Array, contentType: string): Promise<Stored> {
    const response = await fetch(`${this.base}/object/${this.bucket}/${path}`, {
      method: 'POST',
      headers: {
        // Both headers: the newer sb_secret_ keys and the older
        // service_role JWT are each accepted this way.
        authorization: `Bearer ${this.serviceKey}`,
        apikey: this.serviceKey,
        'content-type': contentType,
        'x-upsert': 'true',
      },
      body: bytes as BodyInit,
    })
    if (!response.ok) {
      throw new Error(`Could not store ${path}: ${response.status} ${await response.text()}`)
    }
    return { path, url: this.urlFor(path), size: bytes.byteLength }
  }

  urlFor(path: string): string {
    return `${this.base}/object/public/${this.bucket}/${path}`
  }

  async read(url: string): Promise<Uint8Array | null> {
    const response = await fetch(url)
    if (response.status === 404 || response.status === 400) return null
    if (!response.ok) throw new Error(`Could not read ${url}: ${response.status}`)
    return new Uint8Array(await response.arrayBuffer())
  }
}

/** Keeps everything in memory. Tests, and `npm run dev` with nothing configured. */
export class MemoryStorage implements Storage {
  readonly files = new Map<string, { bytes: Uint8Array; contentType: string }>()

  constructor(
    private readonly base = 'memory://files',
    readonly maxBytes = 50 * 1024 * 1024,
  ) {}

  async put(path: string, bytes: Uint8Array, contentType: string): Promise<Stored> {
    this.files.set(path, { bytes, contentType })
    return { path, url: this.urlFor(path), size: bytes.byteLength }
  }

  urlFor(path: string): string {
    return `${this.base}/${path}`
  }

  async read(url: string): Promise<Uint8Array | null> {
    const prefix = `${this.base}/`
    if (!url.startsWith(prefix)) return null
    return this.files.get(url.slice(prefix.length))?.bytes ?? null
  }
}
