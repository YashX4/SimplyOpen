// The page: everything the user sees. It draws one control per manifest input
// and asks the main process (through window.runner) to do the real work.

import { useEffect, useState } from 'react'
import {
  checkValues,
  hasFileResults,
  initialValues,
  type AppDescription,
  type Input,
  type Value,
  type Values,
} from '../../shared/manifest'

type Status = 'idle' | 'running' | 'done' | 'failed'

export function App() {
  const [app, setApp] = useState<AppDescription | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [values, setValues] = useState<Values>({})
  const [status, setStatus] = useState<Status>('idle')
  const [message, setMessage] = useState<string | null>(null)
  const [log, setLog] = useState<string[]>([])

  // On startup, ask the main process for the app's description and manifest.
  useEffect(() => {
    window.runner.loadApp().then((result) => {
      if (!result.ok) return setLoadError(result.error)
      setApp(result.app)
      setValues(initialValues(result.app.manifest))
      document.title = result.app.name
    })
  }, [])

  // Add each line the script prints to the log.
  useEffect(() => window.runner.onLog((line) => setLog((lines) => [...lines, line])), [])

  if (loadError) return <p className="message error load-error">{loadError}</p>
  if (!app) return null
  const { manifest } = app

  const setValue = (id: string, value: Value): void =>
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
      <h1>{app.name}</h1>
      <p className="description">{app.description}</p>

      {manifest.inputs.map((input) => (
        <Field
          key={input.id}
          input={input}
          value={values[input.id]}
          onChange={(value) => setValue(input.id, value)}
        />
      ))}

      <button className="primary" onClick={run} disabled={status === 'running'}>
        {status === 'running' ? 'Working…' : 'Run'}
      </button>

      {message && (
        <p className={`message ${status === 'done' ? 'success' : 'error'}`} role="status">
          {message}
        </p>
      )}
      {status === 'done' && hasFileResults(manifest) && (
        <button onClick={() => window.runner.openResults()}>Open results</button>
      )}
      {log.length > 0 && <pre className="log">{log.join('\n')}</pre>}
    </main>
  )
}

/** Just the last part of a path: "/Users/a/cat.png" -> "cat.png". */
function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

interface FieldProps {
  input: Input
  value: Value | undefined
  onChange: (value: Value) => void
}

/** One manifest input, drawn as the control that matches its kind. */
function Field({ input, value, onChange }: FieldProps) {
  const id = `input-${input.id}`
  const help = input.help && <p className="help">{input.help}</p>

  // An on/off switch: the label sits beside the checkbox instead of above it.
  if (input.kind === 'boolean') {
    return (
      <div className="field">
        <label className="switch">
          <input
            id={id}
            type="checkbox"
            checked={value === true}
            onChange={(event) => onChange(event.target.checked)}
          />
          {input.label}
        </label>
        {help}
      </div>
    )
  }

  if (input.kind === 'file' || input.kind === 'folder') {
    const chosen = Array.isArray(value) ? value : typeof value === 'string' && value ? [value] : []
    const choose = async (): Promise<void> => {
      if (input.kind === 'folder') {
        const folder = await window.runner.chooseFolder()
        if (folder) onChange(folder)
        return
      }
      const files = await window.runner.chooseFiles({
        accepts: input.accepts,
        multiple: input.multiple,
      })
      if (files.length) onChange(input.multiple ? files : files[0])
    }
    const nothing = input.kind === 'folder' ? 'No folder chosen' : 'No file chosen'
    return (
      <div className="field">
        <label htmlFor={id}>{input.label}</label>
        <div className="file">
          {/* Show just the names, not the full paths. */}
          <span className="file-name">
            {chosen.length ? chosen.map(baseName).join(', ') : nothing}
          </span>
          <button id={id} onClick={choose}>
            Choose…
          </button>
        </div>
        {help}
      </div>
    )
  }

  if (input.kind === 'choice') {
    return (
      <div className="field">
        <label htmlFor={id}>{input.label}</label>
        <select
          id={id}
          value={typeof value === 'string' ? value : ''}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">Choose…</option>
          {input.choices?.map((choice) => (
            <option key={choice} value={choice}>
              {choice}
            </option>
          ))}
        </select>
        {help}
      </div>
    )
  }

  // Text and numbers. A secret (password or key) is hidden as it's typed.
  return (
    <div className="field">
      <label htmlFor={id}>{input.label}</label>
      <input
        id={id}
        type={input.secret ? 'password' : 'text'}
        inputMode={input.kind === 'number' ? 'decimal' : undefined}
        value={typeof value === 'string' ? value : ''}
        onChange={(event) => onChange(event.target.value)}
      />
      {help}
    </div>
  )
}
