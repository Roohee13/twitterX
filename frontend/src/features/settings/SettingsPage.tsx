import { PageHeader } from '../shell/PageHeader'
import { EmailForm, PasswordForm, UsernameForm } from './AccountForms'
import { AdminEmailTool } from './AdminEmailTool'
import { AdminStorageTool } from './AdminStorageTool'
import { AppearanceSection } from './AppearanceSection'
import { DangerZone } from './DangerZone'
import { PrivacySection } from './PrivacySection'
import { RelationList } from './RelationLists'

/** Account, appearance, privacy, blocked and muted accounts, and leaving: one page, one section after another. */
export function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings" />
      <UsernameForm />
      <EmailForm />
      <PasswordForm />
      <AppearanceSection />
      <PrivacySection />
      <RelationList kind="block" />
      <RelationList kind="mute" />
      <AdminEmailTool />
      <AdminStorageTool />
      <DangerZone />
    </>
  )
}
