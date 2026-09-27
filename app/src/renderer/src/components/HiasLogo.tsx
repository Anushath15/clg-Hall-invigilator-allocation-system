// The HIAS app logo. Same image as the window/installer icon (resources/icon.png,
// generated from resources/logo-source.webp by `npm run icons`), so the brand stays
// consistent everywhere.
import logoUrl from "../../../../resources/icon.png"

export default function HiasLogo({ className = "w-9 h-9" }: { className?: string }) {
  return <img src={logoUrl} alt="HIAS logo" className={`${className} flex-shrink-0 select-none`} draggable={false} />
}
