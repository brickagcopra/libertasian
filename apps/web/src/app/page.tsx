import { PublicFooter } from '@/components/layout/public-footer';
import { PublicHeader } from '@/components/layout/public-header';
import { Contributors } from '@/features/homepage/components/contributors';
import { FeaturesAccordion } from '@/features/homepage/components/features-accordion';
import { Hero } from '@/features/homepage/components/hero';
import { Signup } from '@/features/homepage/components/signup';
import { StatsStrip } from '@/features/homepage/components/stats-strip';
import { StudyPicker } from '@/features/homepage/components/study-picker';
import {
  DEFAULT_HOMEPAGE_CONTENT,
  getHomepageContent,
} from '@/features/homepage/server/homepage-content';

export default async function HomePage() {
  const content = await getHomepageContent();

  const stats = content.stats ?? DEFAULT_HOMEPAGE_CONTENT.stats!;
  const studyPicker = content.studyPicker ?? DEFAULT_HOMEPAGE_CONTENT.studyPicker!;
  const featuresAccordion =
    content.featuresAccordion ?? DEFAULT_HOMEPAGE_CONTENT.featuresAccordion!;
  const contributors = content.contributors ?? DEFAULT_HOMEPAGE_CONTENT.contributors!;
  const signupForm = content.signupForm ?? DEFAULT_HOMEPAGE_CONTENT.signupForm!;

  return (
    <div className="public-warm min-h-screen">
      <PublicHeader />
      <main>
        <Hero hero={content.hero} />
        <StatsStrip stats={stats} />
        <StudyPicker picker={studyPicker} />
        <FeaturesAccordion features={featuresAccordion} />
        <Contributors contributors={contributors} />
        <Signup signup={signupForm} />
      </main>
      <PublicFooter />
    </div>
  );
}
