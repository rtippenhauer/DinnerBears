import { BrandConfigService } from '../../core/services/brand-config.service';

/**
 * Shared release notes (see docs/RELEASE_NOTE_PIPELINE_SPEC.md) ship with
 * {{points}}/{{locations}}/{{events}} placeholder tokens instead of hardcoded
 * wording, so one note reads correctly on every fork's own terminology.
 * Instance-specific notes never contain these tokens, so this is a no-op for
 * them. Apply it everywhere a release's title or body is shown to members.
 */
export function substituteTerms(content: string, brand: BrandConfigService): string {
  return content
    .replace(/\{\{\s*points\s*\}\}/gi, brand.points())
    .replace(/\{\{\s*locations\s*\}\}/gi, brand.locationPluralLower())
    .replace(/\{\{\s*events\s*\}\}/gi, brand.dinnerPluralLower());
}
