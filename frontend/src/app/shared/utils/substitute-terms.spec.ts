import { BrandConfigService } from '../../core/services/brand-config.service';
import { substituteTerms } from './substitute-terms';

// Placeholders must be swapped for this instance's words wherever a release
// note is shown — the login splash used to show raw {{events}}.
describe('substituteTerms', () => {
  const brand = {
    points: () => 'Bear Points',
    locationPluralLower: () => 'restaurants',
    dinnerPluralLower: () => 'dinners',
  } as unknown as BrandConfigService;

  it('replaces every placeholder, with or without inner spaces', () => {
    expect(substituteTerms('Upcoming {{events}} at our {{ locations }} earn {{POINTS}}; more {{events}}.', brand))
      .toBe('Upcoming dinners at our restaurants earn Bear Points; more dinners.');
  });

  it('leaves text without placeholders alone', () => {
    expect(substituteTerms('<p>Hello {{name}}</p>', brand)).toBe('<p>Hello {{name}}</p>');
  });
});
