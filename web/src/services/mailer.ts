/** Sending the sign in link. Swap the implementation for a real sender. */

export interface Mail {
  to: string
  subject: string
  text: string
}

export interface Mailer {
  send(mail: Mail): Promise<void>
}

/** Prints the link to the terminal. Perfectly good for a hackathon. */
export class ConsoleMailer implements Mailer {
  async send(mail: Mail): Promise<void> {
    console.log(`\n--- email to ${mail.to}\n${mail.subject}\n${mail.text}\n---\n`)
  }
}

/**
 * Sends real email through Resend (resend.com), over its HTTP API, so no
 * extra package is needed. With the default sender, onboarding@resend.dev,
 * Resend only delivers to the address the Resend account was made with.
 * To email anyone, verify a domain in Resend and set MAIL_FROM to an
 * address on it.
 */
export class ResendMailer implements Mailer {
  constructor(
    private readonly key: string,
    private readonly from = 'SimplyOpen <onboarding@resend.dev>',
  ) {}

  async send(mail: Mail): Promise<void> {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${this.key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: this.from, to: [mail.to], subject: mail.subject, text: mail.text }),
    })
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { message?: string } | null
      throw new MailError(body?.message ?? `Resend answered ${response.status}.`)
    }
  }
}

export class MailError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MailError'
  }
}

export class MemoryMailer implements Mailer {
  readonly sent: Mail[] = []
  async send(mail: Mail): Promise<void> {
    this.sent.push(mail)
  }
}
