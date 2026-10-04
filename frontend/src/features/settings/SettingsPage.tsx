import { PageHeader } from '../shell/PageHeader'
import { EmailForm, PasswordForm, UsernameForm } from './AccountForms'
import { DangerZone } from './DangerZone'
import { PrivacySection } from './PrivacySection'
import { RelationList } from './RelationLists'

/** Account, privacy, blocked and muted accounts, and leaving: one page, one section after another. */
export function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings" />
      <UsernameForm />
      <EmailForm />
      <PasswordForm />
      <PrivacySection />
      <RelationList kind="block" />
      <RelationList kind="mute" />
      <DangerZone />
    </>
  )
}
