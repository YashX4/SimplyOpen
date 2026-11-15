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

export class MemoryMailer implements Mailer {
  readonly sent: Mail[] = []
  async send(mail: Mail): Promise<void> {
    this.sent.push(mail)
  }
}
