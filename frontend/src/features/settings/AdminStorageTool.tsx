import { Check, X } from 'lucide-react'
import { useState } from 'react'
import { Button } from '../../components/ui/Button'
import { ApiError, api } from '../../lib/api'
import type { StorageCheckResponse, StorageStep } from '../../lib/types'
import { uploadImage } from '../../lib/upload'
import { useCurrentUser } from '../auth/AuthContext'

// A valid 1x1 PNG (70 bytes), the same image the server uses for its own part of the check.
const TEST_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

function testImage(): File {
  const bytes = Uint8Array.from(atob(TEST_PNG_BASE64), (c) => c.charCodeAt(0))
  return new File([bytes], 'storage-check.png', { type: 'image/png' })
}

/** What to paste into the bucket's CORS policy so this site's browsers may upload. */
function corsRule(origin: string) {
  return JSON.stringify([{ AllowedOrigins: [origin], AllowedMethods: ['PUT'], AllowedHeaders: ['content-type', 'content-length'], MaxAgeSeconds: 3600 }], null, 2)
}

function browserFailure(e: unknown): StorageStep {
  const origin = window.location.origin
  if (e instanceof ApiError && e.status !== 0) {
    return { id: 'browser-upload', label: 'Image uploaded from your browser', ok: false, detail: e.message, hint: e.status === 503 ? 'The server says image storage is not set up.' : 'The storage server refused the upload from the browser.' }
  }
  return {
    id: 'browser-upload',
    label: 'Image uploaded from your browser',
    ok: false,
    detail: 'The browser could not send the image to storage.',
    hint: `The server's own checks passed, so this is almost always the bucket's CORS rule: it must allow ${origin}. In Cloudflare open R2, your bucket, Settings, CORS policy, and use the rule below (then try again; it can take a minute to apply).`,
  }
}

/**
 * For admins: checks that picture uploads work from the settings to the browser. The server tests its own side (credentials, bucket, a real upload,
 * the public address), then this browser uploads a tiny image the way the app does, which is what the bucket's CORS rule decides.
 */
export function AdminStorageTool() {
  const user = useCurrentUser()
  const [busy, setBusy] = useState(false)
  const [steps, setSteps] = useState<StorageStep[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [corsHelp, setCorsHelp] = useState(false)

  if (!user.admin) return null

  async function run() {
    setBusy(true)
    setError(null)
    setCorsHelp(false)
    setSteps(null)
    try {
      const server = await api.post<StorageCheckResponse>('/api/admin/storage/check', {})
      setSteps(server.steps)
      if (!server.ok) return
      let key: string
      try {
        key = (await uploadImage(testImage(), () => undefined)).key
      } catch (e) {
        setSteps([...server.steps, browserFailure(e)])
        setCorsHelp(!(e instanceof ApiError) || e.status === 0)
        return
      }
      const browser = await api.post<StorageCheckResponse>('/api/admin/storage/check', { browserTestKey: key })
      setSteps([...server.steps, ...browser.steps.filter((s) => s.id !== 'config')])
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not reach the server. Try again.')
    } finally {
      setBusy(false)
    }
  }

  const allGood = steps !== null && steps.length > 0 && steps.every((s) => s.ok)
  return (
    <section aria-label="Image storage" className="space-y-3 border-b border-zinc-800 px-4 py-5">
      <div>
        <h3 className="text-lg font-bold">Image storage</h3>
        <p className="text-sm text-zinc-500">Checks that photos can be uploaded and shown: your Cloudflare R2 settings, a test upload from the server, and one from this browser. The test image is deleted again.</p>
      </div>
      <Button variant="secondary" loading={busy} onClick={() => void run()}>Check image storage</Button>
      {error && <p role="alert" className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>}
      {steps && (
        <>
          <ol aria-label="Check results" className="space-y-2">
            {steps.map((step) => (
              <li key={step.id} className="flex gap-3">
                {step.ok ? <Check size={18} aria-label="Passed" className="mt-0.5 shrink-0 text-green-500" /> : <X size={18} aria-label="Failed" className="mt-0.5 shrink-0 text-red-500" />}
                <div className="min-w-0">
                  <p className="font-semibold">{step.label}</p>
                  <p className="break-words text-sm text-zinc-500">{step.detail}</p>
                  {step.hint && <p role="alert" className="mt-1 break-words rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">{step.hint}</p>}
                </div>
              </li>
            ))}
          </ol>
          {corsHelp && (
            <pre aria-label="CORS rule to use" className="overflow-x-auto rounded-md border border-zinc-700 bg-zinc-900 p-3 text-xs">{corsRule(window.location.origin)}</pre>
          )}
          {allGood && <p role="status" className="rounded-md border border-green-500/40 bg-green-500/10 px-3 py-2 text-sm text-green-300">Image storage is working: photos can be uploaded and shown.</p>}
        </>
      )}
    </section>
  )
}
