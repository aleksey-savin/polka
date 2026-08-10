import { createFileRoute } from '@tanstack/react-router'

import { SectionStub } from '@/components/layout/SectionStub'

export const Route = createFileRoute('/_app/loans')({
  component: () => <SectionStub title="На руках" milestone="M5" />,
})
