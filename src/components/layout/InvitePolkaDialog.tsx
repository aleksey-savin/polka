import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer'
import { Input } from '@/components/ui/input'
import { inviteMailReadyFn } from '@/server/mail'
import { createSignupInviteFn, inviteByEmailFn } from '@/server/shares'

/**
 * Приглашение в Полку. Живёт отдельно от «Друзей»: этот же поток открывается
 * из профиля — люди искали приглашение там.
 */
export function InvitePolkaDialog({ trigger }: { trigger?: ReactNode }) {
  const [link, setLink] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [email, setEmail] = useState('')
  const [mailReady, setMailReady] = useState(false)

  // «отправить письмом» показываем, только когда почта настроена
  useEffect(() => {
    void inviteMailReadyFn()
      .then(setMailReady)
      .catch(() => {})
  }, [])

  async function sendInvite() {
    setBusy(true)
    try {
      const result = await inviteByEmailFn({ data: { email: email.trim() } })
      setLink(result.url)
      toast[result.sent ? 'success' : 'error'](
        result.sent
          ? `Приглашение отправлено на ${email.trim()}`
          : 'Письмо не ушло — передайте ссылку сами',
      )
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не получилось')
    } finally {
      setBusy(false)
    }
  }

  async function generate() {
    setBusy(true)
    try {
      const { token } = await createSignupInviteFn()
      setLink(`${window.location.origin}/join/${token}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Drawer onOpenChange={(o) => !o && setLink(null)}>
      <DrawerTrigger asChild>
        {trigger ?? <Button variant="outline">Пригласить в Полку</Button>}
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>Приглашение зарегистрироваться</DrawerTitle>
          <DrawerDescription>
            Регистрация в Полке — только по таким ссылкам. Ссылка одноразовая,
            живёт 7 дней. Чтобы человек попал в вашу библиотеку совладельцем —
            после регистрации пришлите ему ещё инвайт из шапки библиотеки.
          </DrawerDescription>
        </DrawerHeader>
        {!link && mailReady && (
          <div className="mb-3 grid gap-2">
            <Input
              type="email"
              placeholder="почта человека"
              className="h-12 rounded-xl text-[16px]"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <Button
              variant="outline"
              loading={busy}
              disabled={!email.trim()}
              onClick={() => void sendInvite()}
            >
              Отправить письмом
            </Button>
            <p className="text-center text-[12.5px] text-muted-foreground">
              или получите ссылку и передайте сами
            </p>
          </div>
        )}
        {link ? (
          <div className="grid gap-2">
            <Input
              readOnly
              value={link}
              className="font-mono text-xs"
              onFocus={(e) => e.target.select()}
            />
            <Button
              onClick={() =>
                void navigator.clipboard.writeText(link).then(() => {
                  setCopied(true)
                  setTimeout(() => setCopied(false), 1500)
                })
              }
            >
              {copied ? 'Скопировано' : 'Скопировать ссылку'}
            </Button>
          </div>
        ) : (
          <DrawerFooter>
            <Button onClick={() => void generate()} loading={busy}>
              Создать ссылку
            </Button>
          </DrawerFooter>
        )}
      </DrawerContent>
    </Drawer>
  )
}
