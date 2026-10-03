const layouts: Record<number, string> = {
  1: '',
  2: 'grid h-[286px] grid-cols-2 gap-0.5',
  3: 'grid h-[286px] grid-cols-2 grid-rows-2 gap-0.5',
  4: 'grid h-[286px] grid-cols-2 grid-rows-2 gap-0.5',
}

/** Up to four images in the usual grid: one large, two side by side, one tall + two small, or a 2x2. */
export function PostMedia({ urls }: { urls: string[] }) {
  if (urls.length === 0) return null
  const shown = urls.slice(0, 4)
  return (
    <div className={`mt-3 overflow-hidden rounded-2xl border border-zinc-800 ${layouts[shown.length]}`}>
      {shown.map((url, i) => (
        <img
          key={url}
          src={url}
          alt={shown.length === 1 ? 'Image attached to the post' : `Image ${i + 1} of ${shown.length} attached to the post`}
          loading="lazy"
          className={`bg-zinc-900 object-cover ${shown.length === 1 ? 'max-h-[510px] w-full' : 'h-full w-full'} ${shown.length === 3 && i === 0 ? 'row-span-2' : ''}`}
        />
      ))}
    </div>
  )
}
