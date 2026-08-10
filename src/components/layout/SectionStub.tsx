import { Card, CardContent } from '@/components/ui/card'

// Временная заглушка раздела на время стройки MVP (см. docs/roadmap.md).
export function SectionStub({
  title,
  milestone,
}: {
  title: string
  milestone: string
}) {
  return (
    <div className="grid gap-4">
      <h1 className="text-3xl font-semibold">{title}</h1>
      <Card>
        <CardContent className="py-10 text-center text-muted-foreground">
          Раздел строится — появится на этапе {milestone} (см. docs/roadmap.md).
        </CardContent>
      </Card>
    </div>
  )
}
