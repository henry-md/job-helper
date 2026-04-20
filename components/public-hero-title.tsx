"use client";

import { useEffect, useState } from "react";

type PublicHeroTitleProps = {
  className?: string;
  sentencePauseMs?: number;
  text: string;
  wordPauseMs?: number;
  wordsPerMinute?: number;
};

function getMillisecondsPerCharacter(wordsPerMinute: number) {
  return Math.max(1, Math.round(60000 / (wordsPerMinute * 5)));
}

function isSentenceEndingCharacter(character: string) {
  return character === "." || character === "!" || character === "?";
}

export default function PublicHeroTitle({
  className = "",
  sentencePauseMs = 200,
  text,
  wordPauseMs = 150,
  wordsPerMinute = 80,
}: PublicHeroTitleProps) {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncPreference = () => setPrefersReducedMotion(mediaQuery.matches);

    syncPreference();

    mediaQuery.addEventListener("change", syncPreference);

    return () => {
      mediaQuery.removeEventListener("change", syncPreference);
    };
  }, []);

  const animationKey = [
    text,
    wordsPerMinute,
    sentencePauseMs,
    wordPauseMs,
    prefersReducedMotion ? "reduce" : "animate",
  ].join(":");

  return (
    <AnimatedPublicHeroTitle
      key={animationKey}
      className={className}
      prefersReducedMotion={prefersReducedMotion}
      sentencePauseMs={sentencePauseMs}
      text={text}
      wordPauseMs={wordPauseMs}
      wordsPerMinute={wordsPerMinute}
    />
  );
}

function AnimatedPublicHeroTitle({
  className = "",
  prefersReducedMotion,
  sentencePauseMs = 200,
  text,
  wordPauseMs = 150,
  wordsPerMinute = 80,
}: PublicHeroTitleProps & { prefersReducedMotion: boolean }) {
  const [visibleCount, setVisibleCount] = useState(0);
  const millisecondsPerCharacter =
    getMillisecondsPerCharacter(wordsPerMinute);

  useEffect(() => {
    if (prefersReducedMotion || visibleCount >= text.length) {
      return;
    }

    const previousCharacter =
      visibleCount > 0 ? (text[visibleCount - 1] ?? "") : "";
    let delayMs = millisecondsPerCharacter;

    if (previousCharacter === " ") {
      delayMs = wordPauseMs;
    } else if (isSentenceEndingCharacter(previousCharacter)) {
      delayMs = millisecondsPerCharacter + sentencePauseMs;
    }

    const timeoutId = window.setTimeout(() => {
      setVisibleCount((currentCount) =>
        Math.min(currentCount + 1, text.length),
      );
    }, delayMs);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [
    millisecondsPerCharacter,
    prefersReducedMotion,
    sentencePauseMs,
    text,
    visibleCount,
    wordPauseMs,
  ]);

  const visibleText = prefersReducedMotion ? text : text.slice(0, visibleCount);
  const isTypingComplete = visibleCount >= text.length;

  return (
    <h1 className={`relative ${className}`}>
      <span aria-hidden="true" className="invisible block whitespace-pre-wrap">
        {text}
      </span>
      <span
        aria-hidden="true"
        className="absolute inset-0 block whitespace-pre-wrap"
      >
        {visibleText}
        {!prefersReducedMotion ? (
          <span
            className={`public-hero-title-caret${
              isTypingComplete ? " public-hero-title-caret--complete" : ""
            }`}
          />
        ) : null}
      </span>
      <span className="sr-only">{text.replace(/\n/g, " ")}</span>
    </h1>
  );
}
