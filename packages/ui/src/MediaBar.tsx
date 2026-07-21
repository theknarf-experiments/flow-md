import styles from './MediaBar.module.css'

export interface MediaBarProps {
  /** What's playing. The tab's own title, because that's what a person calls
   *  the thing making noise — not the media element's filename. */
  title: string
  playing: boolean
  muted?: boolean
  onPlayPause?: () => void
  onToggleMute?: () => void
  /** Jump to the tab that's playing. The bar is also a way back to it. */
  onSelect?: () => void
}

/** Controls for whatever the browser is playing, docked in the sidebar.
 *
 *  One bar, not one per tab: a browser plays one thing at a time in practice,
 *  and a list of every noisy tab is the tab list, which is right above. */
export function MediaBar(props: MediaBarProps) {
  const { title, playing, muted, onPlayPause, onToggleMute, onSelect } = props
  return (
    <div className={styles.bar}>
      <button
        type="button"
        className={styles.play}
        aria-label={playing ? 'pause' : 'play'}
        onClick={onPlayPause}
      >
        {playing ? '❚❚' : '▶'}
      </button>
      <button type="button" className={styles.title} onClick={onSelect} title={title}>
        {title || 'Playing'}
      </button>
      <button
        type="button"
        className={styles.mute}
        aria-label={muted ? 'unmute' : 'mute'}
        onClick={onToggleMute}
      >
        {muted ? '🔇' : '🔊'}
      </button>
    </div>
  )
}
