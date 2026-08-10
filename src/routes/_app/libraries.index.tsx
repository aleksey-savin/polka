import { createFileRoute } from '@tanstack/react-router'

import { SectionStub } from '@/components/layout/SectionStub'

export const Route = createFileRoute('/_app/libraries/')({
  component: () => <SectionStub title="Библиотека" milestone="M3" />,
})
