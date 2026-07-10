'use client';

import { useEffect, useRef } from 'react';

/**
 * Shared UI for the mobile checkout bounce pages.
 *
 * Xendit requires https redirect URLs, so the mobile app sends users here
 * after payment. This page hands the user back to the app via the
 * `libertasian://` scheme — one automatic attempt on mount, plus a
 * prominent manual button in case the OS blocks the auto-redirect.
 */
interface MobileBounceContentProps {
  title: string;
  message: string;
  deepLink: string;
  buttonLabel: string;
}

export function MobileBounceContent({
  title,
  message,
  deepLink,
  buttonLabel,
}: MobileBounceContentProps) {
  const attempted = useRef(false);

  useEffect(() => {
    if (attempted.current) return;
    attempted.current = true;
    window.location.href = deepLink;
  }, [deepLink]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-[#F6F1E8] px-6 text-center text-[#1C1A14]">
      <h1
        className="text-3xl"
        style={{ fontFamily: 'var(--font-display), Georgia, serif' }}
      >
        {title}
      </h1>
      <p className="mt-3 max-w-sm text-base text-[#5C5448]">{message}</p>
      <a
        href={deepLink}
        className="mt-8 inline-block rounded-full bg-[#1C1A14] px-8 py-4 text-base font-semibold text-[#F6F1E8]"
      >
        {buttonLabel}
      </a>
    </main>
  );
}
