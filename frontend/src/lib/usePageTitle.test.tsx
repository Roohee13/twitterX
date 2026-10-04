import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PageHeader } from '../features/shell/PageHeader'
import { usePageTitle } from './usePageTitle'

function Titled({ title }: { title: string }) {
  usePageTitle(title)
  return null
}

describe('page titles', () => {
  it('puts the page name in front of the site name, and follows changes', () => {
    const { rerender } = render(<Titled title="Notifications" />)
    expect(document.title).toBe('Notifications / XClone')
    rerender(<Titled title="Messages" />)
    expect(document.title).toBe('Messages / XClone')
  })

  it('every page that shows a header gets its title from it', () => {
    render(<PageHeader title="Settings" />)
    expect(document.title).toBe('Settings / XClone')
  })
})
