import { ArrowLeft, ChevronRight } from 'lucide-react'

export interface BreadcrumbItem {
  label: string
  onClick?: () => void
}

export function PageBreadcrumbs({ items, back }: { items: BreadcrumbItem[]; back?: BreadcrumbItem }) {
  return <nav className="page-breadcrumbs" aria-label="面包屑导航">
    {back?.onClick && <button type="button" className="breadcrumb-back" onClick={back.onClick}><ArrowLeft size={14} />{back.label}</button>}
    {items.map((item, index) => <span key={`${item.label}-${index}`}>
      {(index > 0 || back) && <ChevronRight size={12} />}
      {item.onClick
        ? <button type="button" onClick={item.onClick}>{item.label}</button>
        : <b aria-current={index === items.length - 1 ? 'page' : undefined}>{item.label}</b>}
    </span>)}
  </nav>
}
