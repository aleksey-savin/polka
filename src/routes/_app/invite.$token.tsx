import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'

import { Card, CardContent } from '@/components/ui/card'
import { acceptInviteFn } from '@/server/libraries'

export const Route = createFileRoute('/_app/invite/$token')({
  component: InvitePage,
})

function InvitePage() {
  const { token } = Route.useParams()
  const navigate = Route.useNavigate()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    acceptInviteFn({ data: { token } })
      .then(({ libraryId }) =>
        navigate({ to: '/libraries', search: { lib: libraryId } }),
      )
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : 'Приглашение не действует')
      })
  }, [token])

  return (
    <div className="mx-auto max-w-md py-16">
      <Card>
        <CardContent className="py-10 text-center">
          {error ? (
            <p className="text-destructive">{error}</p>
          ) : (
            <p className="text-muted-foreground">
              Присоединяем вас к библиотеке…
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
