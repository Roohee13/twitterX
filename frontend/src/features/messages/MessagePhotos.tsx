/** The photos of one message, one large or a 2-column grid. A click opens the full picture in a new tab. */
export function MessagePhotos({ urls }: { urls: string[] }) {
  if (urls.length === 0) return null
  const shown = urls.slice(0, 4)
  const single = shown.length === 1
  return (
    <div className={single ? '' : 'grid grid-cols-2 gap-0.5'}>
      {shown.map((url, i) => (
        <a key={url} href={url} target="_blank" rel="noopener noreferrer" aria-label={single ? 'Open photo' : `Open photo ${i + 1} of ${shown.length}`} className="block">
          <img
            src={url}
            alt={single ? 'Photo in the message' : `Photo ${i + 1} of ${shown.length} in the message`}
            loading="lazy"
            className={`bg-zinc-900 object-cover ${single ? 'max-h-80 w-full min-w-48' : 'h-32 w-full'}`}
          />
        </a>
      ))}
    </div>
  )
}
