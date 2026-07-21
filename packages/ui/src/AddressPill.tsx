import styles from './AddressPill.module.css'

export interface AddressPillProps {
  value: string
  placeholder?: string
  title?: string
  onClick?: () => void
}

/** Reads as an address field but is a button: clicking opens the command
 *  palette rather than editing in place, which is the Arc arrangement. */
export function AddressPill({ value, placeholder = 'new tab', title, onClick }: AddressPillProps) {
  return (
    <button type="button" className={styles.address} title={title} onClick={onClick}>
      {value || placeholder}
    </button>
  )
}
