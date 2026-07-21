import styles from './HueSwatches.module.css'

export interface HueSwatchesProps {
  hues: number[]
  value: number
  onSelect: (hue: number) => void
}

/** A row of colour choices, each showing the gradient it will produce rather
 *  than a flat sample — that's what the window actually looks like. */
export function HueSwatches({ hues, value, onSelect }: HueSwatchesProps) {
  return (
    <div className={styles.row}>
      {hues.map((hue) => (
        <button
          key={hue}
          type="button"
          className={`${styles.swatch} ${hue === value ? styles.active : ''}`}
          style={{
            background: `linear-gradient(150deg, hsl(${hue} 42% 46%), hsl(${hue + 40} 32% 26%))`,
          }}
          aria-label={`Hue ${hue}`}
          aria-pressed={hue === value}
          onClick={() => onSelect(hue)}
        />
      ))}
    </div>
  )
}
