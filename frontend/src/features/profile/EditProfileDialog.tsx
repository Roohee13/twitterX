import { Camera } from 'lucide-react'
import { useRef, useState, type ChangeEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Avatar } from '../../components/ui/Avatar'
import { Button } from '../../components/ui/Button'
import { Field } from '../../components/ui/Field'
import { Modal } from '../../components/ui/Modal'
import { useToast } from '../../components/ui/Toast'
import { ApiError, api } from '../../lib/api'
import type { ProfileResponse, UserResponse } from '../../lib/types'
import { ALLOWED_IMAGE_TYPES } from '../../lib/upload'
import { useAuth } from '../auth/AuthContext'
import { profileKey } from './profileData'
import { useImageField, type ImageField } from './useImageField'
import { invalidateFeeds } from '../../lib/feedCache'

const BIO_MAX = 160
const NAME_MAX = 50

function Picker({ field, label, children }: { field: ImageField; label: string; children: React.ReactNode }) {
  const input = useRef<HTMLInputElement>(null)
  const onPick = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) field.choose(file)
  }
  return (
    <div>
      {children}
      <input ref={input} type="file" hidden accept={ALLOWED_IMAGE_TYPES.join(',')} aria-label={`Choose ${label}`} onChange={onPick} />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" onClick={() => input.current?.click()}><Camera size={14} /> Change {label}</Button>
        {field.previewUrl && <Button size="sm" variant="ghost" onClick={field.remove}>Remove {label}</Button>}
        {field.status === 'uploading' && (
          <span role="progressbar" aria-label={`Uploading ${label}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(field.progress * 100)} className="text-sm text-zinc-400">Uploading…</span>
        )}
      </div>
      {field.error && <p role="alert" className="mt-1 text-sm text-red-400">{field.error}</p>}
    </div>
  )
}

/** Edit your name, bio, profile photo and banner. */
export function EditProfileDialog({ profile, onClose }: { profile: ProfileResponse; onClose: () => void }) {
  const { setUser } = useAuth()
  const queryClient = useQueryClient()
  const toast = useToast()
  const [name, setName] = useState(profile.displayName)
  const [bio, setBio] = useState(profile.bio ?? '')
  const avatar = useImageField(profile.avatarUrl)
  const banner = useImageField(profile.bannerUrl)
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<{ displayName?: string; bio?: string; form?: string }>({})

  const nameError = !name.trim() ? 'Enter a name' : name.trim().length > NAME_MAX ? `Use at most ${NAME_MAX} characters` : undefined
  const bioLeft = BIO_MAX - bio.length
  const changed = name.trim() !== profile.displayName || bio.trim() !== (profile.bio ?? '') || avatar.value !== undefined || banner.value !== undefined
  const busy = avatar.status === 'uploading' || banner.status === 'uploading'
  const canSave = changed && !nameError && bioLeft >= 0 && !busy && !saving

  async function save() {
    setSaving(true)
    setErrors({})
    const body: Record<string, string> = {}
    if (name.trim() !== profile.displayName) body.displayName = name.trim()
    if (bio.trim() !== (profile.bio ?? '')) body.bio = bio.trim()
    if (avatar.value !== undefined) body.avatarKey = avatar.value
    if (banner.value !== undefined) body.bannerKey = banner.value
    try {
      const updated = await api.patch<UserResponse>('/api/users/me', body)
      setUser(updated)
      void queryClient.invalidateQueries({ queryKey: profileKey(profile.username) })
      invalidateFeeds(queryClient)
      toast('Your profile was updated.')
      onClose()
    } catch (e) {
      if (e instanceof ApiError) setErrors({ displayName: e.fieldErrors.displayName, bio: e.fieldErrors.bio, form: Object.keys(e.fieldErrors).length ? undefined : e.message })
      else setErrors({ form: 'Something went wrong. Please try again.' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open onClose={onClose} title="Edit profile">
      <div className="space-y-5">
        <Picker field={banner} label="banner">
          <div className="h-28 overflow-hidden rounded-lg bg-zinc-800">
            {banner.previewUrl && <img src={banner.previewUrl} alt="Banner preview" className="h-full w-full object-cover" />}
          </div>
        </Picker>
        <Picker field={avatar} label="profile photo">
          <Avatar src={avatar.previewUrl} name={name || profile.displayName} size="lg" />
        </Picker>
        <Field label="Name" value={name} error={errors.displayName ?? (name !== profile.displayName ? nameError : undefined)} onChange={(e) => setName(e.target.value)} />
        <div>
          <label htmlFor="edit-bio" className="mb-1 block text-sm font-medium text-zinc-300">Bio</label>
          <textarea id="edit-bio" value={bio} onChange={(e) => setBio(e.target.value)} rows={3} className="w-full resize-none rounded-md border border-zinc-700 bg-black px-3 py-2.5 focus:border-brand focus:outline-none" />
          <p aria-label={bioLeft >= 0 ? `${bioLeft} characters left` : `${-bioLeft} characters over the limit`} className={`mt-1 text-right text-sm ${bioLeft < 0 ? 'font-bold text-red-500' : 'text-zinc-500'}`}>{bioLeft}</p>
          {errors.bio && <p role="alert" className="text-sm text-red-400">{errors.bio}</p>}
        </div>
        {errors.form && <p role="alert" className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">{errors.form}</p>}
        <div className="flex justify-end"><Button onClick={() => void save()} disabled={!canSave} loading={saving}>Save</Button></div>
      </div>
    </Modal>
  )
}
