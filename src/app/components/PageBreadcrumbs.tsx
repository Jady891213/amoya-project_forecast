import { ChevronRight } from 'lucide-react'

export interface BreadcrumbItem {
  label: string
  onClick?: () => void
}

export function PageBreadcrumbs({ items }: { items: BreadcrumbItem[] }) {
  return <nav className="page-breadcrumbs" aria-label="面包屑导航">
    {items.map((item, index) => <span key={`${item.label}-${index}`}>
      {index > 0 && <ChevronRight size={12} />}
      {item.onClick
        ? <button type="button" onClick={item.onClick}>{item.label}</button>
        : <b aria-current={index === items.length - 1 ? 'page' : undefined}>{item.label}</b>}
    </span>)}
  </nav>
}
