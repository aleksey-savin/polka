import { createFileRoute } from '@tanstack/react-router'

import { SectionStub } from '@/components/layout/SectionStub'

export const Route = createFileRoute('/_app/friends')({
  component: () => <SectionStub title="Друзья" milestone="M6" />,
})
