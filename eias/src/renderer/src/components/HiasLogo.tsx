// The HIAS app logo. Same artwork as the window/installer icon (resources/icon.svg),
// so the brand stays consistent everywhere; regenerate the icons with `npm run icons`.
import logoUrl from "../../../../resources/icon.svg"

export default function HiasLogo({ className = "w-9 h-9" }: { className?: string }) {
  return <img src={logoUrl} alt="HIAS logo" className={`${className} flex-shrink-0 select-none`} draggable={false} />
}
