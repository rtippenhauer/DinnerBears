import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { writeFile } from 'fs/promises';
import { mkdirSync } from 'fs';
import { join } from 'path';
import Anthropic from '@anthropic-ai/sdk';
import { LocationEntity } from '../../database/entities/location.entity';
import { LocationPhotoEntity } from '../../database/entities/location-photo.entity';
import { EventEntity } from '../../database/entities/event.entity';
import { refreshUpcomingEventLocations } from '../../common/utils/event-location-snapshot.util';

export interface EnrichResult {
  name: string | null;
  description: string | null;
  phone: string | null;
  website: string | null;
  address: string | null;
  photoAdded: boolean;
  placeFound: boolean;
}

export interface EnrichDiagnosis {
  keys: {
    googlePlaces: boolean;
    anthropic: boolean;
  };
  location: {
    name: string;
    address: string;
    hasDescription: boolean;
    hasPhone: boolean;
    hasWebsite: boolean;
    photoCount: number;
  };
  places: {
    query: string;
    searchStatus: string;
    placeId: string | null;
    detailsStatus: string | null;
    editorialSummary: string | null;
    phone: string | null;
    website: string | null;
    formattedAddress: string | null;
    photoCount: number;
  } | null;
  claude: {
    status: 'ok' | 'skipped' | 'error';
    reason: string;
    generatedDescription: string | null;
  };
  willUpdate: string[];
  willSkip: string[];
}

interface PlaceSearchResponse {
  candidates: Array<{ place_id: string }>;
  status: string;
}

interface TextSearchResponse {
  results: Array<{
    place_id: string;
    name: string;
    formatted_address: string;
    geometry: { location: { lat: number; lng: number } };
  }>;
  status: string;
}

export interface PlaceSearchResult {
  placeId: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
}

interface AddressComponent {
  long_name: string;
  types: string[];
}

interface PlaceDetailsResponse {
  result: {
    name?: string;
    formatted_address?: string;
    address_components?: AddressComponent[];
    geometry?: { location: { lat: number; lng: number } };
    editorial_summary?: { overview: string };
    formatted_phone_number?: string;
    website?: string;
    photos?: Array<{ photo_reference: string }>;
  };
  status: string;
}

@Injectable()
export class EnrichmentService {
  private readonly logger = new Logger(EnrichmentService.name);
  private readonly googleKey: string | undefined;
  private readonly anthropic: Anthropic | null;
  private readonly uploadPath: string;

  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(LocationEntity)
    private readonly locationRepo: Repository<LocationEntity>,
    @InjectRepository(LocationPhotoEntity)
    private readonly photoRepo: Repository<LocationPhotoEntity>,
    @InjectRepository(EventEntity)
    private readonly eventRepo: Repository<EventEntity>,
  ) {
    this.googleKey = configService.get<string>('GOOGLE_PLACES_API_KEY');
    const anthropicKey = configService.get<string>('ANTHROPIC_API_KEY');
    this.anthropic = anthropicKey ? new Anthropic({ apiKey: anthropicKey }) : null;
    // This service only ever writes location photos, so point directly at that subfolder
    this.uploadPath = join(configService.get<string>('UPLOAD_PATH') ?? '/app/uploads', 'locations');
  }

  async bulkEnrich(
    locations: LocationEntity[],
    uploaderId: number,
    onProgress?: (done: number, total: number, name: string) => void,
  ): Promise<{ enriched: number; skipped: number; errors: number }> {
    let enriched = 0;
    let skipped = 0;
    let errors = 0;

    for (let i = 0; i < locations.length; i++) {
      const location = locations[i];
      onProgress?.(i, locations.length, location.name);
      try {
        const result = await this.enrich(location, uploaderId);
        const updated =
          result.description || result.phone || result.website || result.address || result.photoAdded;
        if (updated) {
          enriched++;
          this.logger.log(`[Bulk] ${i + 1}/${locations.length} enriched: ${location.name}`);
        } else {
          skipped++;
          this.logger.log(`[Bulk] ${i + 1}/${locations.length} nothing new: ${location.name}`);
        }
      } catch (err) {
        errors++;
        this.logger.error(`[Bulk] ${i + 1}/${locations.length} error: ${location.name}`, err);
      }
      // 400ms delay between locations to stay well within Google rate limits
      if (i < locations.length - 1) {
        await new Promise((r) => setTimeout(r, 400));
      }
    }

    this.logger.log(`[Bulk] Complete — enriched: ${enriched}, skipped: ${skipped}, errors: ${errors}`);
    return { enriched, skipped, errors };
  }

  async enrich(location: LocationEntity, uploaderId: number): Promise<EnrichResult> {
    const result: EnrichResult = {
      name: null,
      description: null,
      phone: null,
      website: null,
      address: null,
      photoAdded: false,
      placeFound: false,
    };

    // Residences aren't businesses — skip the Google Places lookup (which would
    // rewrite the name/phone/website/address to some nearby business) and the
    // "restaurant" description. Only try a Street View photo of the address, and
    // never touch the address itself.
    if (location.isResidence) {
      if (this.googleKey && location.photos.length === 0) {
        result.photoAdded = await this.downloadStreetViewPhoto(
          location.id,
          location.address,
          location.city?.name,
          uploaderId,
        );
      }
      await this.locationRepo.update(location.id, { enrichedAt: new Date() });
      return result;
    }

    let placeData: PlaceDetailsResponse['result'] | null = null;

    if (this.googleKey) {
      placeData = await this.fetchPlaceDetails(location.name, location.address);
      if (placeData) {
        result.placeFound = true;

        if (placeData.name) {
          const locality = placeData.address_components
            ? this.parseLocalityFromComponents(placeData.address_components)
            : location.city?.name ?? null;
          // Strip "- City, ST" disambiguation suffixes Google Places sometimes includes
          const baseName =
            placeData.name.replace(/\s*[-–—]\s*.+,\s*[A-Z]{2}\b.*$/, '').trim() ||
            placeData.name;
          const alreadyHasLocality =
            locality && baseName.toLowerCase().includes(locality.toLowerCase());
          result.name =
            locality && !alreadyHasLocality ? `${baseName} in ${locality}` : baseName;
        }
        if (placeData.formatted_phone_number) {
          result.phone = placeData.formatted_phone_number;
        }
        if (placeData.website) {
          result.website = placeData.website;
        }
        if (placeData.formatted_address) {
          result.address = placeData.formatted_address;
        }
        if (placeData.photos?.length) {
          const needed = Math.max(0, 5 - location.photos.length);
          if (needed > 0) {
            const start = location.photos.length; // skip photos already downloaded in prior enrichments
            const refs = placeData.photos.slice(start, start + needed).map((p) => p.photo_reference);
            const added = await this.downloadPlacePhotos(location.id, refs, uploaderId, location.photos.length);
            result.photoAdded = added > 0;
          }
        }
        // Street View fallback for addresses with no Places photos (e.g. private homes)
        if (!result.photoAdded && location.photos.length === 0) {
          result.photoAdded = await this.downloadStreetViewPhoto(
            location.id,
            location.address,
            location.city?.name,
            uploaderId,
          );
        }
      } else if (location.photos.length === 0) {
        // No Places match at all — try Street View directly
        result.photoAdded = await this.downloadStreetViewPhoto(
          location.id,
          location.address,
          location.city?.name,
          uploaderId,
        );
      }
    }

    if (this.anthropic) {
      result.description = await this.generateDescription(
        location.name,
        location.address,
        location.city?.name,
        placeData?.editorial_summary?.overview,
      );
    }

    // Persist updates directly
    const updates: Partial<LocationEntity> = { enrichedAt: new Date() };
    if (result.name) updates.name = result.name;
    if (result.description) updates.description = result.description;
    if (result.phone) updates.phone = result.phone;
    if (result.website) updates.websiteUrl = result.website;
    if (result.address) {
      updates.address = result.address;
      if (placeData?.geometry?.location) {
        updates.lat = placeData.geometry.location.lat;
        updates.lng = placeData.geometry.location.lng;
      }
    }
    await this.locationRepo.update(location.id, updates);
    if (updates.name || updates.address) {
      const fresh = await this.locationRepo.findOne({ where: { id: location.id } });
      if (fresh) await refreshUpcomingEventLocations(this.eventRepo, fresh);
    }

    return result;
  }

  async diagnose(location: LocationEntity): Promise<EnrichDiagnosis> {
    const diagnosis: EnrichDiagnosis = {
      keys: {
        googlePlaces: !!this.googleKey,
        anthropic: !!this.anthropic,
      },
      location: {
        name: location.name,
        address: location.address,
        hasDescription: !!location.description,
        hasPhone: !!location.phone,
        hasWebsite: !!location.websiteUrl,
        photoCount: location.photos?.length ?? 0,
      },
      places: null,
      claude: { status: 'skipped', reason: '', generatedDescription: null },
      willUpdate: [],
      willSkip: [],
    };

    // Google Places
    if (!this.googleKey) {
      diagnosis.places = null;
    } else {
      const query = `${location.name} ${location.address}`;
      const searchUrl =
        `https://maps.googleapis.com/maps/api/place/findplacefromtext/json` +
        `?input=${encodeURIComponent(query)}&inputtype=textquery&fields=place_id&key=${this.googleKey}`;

      let searchStatus = 'ERROR';
      let placeId: string | null = null;
      let detailsStatus: string | null = null;
      let editorialSummary: string | null = null;
      let phone: string | null = null;
      let website: string | null = null;
      let formattedAddress: string | null = null;
      let photoCount = 0;

      try {
        const searchRes = await fetch(searchUrl);
        const searchData = (await searchRes.json()) as PlaceSearchResponse;
        searchStatus = searchData.status;

        if (searchData.status === 'OK' && searchData.candidates.length) {
          placeId = searchData.candidates[0].place_id;
          const fields =
            'name,formatted_address,address_components,geometry,editorial_summary,formatted_phone_number,website,photos';
          const detailUrl =
            `https://maps.googleapis.com/maps/api/place/details/json` +
            `?place_id=${placeId}&fields=${fields}&key=${this.googleKey}`;

          const detailRes = await fetch(detailUrl);
          const detailData = (await detailRes.json()) as PlaceDetailsResponse;
          detailsStatus = detailData.status;

          if (detailData.status === 'OK') {
            editorialSummary = detailData.result.editorial_summary?.overview ?? null;
            phone = detailData.result.formatted_phone_number ?? null;
            website = detailData.result.website ?? null;
            formattedAddress = detailData.result.formatted_address ?? null;
            photoCount = detailData.result.photos?.length ?? 0;
          }
        }
      } catch (err) {
        searchStatus = `FETCH_ERROR: ${(err as Error).message}`;
      }

      diagnosis.places = {
        query,
        searchStatus,
        placeId,
        detailsStatus,
        editorialSummary,
        phone,
        website,
        formattedAddress,
        photoCount,
      };

      if (placeId && detailsStatus === 'OK') {
        if (!location.phone && phone) diagnosis.willUpdate.push(`phone → ${phone}`);
        else if (location.phone) diagnosis.willSkip.push(`phone (already set: ${location.phone})`);
        else diagnosis.willSkip.push('phone (not in Places result)');

        if (!location.websiteUrl && website) diagnosis.willUpdate.push(`website → ${website}`);
        else if (location.websiteUrl) diagnosis.willSkip.push(`website (already set)`);
        else diagnosis.willSkip.push('website (not in Places result)');

        if (formattedAddress && formattedAddress !== location.address) {
          diagnosis.willUpdate.push(`address → ${formattedAddress}`);
        } else if (formattedAddress) {
          diagnosis.willSkip.push('address (already matches Places result)');
        } else {
          diagnosis.willSkip.push('address (not in Places result)');
        }

        const currentPhotos = location.photos?.length ?? 0;
        const canAdd = Math.max(0, 5 - currentPhotos);
        if (canAdd > 0 && photoCount > 0) {
          diagnosis.willUpdate.push(`photos (will download up to ${Math.min(canAdd, photoCount)} of ${photoCount} Places photo(s))`);
        } else if (currentPhotos >= 5) {
          diagnosis.willSkip.push(`photo (already has ${currentPhotos} photo(s) — at limit)`);
        } else {
          diagnosis.willSkip.push('photo (no photos in Places result — will try Street View)');
        }
      }
    }

    // Claude
    if (!this.anthropic) {
      diagnosis.claude = {
        status: 'skipped',
        reason: 'ANTHROPIC_API_KEY not configured',
        generatedDescription: null,
      };
      diagnosis.willSkip.push('description (no API key)');
    } else {
      try {
        const editorial = diagnosis.places?.editorialSummary ?? undefined;
        const generated = await this.generateDescription(
          location.name,
          location.address,
          location.city?.name,
          editorial,
        );
        diagnosis.claude = {
          status: generated ? 'ok' : 'error',
          reason: generated ? 'Successfully generated' : 'Claude returned empty response',
          generatedDescription: generated,
        };
        const action = diagnosis.location.hasDescription ? 'replace existing' : 'new';
        if (generated) diagnosis.willUpdate.push(`description (Claude — ${action})`);
      } catch (err) {
        diagnosis.claude = {
          status: 'error',
          reason: (err as Error).message,
          generatedDescription: null,
        };
        diagnosis.willSkip.push(`description (Claude error: ${(err as Error).message})`);
      }
    }

    return diagnosis;
  }

  // Priority: sublocality_level_1 (Hyde Park) → neighborhood → locality (Cincinnati, Centerville)
  private parseLocalityFromComponents(components: AddressComponent[]): string | null {
    const pick = (...types: string[]): string | null => {
      for (const type of types) {
        const comp = components.find((c) => c.types.includes(type));
        if (comp) return comp.long_name;
      }
      return null;
    };
    return pick('sublocality_level_1', 'neighborhood', 'locality');
  }

  private async fetchPlaceDetails(
    name: string,
    address: string,
  ): Promise<PlaceDetailsResponse['result'] | null> {
    try {
      const query = encodeURIComponent(`${name} ${address}`);
      const searchUrl =
        `https://maps.googleapis.com/maps/api/place/findplacefromtext/json` +
        `?input=${query}&inputtype=textquery&fields=place_id&key=${this.googleKey}`;

      const searchRes = await fetch(searchUrl);
      const searchData = (await searchRes.json()) as PlaceSearchResponse;

      if (searchData.status !== 'OK' || !searchData.candidates.length) {
        this.logger.warn(`[Enrich] No Places match for: ${name}`);
        return null;
      }

      const placeId = searchData.candidates[0].place_id;
      const fields =
        'name,formatted_address,address_components,geometry,editorial_summary,formatted_phone_number,website,photos';
      const detailUrl =
        `https://maps.googleapis.com/maps/api/place/details/json` +
        `?place_id=${placeId}&fields=${fields}&key=${this.googleKey}`;

      const detailRes = await fetch(detailUrl);
      const detailData = (await detailRes.json()) as PlaceDetailsResponse;

      if (detailData.status !== 'OK') {
        this.logger.warn(`[Enrich] Places details status ${detailData.status} for ${name}`);
        return null;
      }

      return detailData.result;
    } catch (err) {
      this.logger.error('[Enrich] Google Places API error', err);
      return null;
    }
  }

  private async downloadPlacePhotos(
    locationId: number,
    photoReferences: string[],
    uploaderId: number,
    startSortOrder: number,
  ): Promise<number> {
    let added = 0;
    for (let i = 0; i < photoReferences.length; i++) {
      try {
        const url =
          `https://maps.googleapis.com/maps/api/place/photo` +
          `?maxwidth=1200&photo_reference=${photoReferences[i]}&key=${this.googleKey}`;

        const res = await fetch(url);
        if (!res.ok) continue;

        const buffer = Buffer.from(await res.arrayBuffer());
        const filename = `${Date.now()}-${Math.round(Math.random() * 1e9)}.jpg`;

        mkdirSync(this.uploadPath, { recursive: true });
        await writeFile(join(this.uploadPath, filename), buffer);

        const photo = this.photoRepo.create({
          locationId,
          filePath: `/api/uploads/locations/${filename}`,
          fileName: filename,
          mimeType: 'image/jpeg',
          sortOrder: startSortOrder + i,
          uploadedBy: uploaderId,
        });
        await this.photoRepo.save(photo);
        added++;
      } catch (err) {
        this.logger.error(`[Enrich] Places photo ${i + 1} download failed`, err);
      }
    }
    return added;
  }

  private async downloadStreetViewPhoto(
    locationId: number,
    address: string,
    cityName: string | undefined,
    uploaderId: number,
  ): Promise<boolean> {
    if (!this.googleKey) return false;
    try {
      const alreadyHasCity = cityName && address.toLowerCase().includes(cityName.toLowerCase());
      const query = cityName && !alreadyHasCity ? `${address}, ${cityName}` : address;
      const location = encodeURIComponent(query);

      // Check metadata first — Street View always returns 200 with a grey placeholder
      // when no imagery exists, so we must confirm coverage before downloading.
      const metaUrl =
        `https://maps.googleapis.com/maps/api/streetview/metadata` +
        `?location=${location}&key=${this.googleKey}`;
      const metaRes = await fetch(metaUrl);
      const meta = (await metaRes.json()) as { status: string };
      if (meta.status !== 'OK') {
        this.logger.log(`[Enrich] No Street View coverage for: ${query} (status: ${meta.status})`);
        return false;
      }

      const url =
        `https://maps.googleapis.com/maps/api/streetview` +
        `?size=1200x800&location=${location}&key=${this.googleKey}`;

      const res = await fetch(url);
      if (!res.ok) return false;

      const buffer = Buffer.from(await res.arrayBuffer());

      const filename = `${Date.now()}-${Math.round(Math.random() * 1e9)}.jpg`;
      mkdirSync(this.uploadPath, { recursive: true });
      await writeFile(join(this.uploadPath, filename), buffer);

      const photo = this.photoRepo.create({
        locationId,
        filePath: `/api/uploads/locations/${filename}`,
        fileName: filename,
        mimeType: 'image/jpeg',
        sortOrder: 0,
        uploadedBy: uploaderId,
      });
      await this.photoRepo.save(photo);
      return true;
    } catch (err) {
      this.logger.error('[Enrich] Street View photo failed', err);
      return false;
    }
  }

  async placeSearch(q: string): Promise<PlaceSearchResult[]> {
    if (!this.googleKey) return [];
    try {
      const url =
        `https://maps.googleapis.com/maps/api/place/textsearch/json` +
        `?query=${encodeURIComponent(q)}&key=${this.googleKey}`;
      const res = await fetch(url);
      const data = (await res.json()) as TextSearchResponse;
      if (data.status !== 'OK') return [];
      return data.results.slice(0, 6).map((r) => ({
        placeId: r.place_id,
        name: r.name,
        address: r.formatted_address,
        lat: r.geometry.location.lat,
        lng: r.geometry.location.lng,
      }));
    } catch (err) {
      this.logger.error('[PlaceSearch] Google Places error', err);
      return [];
    }
  }

  private async generateDescription(
    name: string,
    address: string,
    cityName?: string,
    editorial?: string,
  ): Promise<string | null> {
    if (!this.anthropic) return null;
    try {
      const context = editorial ? `\nGoogle says: "${editorial}"` : '';
      const message = await this.anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 150,
        messages: [
          {
            role: 'user',
            content:
              `Write a 2–3 sentence description for "${name}", a restaurant at ${address}` +
              `${cityName ? ` in ${cityName}` : ''}.${context}` +
              `\n\nMake it warm and inviting for a group dinner. Output only the description text.`,
          },
        ],
      });
      const block = message.content[0];
      if (block.type !== 'text') return null;
      // Strip any markdown heading lines Claude occasionally prepends
      return block.text.replace(/^#+\s+.+\n+/m, '').trim() || null;
    } catch (err) {
      this.logger.error('[Enrich] Claude API error', err);
      return null;
    }
  }
}
