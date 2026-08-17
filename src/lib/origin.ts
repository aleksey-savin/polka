import { useEffect } from 'react'

import type { Crumb } from '@/components/layout/Breadcrumbs'

/**
 * «Откуда пришёл» и «где я был» — один источник правды для крошек и возвратов.
 *
 * Списки при открытии записывают себя сюда, страницы книги и произведения
 * читают: так крошки ведут в ту библиотеку, откуда пришли, а удаление
 * возвращает туда же, а не в общий каталог.
 *
 * Живёт в sessionStorage: это состояние сеанса, а не настройка. Выбранная
 * библиотека — наоборот, в localStorage: её ждёшь и после перезапуска.
 */

const ORIGIN_KEY = 'polka.origin'
const LIBRARY_KEY = 'polka.lastLibrary'

export interface Origin {
  label: string
  to: string
  params?: Record<string, string>
  search?: Record<string, unknown>
}

function read<T>(storage: Storage | undefined, key: string): T | null {
  try {
    const raw = storage?.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

export function rememberOrigin(origin: Origin): void {
  try {
    sessionStorage.setItem(ORIGIN_KEY, JSON.stringify(origin))
  } catch {
    // приватный режим — крошки просто останутся без источника
  }
}

export function currentOrigin(): Origin | null {
  if (typeof window === 'undefined') return null
  return read<Origin>(window.sessionStorage, ORIGIN_KEY)
}

/** Список объявляет себя источником: вызывать на самой странице списка. */
export function useAsOrigin(origin: Origin | null): void {
  const key = origin ? JSON.stringify(origin) : null
  useEffect(() => {
    if (key) rememberOrigin(JSON.parse(key) as Origin)
  }, [key])
}

/** Последняя библиотека — чтобы выбор не сбрасывался между переходами. */
export function rememberLibrary(libraryId: string | null | undefined): void {
  try {
    if (libraryId) localStorage.setItem(LIBRARY_KEY, libraryId)
    else localStorage.removeItem(LIBRARY_KEY)
  } catch {
    // не судьба — просто не запомним
  }
}

export function lastLibrary(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(LIBRARY_KEY)
  } catch {
    return null
  }
}

/** Крошка источника, если он есть и это не сама текущая страница. */
export function originCrumb(currentPath?: string): Crumb | null {
  const origin = currentOrigin()
  if (!origin || (currentPath && origin.to === currentPath)) return null
  return {
    label: origin.label,
    to: origin.to,
    params: origin.params,
    search: origin.search,
  }
}
