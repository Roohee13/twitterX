import { useEffect } from 'react'

/** The text in the browser tab and in the history list; it is also what a screen reader announces after moving to another page. */
export function usePageTitle(title: string) {
  useEffect(() => {
    document.title = `${title} / XClone`
  }, [title])
}
