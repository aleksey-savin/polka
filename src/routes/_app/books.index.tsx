import { createFileRoute } from '@tanstack/react-router'

import { SectionStub } from '@/components/layout/SectionStub'

export const Route = createFileRoute('/_app/books/')({
  component: () => <SectionStub title="Каталог" milestone="M3" />,
})
