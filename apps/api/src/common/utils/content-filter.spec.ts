import { BadRequestException } from '@nestjs/common';

import {
  assertAcceptableUserContent,
  containsObjectionableContent,
  normalizeForFilter,
} from './content-filter';

describe('content-filter', () => {
  describe('blocks', () => {
    it.each([
      'what the fuck is this ruling',
      'FUCKING ridiculous',
      'this is bullshit',
      'sh!t happens',
      'b1tch',
      'sh1t decision',
      '$hit',
      'fuuuuck',
      'shit!',
      'you are a bitch',
      'what an asshole',
      'a$$hole',
      'go kill yourself',
      'killyourself',
      'kys',
      'putang ina mo',
      'putangina',
      'tangina talaga',
      'gago ka',
      'tarantado',
      'pakyu',
      'Fúck', // accent folding
    ])('%s', (text) => {
      expect(containsObjectionableContent(text)).toBe(true);
    });
  });

  describe('allows legal vocabulary and lookalikes', () => {
    it.each([
      'The accused was convicted of rape under Art. 266-A of the Revised Penal Code.',
      'Murder and homicide are distinguished by qualifying circumstances.',
      'Sexual assault; prostitution; illegal drugs under R.A. 9165.',
      'G.R. No. 123456, Art. 315 estafa, 1st and 4th divisions',
      'Assessment of the assessor in Scunthorpe',
      'shiitake mushrooms and a spicy dish',
      'there are chinks in the armor of the defense',
      'a putative father',
      'the victim was a mental retardate under older jurisprudence',
      'Senator Dick Gordon; Lady Gaga; the Republic of Niger',
      'Batangas City',
      'passing the bar exam',
      '',
    ])('%s', (text) => {
      expect(containsObjectionableContent(text)).toBe(false);
    });

    it('handles null and undefined', () => {
      expect(containsObjectionableContent(null)).toBe(false);
      expect(containsObjectionableContent(undefined)).toBe(false);
    });
  });

  describe('normalizeForFilter', () => {
    it('leaves plain numbers alone', () => {
      expect(normalizeForFilter('Art. 315, G.R. No. 123456')).toBe('art. 315, g.r. no. 123456');
    });

    it('translates leetspeak inside words but keeps trailing bangs', () => {
      expect(normalizeForFilter('Sh1t!!')).toBe('shit!!');
    });
  });

  describe('assertAcceptableUserContent', () => {
    it('throws 400 naming the noun when any text is objectionable', () => {
      expect(() => assertAcceptableUserContent('comment', 'fine', 'bullshit')).toThrow(
        new BadRequestException(
          "Your comment contains language that isn't allowed under our Community Guidelines. Please revise it.",
        ),
      );
    });

    it('passes clean and empty texts', () => {
      expect(() => assertAcceptableUserContent('post', 'A question on estafa', null, undefined)).not.toThrow();
    });
  });
});
