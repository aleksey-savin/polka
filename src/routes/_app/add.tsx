import { createFileRoute } from '@tanstack/react-router'

import { SectionStub } from '@/components/layout/SectionStub'

export const Route = createFileRoute('/_app/add')({
  component: () => <SectionStub title="Добавить книгу" milestone="M4" />,
})
