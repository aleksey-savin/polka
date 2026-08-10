import { createFileRoute } from '@tanstack/react-router'

import { SectionStub } from '@/components/layout/SectionStub'

export const Route = createFileRoute('/_app/requests')({
  component: () => <SectionStub title="Заявки" milestone="M6" />,
})
