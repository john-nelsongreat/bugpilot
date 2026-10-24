import { useEffect, useState } from 'react'
import { FOOTER_JOKES, type FooterPageKey } from '../content/footerJokes'
import {
  FOOTER_JOKE_INTERVAL_MS,
  chooseJokeIndex,
  readLastJokeIndex,
  writeLastJokeIndex,
} from '../features/footer/footerJoke'

type FooterJokeProps = {
  pageKey: FooterPageKey
  random?: () => number
  intervalMs?: number
}

export function FooterJoke({
  pageKey,
  random = Math.random,
  intervalMs = FOOTER_JOKE_INTERVAL_MS,
}: FooterJokeProps) {
  const [jokeIndex, setJokeIndex] = useState(() =>
    chooseJokeIndex(
      readLastJokeIndex(pageKey),
      random,
      FOOTER_JOKES[pageKey].length,
    ),
  )

  useEffect(() => {
    writeLastJokeIndex(pageKey, jokeIndex)
  }, [jokeIndex, pageKey])

  useEffect(() => {
    const timer = window.setInterval(() => {
      setJokeIndex((current) =>
        chooseJokeIndex(current, random, FOOTER_JOKES[pageKey].length),
      )
    }, intervalMs)

    return () => window.clearInterval(timer)
  }, [intervalMs, pageKey, random])

  return <span className="footer-joke">{FOOTER_JOKES[pageKey][jokeIndex]}</span>
}
