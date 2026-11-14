// The page: everything the user sees. It draws one control per manifest input
// and asks the main process (through window.runner) to do the real work.

import { useEffect, useState } from 'react'
import {
  checkValues,
  initialValues,
  type Manifest,
  type ManifestInput,
  type Values,
} from '../../shared/manifest'

type Status = 'idle' | 'running' | 'done' | 'failed'

export function App() {
  const [manifest, setManifest] = useState<Manifest | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [values, setValues] = useState<Values>({})
  const [status, setStatus] = useState<Status>('idle')
  const [message, setMessage] = useState<string | null>(null)
  const [log, setLog] = useState<string[]>([])

  // On startup, ask the main process for the manifest.
  useEffect(() => {
    window.runner.loadManifest().then((result) => {
      if (!result.ok) return setLoadError(result.error)
      setManifest(result.manifest)
      setValues(initialValues(result.manifest))
      document.title = result.manifest.name
    })
  }, [])

  // Add each line the script prints to the log.
  useEffect(() => window.runner.onLog((line) => setLog((lines) => [...lines, line])), [])

  if (loadError) return <p className="message error">{loadError}</p>
  if (!manifest) return null

  const setValue = (id: string, value: string): void =>
    setValues((current) => ({ ...current, [id]: value }))

  const run = async (): Promise<void> => {
    const problem = checkValues(manifest, values)
    if (problem) {
      setStatus('idle')
      setMessage(problem)
      return
    }
    setStatus('running')
    setMessage(null)
    setLog([])
    const result = await window.runner.run(values)
    setStatus(result.ok ? 'done' : 'failed')
    setMessage(result.ok ? 'Done.' : `That didn't work. ${result.error}`)
  }

  return (
    <main>
      <h1>{manifest.name}</h1>
      <p className="description">{manifest.description}</p>

      {manifest.inputs.map((input) => (
        <Field
          key={input.id}
          input={input}
          value={values[input.id] ?? ''}
          onChange={(value) => setValue(input.id, value)}
        />
      ))}

      <button className="primary" onClick={run} disabled={status === 'running'}>
        {status === 'running' ? 'Working…' : (manifest.action_label ?? 'Run')}
      </button>

      {message && (
        <p className={`message ${status === 'done' ? 'success' : 'error'}`} role="status">
          {message}
        </p>
      )}
      {status === 'done' && (
        <button onClick={() => window.runner.openResults()}>Open results</button>
      )}
      {log.length > 0 && <pre className="log">{log.join('\n')}</pre>}
    </main>
  )
}

interface FieldProps {
  input: ManifestInput
  value: string
  onChange: (value: string) => void
}

/** One manifest input, drawn as the control that matches its type. */
function Field({ input, value, onChange }: FieldProps) {
  const id = `input-${input.id}`

  if (input.type === 'file') {
    const choose = async (): Promise<void> => {
      const path = await window.runner.chooseFile(input.extensions)
      if (path) onChange(path)
    }
    return (
      <div className="field">
        <label htmlFor={id}>{input.label}</label>
        <div className="file">
          {/* Show just the file's name, not its full path. */}
          <span className="file-name">{value ? value.split(/[\\/]/).pop() : 'No file chosen'}</span>
          <button id={id} onClick={choose}>
            Choose…
          </button>
        </div>
      </div>
    )
  }

  if (input.type === 'choice') {
    return (
      <div className="field">
        <label htmlFor={id}>{input.label}</label>
        <select id={id} value={value} onChange={(event) => onChange(event.target.value)}>
          {input.options?.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
    )
  }

  return (
    <div className="field">
      <label htmlFor={id}>{input.label}</label>
      <input
        id={id}
        type="text"
        inputMode={input.type === 'number' ? 'decimal' : undefined}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  )
}
