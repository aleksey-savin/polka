import { createFileRoute } from '@tanstack/react-router'

import { SectionStub } from '@/components/layout/SectionStub'

export const Route = createFileRoute('/_app/wishlist')({
  component: () => <SectionStub title="Хочу" milestone="M5" />,
})
