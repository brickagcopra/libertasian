import Link from 'next/link';

import { Owl } from '@/components/brand/owl';

import type { HomepageContent } from '../server/homepage-content';

interface SignupProps {
  signup: NonNullable<HomepageContent['signupForm']>;
}

export function Signup({ signup }: SignupProps) {
  return (
    <section className="px-6 pb-20 pt-8 sm:px-10" style={{ background: 'var(--warm-cream)' }}>
      <div className="relative mx-auto max-w-[1100px]">
        <div
          className="relative overflow-hidden rounded-[48px] px-6 py-12 sm:px-12 lg:px-16 lg:pb-14 lg:pt-16"
          style={{ background: 'var(--warm-cream-3)' }}
        >
          <div
            className="absolute right-6 top-4 hidden sm:block"
            style={{ transform: 'rotate(8deg)' }}
            aria-hidden
          >
            <Owl size={120} />
          </div>

          <h2
            className="m-0 text-center uppercase"
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 'clamp(36px, 5vw, 56px)',
              fontWeight: 500,
              color: 'var(--warm-ink)',
              letterSpacing: '-1.8px',
              lineHeight: 0.95,
            }}
          >
            {signup.headlineLine1}
            <br />
            <em className="italic" style={{ color: 'var(--warm-accent)' }}>
              {signup.headlineAccent}
            </em>
          </h2>
          <p
            className="mx-auto mt-4 max-w-md text-center"
            style={{ fontSize: 15, color: 'var(--warm-ink-mid)', lineHeight: 1.5 }}
          >
            {signup.body}
          </p>

          <div
            className="mx-auto mt-9 grid max-w-[720px] gap-5"
            role="group"
            aria-label="Sign up preview"
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label={signup.nameLabel} placeholder="Juan Dela Cruz" />
              <Field label={signup.emailLabel} placeholder="juan@up.edu.ph" type="email" />
            </div>
            <ChipGroup label={signup.stageLabel} options={signup.stages} activeIndex={4} />
            <ChipGroup label={signup.subjectsLabel} options={signup.subjects} activeIndices={[0, 1, 6]} />
            <Link
              href={signup.ctaHref}
              className="mt-2 inline-flex items-center justify-center rounded-2xl px-6 py-4 text-base font-semibold transition-opacity hover:opacity-90"
              style={{
                background: 'var(--warm-ink)',
                color: 'var(--warm-cream)',
                letterSpacing: '-0.2px',
              }}
            >
              {signup.ctaText}
            </Link>
            <p
              className="text-center text-xs"
              style={{ color: 'var(--warm-ink-faint)' }}
            >
              {signup.finePrint}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="uppercase"
      style={{
        fontSize: 12,
        fontWeight: 600,
        color: 'var(--warm-ink-soft)',
        letterSpacing: '0.4px',
      }}
    >
      {children}
    </span>
  );
}

function Field({
  label,
  placeholder,
  type = 'text',
}: {
  label: string;
  placeholder: string;
  type?: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label>{label}</Label>
      <input
        type={type}
        placeholder={placeholder}
        className="h-[54px] rounded-2xl border-[1.5px] bg-white px-4 text-base outline-none focus:outline-2 focus:outline-offset-2"
        style={{
          borderColor: 'var(--warm-ink)',
          color: 'var(--warm-ink)',
        }}
      />
    </div>
  );
}

function ChipGroup({
  label,
  options,
  activeIndex,
  activeIndices,
}: {
  label: string;
  options: string[];
  activeIndex?: number;
  activeIndices?: number[];
}) {
  const isActive = (i: number) =>
    activeIndex === i || (activeIndices ? activeIndices.includes(i) : false);
  return (
    <div>
      <Label>{label}</Label>
      <div className="mt-2 flex flex-wrap gap-2">
        {options.map((opt, i) => (
          <span
            key={opt}
            className="inline-flex h-10 items-center rounded-full border-[1.5px] px-4 text-sm font-medium"
            style={{
              background: isActive(i) ? 'var(--warm-ink)' : 'var(--warm-surface)',
              color: isActive(i) ? 'var(--warm-cream)' : 'var(--warm-ink)',
              borderColor: isActive(i) ? 'transparent' : 'var(--warm-ink)',
            }}
          >
            {opt}
          </span>
        ))}
      </div>
    </div>
  );
}
