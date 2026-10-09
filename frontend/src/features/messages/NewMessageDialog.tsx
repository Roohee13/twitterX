import { Modal } from '../../components/ui/Modal'
import { PeopleSearch } from './PeopleSearch'
import { useStartConversation } from './messageHooks'

/** Find someone by name or username and open a conversation with them. */
export function NewMessageDialog({ onClose }: { onClose: () => void }) {
  const start = useStartConversation()
  return (
    <Modal open onClose={onClose} title="New message">
      <PeopleSearch label="Search people" onPick={(user) => void start(user.username).then((ok) => ok && onClose())} />
    </Modal>
  )
}
